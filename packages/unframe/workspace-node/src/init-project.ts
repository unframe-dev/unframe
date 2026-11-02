import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { projectDirectory } from "./path-policy.js";

export const initPresentationProject = async (
  directory: string,
  template: string,
): Promise<{ ok: true } | { ok: false; code: string }> => {
  if (!(await projectDirectory(dirname(directory))))
    return { ok: false, code: "cli-init-parent-invalid" };
  if (await lstat(directory).catch(() => undefined))
    return { ok: false, code: "cli-init-target-exists" };
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    return { ok: false, code: "cli-init-create-failed" };
  }
  const files: string[] = [];
  const directories: string[] = [];
  try {
    const copy = async (from: string, to: string) => {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        if (entry.name === "unframe.lock.gz") continue;
        if (
          from === template &&
          [".unframe-source.lock", ".unframe-build.lock"].includes(entry.name)
        )
          continue;
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        if (entry.isDirectory()) {
          await mkdir(target, { mode: 0o700 });
          directories.push(target);
          await copy(source, target);
        } else if (entry.isFile()) {
          await copyFile(source, target, constants.COPYFILE_EXCL);
          files.push(target);
        } else throw new Error("Template must contain regular files only.");
      }
    };
    await copy(template, directory);
    const lockPath = join(directory, "unframe.lock");
    const lockBytes = gunzipSync(await readFile(join(template, "unframe.lock.gz")));
    const lockFile = await open(lockPath, "wx", 0o600);
    files.push(lockPath);
    try {
      await lockFile.writeFile(lockBytes);
    } finally {
      await lockFile.close();
    }
    const entry = join(directory, "presentation.unframe.tsx");
    const source = await readFile(entry, "utf8");
    const identity = 'id: "packed-project"';
    if (source.split(identity).length !== 2) throw new Error("Template identity is ambiguous.");
    await writeFile(entry, source.replace(identity, `id: "presentation-${randomUUID()}"`));
    return { ok: true };
  } catch {
    for (const file of files.reverse()) await unlink(file).catch(() => undefined);
    for (const path of directories.reverse()) await rmdir(path).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    return { ok: false, code: "cli-init-copy-failed" };
  }
};
