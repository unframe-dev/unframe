import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile, rename, symlink } from "node:fs/promises";
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

it("preserves permissions through native writes and exposes ownership metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-native-mode-"));
  try {
    await using filesystem = new NativeFilesystem();
    const path = join(directory, "source.ts");
    await filesystem.write(path, new Uint8Array([1]), 0o640);
    expect(await filesystem.lstat(path)).toMatchObject({ uid: process.getuid?.() });
    expect((await filesystem.lstat(path)).mode & 0o777).toBe(0o640);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "process.exit(1)",
  "process.stdin.once('data', () => process.stdout.end('invalid\\n')); setInterval(() => {}, 60_000)",
  "process.stdin.once('data', () => process.stdout.write(JSON.stringify({id: 999, value: true}) + '\\n')); process.stdin.resume()",
])("rejects pending operations and releases a failed helper: %s", async (source) => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-native-failure-"));
  try {
    const executable = join(directory, "helper");
    await writeFile(executable, `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
    await using filesystem = new NativeFilesystem(executable);
    await expect(filesystem.write("/unused", new Uint8Array(8 * 1024 * 1024))).rejects.toThrow(
      "Filesystem helper",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("reaps a helper that ignores owner EOF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-native-stuck-"));
  try {
    const executable = join(directory, "helper");
    await writeFile(executable, `#!${process.execPath}\nsetInterval(() => {}, 60_000)\n`, {
      mode: 0o755,
    });
    const filesystem = new NativeFilesystem(executable);
    await filesystem[Symbol.asyncDispose]();
    await expect(filesystem.directory(directory)).rejects.toMatchObject({ code: "EBADF" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps relative operations pinned and rejects symlinks and oversized reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "unframe-native-anchor-"));
  const outside = await mkdtemp(join(tmpdir(), "unframe-native-outside-"));
  try {
    await using filesystem = new NativeFilesystem();
    await using directory = await filesystem.directory(root);
    await filesystem.mkdir(`${directory.anchor}/日本語`);
    await using nested = await filesystem.directory(`${directory.anchor}/日本語`);
    await filesystem.write(`${nested.anchor}/asset`, new Uint8Array([0, 255, 10, 13]));
    await expect(filesystem.read(`${nested.anchor}/asset`, 3)).rejects.toMatchObject({
      code: "EINVAL",
    });
    expect(await filesystem.read(`${nested.anchor}/asset`, 4)).toEqual(
      new Uint8Array([0, 255, 10, 13]),
    );
    await rename(root, `${root}-moved`);
    await symlink(outside, root);
    await filesystem.rename(`${nested.anchor}/asset`, `${nested.anchor}/renamed`);
    await directory.sync();
    expect((await filesystem.readdir(directory.anchor)).map((entry) => entry.name)).toEqual([
      "日本語",
    ]);
    expect((await filesystem.readdir(directory.anchor)).map((entry) => entry.name)).toEqual([
      "日本語",
    ]);
    await writeFile(join(outside, "keep"), "safe");
    await symlink(outside, join(`${root}-moved`, "日本語", "link"));
    await expect(filesystem.read(`${nested.anchor}/link`, 10)).rejects.toBeDefined();
    await expect(filesystem.directory(`${nested.anchor}/link`)).rejects.toBeDefined();
    await nested.close();
    await filesystem.rm(`${directory.anchor}/日本語`);
    expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
    expect(await filesystem.readdir(directory.anchor)).toEqual([]);
    await directory.close();
    await expect(directory.stat()).rejects.toMatchObject({ code: "EBADF" });
  } finally {
    await Promise.all(
      [root, `${root}-moved`, outside].map((path) => rm(path, { recursive: true, force: true })),
    );
  }
});
