import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

export type StaticAsset = { root: string; relative: string; mediaType: string };
const fingerprint = (stat: BigIntStats) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");

const checkedPath = async (asset: StaticAsset) => {
  const parts = asset.relative.split("/");
  if (
    isAbsolute(asset.relative) ||
    parts.some((part) => !part || part === "." || part === ".." || part.includes(sep))
  )
    throw new Error("Invalid static asset path.");
  const root = await realpath(asset.root);
  if (root !== asset.root || !(await lstat(root)).isDirectory())
    throw new Error("Static asset root must remain a canonical directory.");
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const stat = await lstat(path, { bigint: true });
    if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      throw new Error("Static assets must be regular files without links.");
  }
  return { path, stat: await lstat(path, { bigint: true }) };
};

/** Snapshots keep the response bytes and ETag consistent while a Player is rebuilt. */
export const createStaticAssetStore = () => {
  let directory: Promise<string> | undefined;
  let sequence = 0;
  let closed = false;
  const controller = new AbortController();
  const cache = new Map<
    string,
    { fingerprint: string; path: string; etag: string; size: bigint }
  >();
  const pending = new Map<string, Promise<void>>();
  const get = async (asset: StaticAsset, requestSignal?: AbortSignal) => {
    const signal = requestSignal
      ? AbortSignal.any([controller.signal, requestSignal])
      : controller.signal;
    if (closed) throw new Error("Static asset store is closed.");
    const key = JSON.stringify([asset.root, asset.relative]);
    const previous = pending.get(key);
    const { promise: operation, resolve: release } = Promise.withResolvers<void>();
    pending.set(key, operation);
    try {
      await previous;
      signal.throwIfAborted();
      const before = await checkedPath(asset);
      const identity = fingerprint(before.stat);
      let snapshot = cache.get(key);
      if (snapshot?.fingerprint !== identity) {
        directory ??= mkdtemp(join(tmpdir(), "unframe-player-"));
        const path = join(await directory, String(++sequence));
        try {
          await using source = await open(
            before.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          const opened = await source.stat({ bigint: true });
          if (!opened.isFile() || fingerprint(opened) !== identity)
            throw new Error("Static asset changed before reading.");
          await using output = await open(path, "wx", 0o600);
          const hash = createHash("sha256");
          const buffer = Buffer.allocUnsafe(64 * 1024);
          let size = 0n;
          while (size < opened.size) {
            signal.throwIfAborted();
            const { bytesRead } = await source.read(
              buffer,
              0,
              Number(
                opened.size - size < BigInt(buffer.length)
                  ? opened.size - size
                  : BigInt(buffer.length),
              ),
              null,
            );
            if (!bytesRead) throw new Error("Static asset changed during reading.");
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk);
            await output.writeFile(chunk);
            size += BigInt(bytesRead);
          }
          signal.throwIfAborted();
          const after = await checkedPath(asset);
          if (
            fingerprint(await source.stat({ bigint: true })) !== identity ||
            after.path !== before.path ||
            fingerprint(after.stat) !== identity
          )
            throw new Error("Static asset changed during reading.");
          const old = snapshot;
          snapshot = { fingerprint: identity, path, etag: `"${hash.digest("hex")}"`, size };
          if (old) await rm(old.path, { force: true });
          cache.set(key, snapshot);
        } catch (error) {
          await rm(path, { force: true });
          throw error;
        }
      }
      signal.throwIfAborted();
      const handle = await open(snapshot.path, "r");
      if (signal.aborted) {
        await handle.close();
        signal.throwIfAborted();
      }
      return { handle, etag: snapshot.etag, size: snapshot.size };
    } finally {
      release();
      if (pending.get(key) === operation) pending.delete(key);
    }
  };
  const close = async () => {
    closed = true;
    controller.abort();
    await Promise.all(pending.values());
    if (directory) await rm(await directory, { recursive: true, force: true });
    cache.clear();
  };
  return { get, close, [Symbol.asyncDispose]: close };
};
