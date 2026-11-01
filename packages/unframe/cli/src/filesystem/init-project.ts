import { copyFile, lstat, mkdir, readdir, rmdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { randomUUID } from "node:crypto";
import { projectDirectory, readBoundedRegularFile } from "@unframe/workspace-node";
import { loadProjectConfig } from "@unframe/workspace";

const template = fileURLToPath(new URL("../../../../../examples/presentation/", import.meta.url));

export const initPresentationProject = async (
  directory: string,
): Promise<{ ok: true } | { ok: false; code: string }> => {
  if (!(await projectDirectory(dirname(directory))))
    return { ok: false, code: "cli-init-parent-invalid" };
  if (await lstat(directory).catch(() => undefined))
    return { ok: false, code: "cli-init-target-exists" };
  const names = (await readdir(template, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== ".unframe-source.lock" &&
        entry.name !== ".unframe-build.lock",
    )
    .map((entry) => entry.name)
    .sort();
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    return { ok: false, code: "cli-init-create-failed" };
  }
  const copied: string[] = [];
  const createdDirectories: string[] = [];
  try {
    for (const name of names) {
      await copyFile(join(template, name), join(directory, name));
      copied.push(name);
    }
    const configBytes = await readBoundedRegularFile(
      join(template, "unframe.config.ts"),
      1024 * 1024,
    );
    const config = configBytes ? loadProjectConfig(configBytes) : undefined;
    if (!config) throw new Error("Template project config is invalid.");
    let assetBytes = 0;
    const assetPaths = [
      ...new Set(Object.values(config.assets).map((source) => source.path)),
    ].sort();
    for (const path of assetPaths) {
      const bytes = await readBoundedRegularFile(
        join(template, path),
        Math.min(64 * 1024 * 1024, 256 * 1024 * 1024 - assetBytes),
      );
      if (!bytes) throw new Error("Template asset is missing or exceeds its byte budget.");
      assetBytes += bytes.byteLength;
      if (copied.includes(path)) continue;
      const parts = path.split("/");
      for (let depth = 1; depth < parts.length; depth++) {
        const relative = parts.slice(0, depth).join("/");
        if (createdDirectories.includes(relative)) continue;
        await mkdir(join(directory, relative), { mode: 0o700 });
        createdDirectories.push(relative);
      }
      await writeFile(join(directory, path), bytes, { flag: "wx", mode: 0o600 });
      copied.push(path);
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
    for (const name of createdDirectories.reverse())
      await rmdir(join(directory, name)).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    return { ok: false, code: "cli-init-copy-failed" };
  }
};
