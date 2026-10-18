import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import * as z from "zod";
import type { CompilerBuildCache, CompiledDeclarationProject } from "@unframe/unframe-compiler";
import { NativeFilesystem, type NativeDirectory } from "./native-filesystem.js";
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
const anchor = (handle: NativeDirectory) => handle.anchor;

/** Project cache, independent of Release and Delivery output. */
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
    action: (base: string, filesystem: NativeFilesystem) => Promise<T>,
  ): Promise<T | undefined> => {
    await using filesystem = new NativeFilesystem();
    const directory = (path: string) => filesystem.directory(path);
    try {
      if (options.signal?.aborted || !(await projectDirectory(root))) return undefined;
      let handle = await directory(root);
      for (const name of [".unframe", "cache", "builds-v1"]) {
        const child = join(anchor(handle), name);
        if (create)
          await filesystem.mkdir(child).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          });
        handle = await directory(child);
      }
      return await action(anchor(handle), filesystem);
    } catch {
      return undefined;
    }
  };
  return {
    async get(key) {
      if (!keyPattern.test(key)) return undefined;
      return withRoot(false, async (base, filesystem) => {
        const directory = (path: string) => filesystem.directory(path);
        const read = (path: string, limit: number) => filesystem.read(path, limit);
        await using entry = await directory(join(base, key.slice(7)));
        {
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
        }
      });
    },
    async set(key, value: CompiledDeclarationProject) {
      if (!keyPattern.test(key)) return;
      await withRoot(true, async (base, filesystem) => {
        const directory = (path: string) => filesystem.directory(path);
        const write = (path: string, bytes: Uint8Array) => filesystem.write(path, bytes);
        const rename = (path: string, target: string) => filesystem.rename(path, target);
        const name = `.staging-${randomUUID()}`;
        const staging = join(base, name);
        await filesystem.mkdir(staging);
        const discarded = join(base, `.discarded-${randomUUID()}`);
        try {
          await using handle = await directory(staging);
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
          await rename(join(base, key.slice(7)), discarded).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          });
          // Concurrent writers may already have published this immutable key.
          await rename(staging, join(base, key.slice(7))).catch((error: unknown) => {
            if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
              throw error;
          });
          const entries = await filesystem.readdir(base);
          const completed = entries.filter(
            (entry) => entry.isDirectory() && digest.test(entry.name),
          );
          if (completed.length > maxEntries) {
            const ranked = await Promise.all(
              completed
                .filter((entry) => entry.name !== key.slice(7))
                .map(async (item) => {
                  await using owned = await directory(join(base, item.name));
                  return { name: item.name, time: (await owned.stat()).mtimeMs };
                }),
            );
            ranked.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
            for (const stale of ranked.slice(0, completed.length - maxEntries))
              await filesystem.rm(join(base, stale.name));
          }
        } finally {
          await filesystem.rm(staging);
          await filesystem.rm(discarded);
        }
      });
    },
  };
};
