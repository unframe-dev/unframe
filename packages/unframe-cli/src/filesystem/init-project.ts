import { copyFile, lstat, mkdir, readdir, rmdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { randomUUID } from "node:crypto";
import { projectDirectory } from "./path-policy.js";

const template = fileURLToPath(new URL("../../../../examples/presentation/", import.meta.url));

export const initPresentationProject = async (
  directory: string,
): Promise<{ ok: true } | { ok: false; code: string }> => {
  if (!(await projectDirectory(dirname(directory))))
    return { ok: false, code: "cli-init-parent-invalid" };
  if (await lstat(directory).catch(() => undefined))
    return { ok: false, code: "cli-init-target-exists" };
  const names = (await readdir(template, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    return { ok: false, code: "cli-init-create-failed" };
  }
  const copied: string[] = [];
  try {
    for (const name of names) {
      await copyFile(join(template, name), join(directory, name));
      copied.push(name);
    }
    const entryPath = join(directory, "presentation.unframe.tsx");
    const source = await readFile(entryPath, "utf8");
    const identity = 'id: "reference-presentation"';
    if (source.split(identity).length !== 2)
      throw new Error("Template presentation identity is ambiguous.");
    await writeFile(entryPath, source.replace(identity, `id: "presentation-${randomUUID()}"`));
    const lockPath = join(directory, "unframe.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    lock["rendererPlugins"] = [
      { id: "baked-web", version: "3", contractVersion: "2" },
      { id: "baked-web", version: "4", contractVersion: "2" },
    ];
    await writeFile(lockPath, canonicalizeJsonPayload(lock) + "\n");
    return { ok: true };
  } catch {
    const { unlink } = await import("node:fs/promises");
    for (const name of copied) await unlink(join(directory, name)).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    return { ok: false, code: "cli-init-copy-failed" };
  }
};
