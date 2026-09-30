import { cp, lstat, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const snapshotOpaqueRuntimeDirectory = async (
  source: string,
  target: string,
): Promise<string> => {
  await cp(source, target, {
    dereference: false,
    filter: async (path) => {
      const stat = await lstat(path);
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error("Opaque runtime accepts only regular files and directories.");
      }
      return true;
    },
    recursive: true,
  });
  const digest = createHash("sha256");
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, `${relative}/`);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error("Opaque runtime accepts only regular files and directories.");
      }
      const fileHash = createHash("sha256");
      for await (const chunk of createReadStream(path)) {
        fileHash.update(chunk);
      }
      digest.update(JSON.stringify([relative, fileHash.digest("hex")]));
    }
  };
  await visit(target, "");
  return digest.digest("hex");
};
