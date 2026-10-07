import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";

const directories: string[] = [];
const copyProject = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-revision-"));
  directories.push(directory);
  await cp(fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)), directory, {
    recursive: true,
  });
  return directory;
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("includes a regular file named like a temporary publication link in the revision", async () => {
  const directory = await copyProject();
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  const name = ".dist-00000000000000000000000000000000";
  await writeFile(join(directory, name), "source asset");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.localFiles.map((file) => file.path)).toContain(name);
  expect(after.revision).not.toBe(before.revision);
});

it("rejects a temporary-link name pointing outside its matching generation", async () => {
  const directory = await copyProject();
  await symlink("unframe.lock", join(directory, ".dist-00000000000000000000000000000000"));
  expect(await discoverPresentationProjectFiles(directory)).toMatchObject({ ok: false });
});

it.each(["unframe.config.ts", "unframe.lock", "presentation.unframe.tsx"])(
  "changes the revision when %s bytes change",
  async (name) => {
    const directory = await copyProject();
    const before = await discoverPresentationProjectFiles(directory);
    assert(before.ok);
    const path = join(directory, name);
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("\n")]));
    const after = await discoverPresentationProjectFiles(directory);
    assert(after.ok);
    expect(after.revision).not.toBe(before.revision);
  },
);

it("keeps the revision stable across directories and ignores the managed publication link", async () => {
  const first = await copyProject();
  const second = await copyProject();
  await writeFile(join(second, ".unframe-build.lock"), "transient build lease");
  await symlink(
    ".unframe/generations/00000000000000000000000000000000",
    join(second, ".dist-00000000000000000000000000000000"),
  );
  const a = await discoverPresentationProjectFiles(first);
  const b = await discoverPresentationProjectFiles(second);
  assert(a.ok);
  assert(b.ok);
  expect(a.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(b.revision).toBe(a.revision);
});

it("rejects a queued build's obsolete revision before opening a renderer", async () => {
  const directory = await copyProject();
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  const entry = join(directory, before.entryFile);
  await writeFile(entry, (await readFile(entry, "utf8")) + "\n");
  const result = await runPresentationCli({
    args: ["build", directory, "--format", "json"],
    host: { expectedRevision: before.revision },
  });
  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain("cli-output-stale");
});
