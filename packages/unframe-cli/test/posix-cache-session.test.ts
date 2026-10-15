import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { afterEach, expect, it, vi } from "vitest";
import { createPosixCacheSession } from "../src/filesystem/posix-cache.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const helper = async (source: string) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-helper-failure-"));
  roots.push(root);
  const python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  const executable = join(root, "helper");
  await writeFile(executable, `#!${python}\n${source}\n`, { mode: 0o755 });
  vi.stubEnv("UNFRAME_POSIX_PYTHON", executable);
};

it("reports helper exit during a large RPC without unhandled pipe errors", async () => {
  await helper("raise SystemExit(1)");
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
  await helper("import time\ntime.sleep(60)");
  const session = createPosixCacheSession();
  await session.close();
  await expect(session.directory("/tmp")).rejects.toThrow("POSIX cache helper");
});
