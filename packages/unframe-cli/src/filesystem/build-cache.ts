import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import type { CompilerBuildCache, CompiledDeclarationProject } from "@unframe/unframe-compiler";
import { projectDirectory } from "./path-policy.js";
import { parseStrictJson } from "./strict-json.js";

const digest = /^[0-9a-f]{64}$/u;
const keyPattern = /^sha256:[0-9a-f]{64}$/u;
const MAX_BYTES = 256 * 1024 * 1024;
const metadataSchema = z.strictObject({
  version: z.literal(1),
  value: z.record(z.string(), z.unknown()),
});
const assetSetSchema = z.object({
  assets: z.record(
    z.string(),
    z.object({
      checksum: z.string().regex(keyPattern),
      encodedSizeBytes: z.number().int().nonnegative().max(MAX_BYTES),
    }),
  ),
});
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const anchor = (handle: FileHandle) => `/proc/self/fd/${handle.fd}`;
const directory = (path: string) =>
  open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

const read = async (path: string, limit: number): Promise<Uint8Array> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("Invalid cache file");
    const bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new Error("Cache file shrank during read");
      offset += result.bytesRead;
    }
    const probe = await handle.read(new Uint8Array(1), 0, 1, offset);
    if (probe.bytesRead !== 0) throw new Error("Cache file grew during read");
    return bytes;
  } finally {
    await handle.close();
  }
};
const write = async (path: string, bytes: Uint8Array) => {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

/** Linux project cache, independent of Release and Delivery output. */
export const createFilesystemBuildCache = (
  root: string,
  options: {
    readonly signal?: AbortSignal;
    readonly maxEntries?: number;
    readonly onStaged?: () => void | Promise<void>;
  } = {},
): CompilerBuildCache => {
  const maxEntries = options.maxEntries ?? 16;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw new TypeError("Invalid cache entry limit");
  const withRoot = async <T>(
    create: boolean,
    action: (base: string) => Promise<T>,
  ): Promise<T | undefined> => {
    const handles: FileHandle[] = [];
    try {
      if (options.signal?.aborted || !(await projectDirectory(root))) return undefined;
      let handle = await directory(root);
      handles.push(handle);
      for (const name of [".unframe", "cache", "builds-v1"]) {
        const child = join(anchor(handle), name);
        if (create)
          await mkdir(child, { mode: 0o700 }).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          });
        handle = await directory(child);
        handles.push(handle);
      }
      return await action(anchor(handle));
    } catch {
      return undefined;
    } finally {
      await Promise.allSettled(handles.reverse().map((handle) => handle.close()));
    }
  };
  return {
    async get(key) {
      if (!keyPattern.test(key)) return undefined;
      return withRoot(false, async (base) => {
        const entry = await directory(join(base, key.slice(7)));
        try {
          const parsed = parseStrictJson(
            await read(join(anchor(entry), "entry.json"), 64 * 1024 * 1024),
          );
          if (!parsed.ok) return undefined;
          const metadata = metadataSchema.safeParse(parsed.value);
          if (!metadata.success) return undefined;
          const assetSet = assetSetSchema.safeParse(metadata.data.value.assetSet);
          if (!assetSet.success) return undefined;
          const assets: Record<string, Uint8Array> = Object.create(null);
          let total = 0;
          for (const [id, descriptor] of Object.entries(assetSet.data.assets)) {
            total += descriptor.encodedSizeBytes;
            if (total > MAX_BYTES) return undefined;
            const bytes = await read(
              join(anchor(entry), `${descriptor.checksum.slice(7)}.bin`),
              descriptor.encodedSizeBytes,
            );
            if (
              bytes.length !== descriptor.encodedSizeBytes ||
              checksum(bytes) !== descriptor.checksum
            )
              return undefined;
            assets[id] = bytes;
          }
          return { ...metadata.data.value, assets };
        } finally {
          await entry.close();
        }
      });
    },
    async set(key, value: CompiledDeclarationProject) {
      if (!keyPattern.test(key)) return;
      await withRoot(true, async (base) => {
        const name = `.staging-${randomUUID()}`;
        const staging = join(base, name);
        await mkdir(staging, { mode: 0o700 });
        const discarded = join(base, `.discarded-${randomUUID()}`);
        let handle: FileHandle | undefined;
        try {
          handle = await directory(staging);
          const snapshot = structuredClone(value);
          const { assets, ...metadata } = snapshot;
          const descriptors = assetSetSchema.parse(snapshot.assetSet).assets;
          const written = new Set<string>();
          let total = 0;
          for (const [id, descriptor] of Object.entries(descriptors)) {
            const bytes = assets[id];
            if (
              !(bytes instanceof Uint8Array) ||
              bytes.length !== descriptor.encodedSizeBytes ||
              checksum(bytes) !== descriptor.checksum
            )
              throw new Error("Cache checksum mismatch");
            if (written.has(descriptor.checksum)) continue;
            written.add(descriptor.checksum);
            total += bytes.length;
            if (total > MAX_BYTES || options.signal?.aborted)
              throw new Error("Cache write cancelled or oversized");
            await write(join(anchor(handle), `${descriptor.checksum.slice(7)}.bin`), bytes);
          }
          const json = new TextEncoder().encode(JSON.stringify({ version: 1, value: metadata }));
          if (json.length > 64 * 1024 * 1024) throw new Error("Cache metadata exceeded limit");
          await write(join(anchor(handle), "entry.json"), json);
          await options.onStaged?.();
          if (options.signal?.aborted) return;
          await handle.sync();
          await handle.close();
          handle = undefined;
          await rename(join(base, key.slice(7)), discarded).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          });
          // Concurrent writers may already have published this immutable key.
          await rename(staging, join(base, key.slice(7))).catch((error: unknown) => {
            if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
              throw error;
          });
          const entries = await readdir(base, { withFileTypes: true });
          const completed = entries.filter(
            (entry) => entry.isDirectory() && digest.test(entry.name),
          );
          if (completed.length > maxEntries) {
            const ranked = await Promise.all(
              completed
                .filter((entry) => entry.name !== key.slice(7))
                .map(async (item) => {
                  const owned = await directory(join(base, item.name));
                  try {
                    return { name: item.name, time: (await owned.stat()).mtimeMs };
                  } finally {
                    await owned.close();
                  }
                }),
            );
            ranked.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
            for (const stale of ranked.slice(0, completed.length - maxEntries))
              await rm(join(base, stale.name), { recursive: true, force: true });
          }
        } finally {
          try {
            await handle?.close();
          } finally {
            await rm(staging, { recursive: true, force: true });
            await rm(discarded, { recursive: true, force: true });
          }
        }
      });
    },
  };
};
