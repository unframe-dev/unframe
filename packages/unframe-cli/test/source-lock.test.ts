import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { acquireSourceLock } from "../src/filesystem/source-lock.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("prevents readers from observing a source save and leaves its revision unchanged after release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-lease-"));
  directories.push(directory);
  await cp(fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)), directory, {
    recursive: true,
  });
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  const acquired = await acquireSourceLock(directory);
  assert(acquired.ok);
  expect(await discoverPresentationProjectFiles(directory)).toMatchObject({
    ok: false,
    code: "cli-source-lock-unavailable",
  });
  const inside = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
  assert(inside.ok);
  expect(inside.revision).toBe(before.revision);
  await acquired.value.release();
  expect(await discoverPresentationProjectFiles(directory)).toMatchObject({
    ok: true,
    revision: before.revision,
  });
});
it("does not remove an existing lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-lease-"));
  directories.push(directory);
  await writeFile(join(directory, ".unframe-source.lock"), "other writer");
  expect(await acquireSourceLock(directory)).toMatchObject({ ok: false });
  expect(await readFile(join(directory, ".unframe-source.lock"), "utf8")).toBe("other writer");
});
it("waits for a Host reader lease, then snapshots the released revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-wait-"));
  directories.push(directory);
  await cp(fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)), directory, {
    recursive: true,
  });
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const waiting = discoverPresentationProjectFiles(directory, { waitTimeoutMs: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await lease.value.release();
  expect(await waiting).toMatchObject({ ok: true });
});
it("bounds a Host lease wait and cancels it without removing the current owner's lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-wait-"));
  directories.push(directory);
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const controller = new AbortController();
  const waiting = acquireSourceLock(directory, { waitTimeoutMs: 5000, signal: controller.signal });
  controller.abort();
  expect(await waiting).toMatchObject({ ok: false, code: "cli-cancelled" });
  expect(await acquireSourceLock(directory, { waitTimeoutMs: 40 })).toMatchObject({
    ok: false,
    code: "cli-source-lock-unavailable",
  });
  await lease.value.release();
});

it("rejects a changed revision after the Host waited for a reader lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-wait-"));
  directories.push(directory);
  await cp(fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)), directory, {
    recursive: true,
  });
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const pending = runPresentationCli({
    args: ["build", directory],
    host: { channel: "dist", expectedRevision: before.revision },
  });
  const path = join(directory, "presentation.unframe.tsx");
  await writeFile(path, (await readFile(path, "utf8")) + "\n");
  await lease.value.release();
  const result = await pending;
  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain("cli-output-stale");
});
