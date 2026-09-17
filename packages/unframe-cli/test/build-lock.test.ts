import { lstat, mkdtemp, open, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireBuildLock, buildLockFileName } from "../src/filesystem/build-lock.js";

const directories: string[] = [];
const project = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-build-lock-"));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("build lock", () => {
  it("exclusively retains and releases its own regular-file inode", async () => {
    const directory = await project();
    const first = await acquireBuildLock(directory);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await lstat(join(directory, buildLockFileName))).isFile()).toBe(true);
    const concurrent = await acquireBuildLock(directory);
    expect(concurrent).toEqual({ ok: false, code: "cli-build-lock-unavailable" });
    await first.value.release();
    await expect(lstat(join(directory, buildLockFileName))).rejects.toThrow();
  });

  it("fails closed when a stale lock exists", async () => {
    const directory = await project();
    await writeFile(join(directory, buildLockFileName), "stale");
    await expect(acquireBuildLock(directory)).resolves.toEqual({
      ok: false,
      code: "cli-build-lock-unavailable",
    });
  });

  it("removes its own lock when post-open validation fails", async () => {
    const directory = await project();
    const path = join(directory, buildLockFileName);
    let lstatCalls = 0;
    const acquired = await acquireBuildLock(directory, {
      open,
      unlink,
      lstat: async (candidate) => {
        lstatCalls += 1;
        if (lstatCalls === 1) throw Object.assign(new Error("I/O failure"), { code: "EIO" });
        return lstat(candidate);
      },
    });

    expect(acquired).toEqual({ ok: false, code: "cli-build-lock-io" });
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("surfaces release I/O and permits retrying cleanup", async () => {
    const directory = await project();
    const path = join(directory, buildLockFileName);
    let releaseLstatFailed = false;
    let lstatCalls = 0;
    const acquired = await acquireBuildLock(directory, {
      open,
      unlink,
      lstat: async (candidate) => {
        lstatCalls += 1;
        if (lstatCalls === 2 && !releaseLstatFailed) {
          releaseLstatFailed = true;
          throw Object.assign(new Error("I/O failure"), { code: "EIO" });
        }
        return lstat(candidate);
      },
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    await expect(acquired.value.release()).rejects.toThrow("Build lock release failed");
    await expect(lstat(path)).resolves.toBeDefined();
    await expect(acquired.value.release()).resolves.toBeUndefined();
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove a lock whose inode replaced the acquired lock", async () => {
    const directory = await project();
    const path = join(directory, buildLockFileName);
    const acquired = await acquireBuildLock(directory);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    await unlink(path);
    await writeFile(path, "replacement");

    await expect(acquired.value.release()).rejects.toThrow("Build lock release failed");
    await expect(lstat(path)).resolves.toBeDefined();
  });
});
