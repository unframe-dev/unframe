import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { afterEach, expect, it, vi } from "vitest";
import { createPosixCacheSession } from "../src/filesystem/posix-cache.js";

const roots: string[] = [];
const nativeHelper = process.env.UNFRAME_POSIX_HELPER;
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const helper = async (source: string) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-helper-failure-"));
  roots.push(root);
  const node = process.execPath;
  const executable = join(root, "helper");
  await writeFile(executable, `#!${node}\n${source}\n`, { mode: 0o755 });
  vi.stubEnv("UNFRAME_POSIX_HELPER", executable);
};

it("reports helper exit during a large RPC without unhandled pipe errors", async () => {
  await helper("process.exit(1)");
  const session = createPosixCacheSession();
  try {
    await expect(session.write("/fd/1/asset", new Uint8Array(8 * 1024 * 1024))).rejects.toThrow(
      "POSIX cache helper",
    );
  } finally {
    await session.close();
  }
});

it("reaps a helper that ignores EOF before closing the session", async () => {
  await helper("setTimeout(() => {}, 60_000)");
  const session = createPosixCacheSession();
  await session.close();
  await expect(session.directory("/tmp")).rejects.toThrow("POSIX cache helper");
});

it("decodes a response split across header and payload boundaries", async () => {
  await helper(`process.stdin.once('data', () => {
    const frame = Buffer.from([0,0,0,5,0,0,0,0,7]);
    let offset = 0;
    const timer = setInterval(() => {
      process.stdout.write(frame.subarray(offset, ++offset));
      if (offset === frame.length) clearInterval(timer);
    }, 5);
  }); process.stdin.resume();`);
  const session = createPosixCacheSession();
  try {
    expect((await session.directory("/tmp")).fd).toBe(7);
  } finally {
    await session.close();
  }
});

it.each([
  "process.stdout.write(Buffer.from([0,0])); process.exit(0)",
  "process.stdout.write(Buffer.from([0,0,0,5,0,0])); process.exit(0)",
  "process.stdout.write(Buffer.from([255,255,255,255]));",
  "process.stdout.write(Buffer.from([0,0,0,1,99]));",
  "process.stdout.end(Buffer.from([0,0])); setInterval(() => {}, 1000);",
  "process.stdout.write(Buffer.from([0,0,0,5,0,0,0,0,0]));",
])("rejects invalid or truncated native responses: %s", async (reply) => {
  await helper(`process.stdin.once('data', () => { ${reply} }); process.stdin.resume();`);
  const session = createPosixCacheSession();
  try {
    await expect(session.directory("/tmp")).rejects.toThrow(/POSIX|helper/);
    await expect(session.directory("/tmp")).rejects.toThrow("POSIX cache helper");
  } finally {
    await session.close();
  }
});

it("native operations retain anchored ownership and do not follow symlinks", async () => {
  expect(nativeHelper).toBeTruthy();
  vi.stubEnv("UNFRAME_POSIX_HELPER", nativeHelper);
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-native-helper-"));
  roots.push(root);
  const outside = await mkdtemp(join(temporaryDirectory(), "unframe-native-outside-"));
  roots.push(outside);
  const session = createPosixCacheSession();
  try {
    const directory = await session.directory(root);
    expect(await directory.stat()).toMatchObject({ uid: process.getuid!() });
    const base = `/fd/${directory.fd}`;
    await session.mkdir(`${base}/日本語`, { mode: 0o700 });
    const nested = await session.directory(`${base}/日本語`);
    const path = `/fd/${nested.fd}/asset`;
    const bytes = new Uint8Array([0, 255, 10, 13]);
    await session.write(path, bytes);
    await expect(session.write(path, bytes)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(session.read(path, 3)).rejects.toMatchObject({ code: "EINVAL" });
    expect(await session.read(path, 4)).toEqual(bytes);
    expect((await session.lstat(path)).mode & 0o777).toBe(0o600);
    await rename(root, `${root}-moved`);
    roots.push(`${root}-moved`);
    await symlink(outside, root);
    await session.rename(path, `/fd/${nested.fd}/renamed`);
    await directory.sync();
    const first = await session.readdir(base);
    expect(first.map((entry) => entry.name)).toEqual(["日本語"]);
    expect(first[0]!.isDirectory()).toBe(true);
    expect((await session.readdir(base)).map((entry) => entry.name)).toEqual(["日本語"]);
    await writeFile(join(outside, "keep"), "safe");
    await symlink(outside, join(`${root}-moved`, "日本語", "link"));
    await expect(session.read(`/fd/${nested.fd}/link`, 10)).rejects.toMatchObject({
      code: expect.stringMatching(/ELOOP|EINVAL/),
    });
    await expect(session.directory(`/fd/${nested.fd}/link`)).rejects.toBeDefined();
    await nested.close();
    await session.rm(`${base}/日本語`);
    expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
    expect(await session.readdir(base)).toEqual([]);
    await expect(session.mkdir(`${base}/..`)).rejects.toMatchObject({ code: "EINVAL" });
    await directory.close();
    await expect(directory.stat()).rejects.toMatchObject({ code: "EBADF" });
  } finally {
    await session.close();
  }
});

it.each([Buffer.from([0, 0]), Buffer.from([255, 255, 255, 255]), Buffer.from([0, 0, 0, 25, 1])])(
  "native helper terminates on truncated or oversized frames",
  (input) => {
    expect(nativeHelper).toBeTruthy();
    const result = spawnSync(nativeHelper!, [], { input, timeout: 1_000, env: {} });
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBe(0);
    expect(result.stderr.toString()).not.toMatch(/ERROR: AddressSanitizer|runtime error:|SUMMARY:/);
  },
);

it("malformed list payloads permanently close the session", async () => {
  await helper(
    "process.stdin.once('data', () => process.stdout.write(Buffer.from([0,0,0,2,0,0]))); process.stdin.resume();",
  );
  const session = createPosixCacheSession();
  try {
    await expect(session.readdir("/fd/1")).rejects.toThrow("Invalid POSIX helper response");
    await expect(session.directory("/tmp")).rejects.toThrow("POSIX cache helper");
  } finally {
    await session.close();
  }
});
