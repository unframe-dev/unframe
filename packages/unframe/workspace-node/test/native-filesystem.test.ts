import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { NativeFilesystem } from "../src/native-filesystem.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it("exits on owner EOF with native directories still open", async () => {
  const executable = fileURLToPath(
    new URL(`../native-bin/filesystem-helper-${process.platform}-${process.arch}`, import.meta.url),
  );
  const child = spawn(executable, [], { stdio: "pipe" });
  try {
    await once(child, "spawn");
    const completion = once(child, "close");
    const lines = createInterface({ input: child.stdout });
    try {
      const response = once(lines, "line");
      child.stdin.write(`${JSON.stringify({ id: 1, op: "openDirectory", path: tmpdir() })}\n`);
      expect(JSON.parse(String((await response)[0]))).toMatchObject({ id: 1, value: { id: 1 } });
      child.stdin.end();
      expect(await completion).toEqual([0, null]);
    } finally {
      lines.close();
    }
  } finally {
    child.kill();
  }
});

it("hashes checked files without transferring their bytes and rejects unsafe reads", async () => {
  const directory = await mkdtemp(join(realpathSync(tmpdir()), "unframe-hash-"));
  await using filesystem = new NativeFilesystem();
  try {
    const path = join(directory, "input");
    await writeFile(path, "abc");
    expect(await filesystem.checkedHash(path, 3)).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    await expect(filesystem.checkedHash(path, 2)).rejects.toMatchObject({ code: "EINVAL" });
    await expect(filesystem.checkedHash(path, 3, 2)).rejects.toMatchObject({ code: "EINVAL" });
    await symlink(path, join(directory, "link"));
    await expect(filesystem.checkedHash(join(directory, "link"), 3)).rejects.toMatchObject({
      code: "EINVAL",
    });
    await expect(filesystem.checkedHash(directory, 3)).rejects.toMatchObject({ code: "EINVAL" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
