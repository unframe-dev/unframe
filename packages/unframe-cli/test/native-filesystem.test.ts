import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { NativeFilesystem, withNativeFilesystem } from "../src/filesystem/native-filesystem.js";

it("shares one bounded native lifetime across nested operations and releases it on failure", async () => {
  let owned: NativeFilesystem | undefined;
  await expect(
    withNativeFilesystem(async (filesystem) => {
      owned = filesystem;
      await withNativeFilesystem(async (nested) => {
        expect(nested).toBe(filesystem);
        await nested.checkedDirectory(tmpdir());
      });
      throw new Error("operation failed");
    }),
  ).rejects.toThrow("operation failed");
  await expect(owned?.checkedDirectory(tmpdir())).rejects.toMatchObject({ code: "EBADF" });
});

it("writes complete owned bytes and never overwrites an existing file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-native-write-"));
  try {
    await using filesystem = new NativeFilesystem();
    const path = join(directory, "asset.bin");
    const bytes = new Uint8Array(256 * 1024).fill(42);
    await filesystem.write(path, bytes);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    await expect(filesystem.write(path, new Uint8Array([9]))).rejects.toMatchObject({
      code: "EEXIST",
      operation: "open",
    });
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("exits on owner EOF with native directories still open", async () => {
  const executable = fileURLToPath(new URL("../.cache/filesystem-helper", import.meta.url));
  const child = spawn(executable, [], { stdio: "pipe" });
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
    child.kill();
  }
});
