import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it } from "vitest";
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
