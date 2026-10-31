import { cp, lstat, readdir, realpath, readlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative as relativePath } from "node:path";

export const snapshotOpaqueRuntimeDirectory = async (
  source: string,
  target: string,
): Promise<string> => {
  const root = await realpath(source);
  const expectedHash = await fingerprintOpaqueRuntimeDirectory(source);
  await cp(source, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: async (path) => {
      const resolved = await realpath(path);
      const child = relativePath(root, resolved);
      if (isAbsolute(child) || child === ".." || child.startsWith("../"))
        throw new Error(
          "Opaque runtime accepts only regular files and directories within its root.",
        );
      const stat = await lstat(resolved);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error("Opaque runtime accepts only regular files and directories.");
      return true;
    },
  });
  const actualHash = await fingerprintOpaqueRuntimeDirectory(target);
  if (actualHash !== expectedHash)
    throw new Error("Opaque runtime changed while being snapshotted.");
  return actualHash;
};

export const fingerprintOpaqueRuntimeDirectory = async (source: string): Promise<string> => {
  const root = await realpath(source);
  const digest = createHash("sha256");
  const visit = async (
    directory: string,
    prefix: string,
    ancestors: readonly string[],
  ): Promise<void> => {
    const resolved = await realpath(directory);
    const child = relativePath(root, resolved);
    if (isAbsolute(child) || child === ".." || child.startsWith("../"))
      throw new Error("Opaque runtime accepts only regular files and directories within its root.");
    if (ancestors.includes(resolved)) throw new Error("Opaque runtime rejects cyclic symlinks.");
    const parents = [...ancestors, resolved];
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      const resolvedPath = await realpath(path);
      const childPath = relativePath(root, resolvedPath);
      if (isAbsolute(childPath) || childPath === ".." || childPath.startsWith("../"))
        throw new Error(
          "Opaque runtime accepts only regular files and directories within its root.",
        );
      const originalStat = await lstat(path);
      if (originalStat.isSymbolicLink()) {
        const link = await readlink(path);
        if (isAbsolute(link)) throw new Error("Opaque runtime rejects absolute symlinks.");
        digest.update(JSON.stringify([relative, "symlink", link]));
      }
      const stat = await lstat(resolvedPath);
      if (stat.isDirectory()) {
        digest.update(JSON.stringify([relative, "directory"]));
        await visit(path, `${relative}/`, parents);
        continue;
      }
      if (!stat.isFile())
        throw new Error("Opaque runtime accepts only regular files and directories.");
      const fileHash = createHash("sha256");
      for await (const chunk of createReadStream(path)) fileHash.update(chunk);
      digest.update(JSON.stringify([relative, stat.mode & 0o111, fileHash.digest("hex")]));
    }
  };
  await visit(source, "", []);
  return digest.digest("hex");
};
