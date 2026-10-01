import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { snapshotOpaqueRuntimeDirectory } from "../src/opaque/capture/runtime-snapshot.js";

it("rejects a dependency symlink to a file outside its runtime root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opaque-snapshot-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await writeFile(join(directory, "private"), "private");
    await symlink(join(directory, "private"), join(source, "link"));
    await expect(
      snapshotOpaqueRuntimeDirectory(source, join(directory, "snapshot")),
    ).rejects.toThrow("regular");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("fingerprints file contents independently of the snapshot directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opaque-snapshot-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await writeFile(join(source, "index.js"), "one");
    const first = await snapshotOpaqueRuntimeDirectory(source, join(directory, "a"));
    expect(await snapshotOpaqueRuntimeDirectory(source, join(directory, "b"))).toBe(first);
    await writeFile(join(source, "index.js"), "two");
    expect(await snapshotOpaqueRuntimeDirectory(source, join(directory, "c"))).not.toBe(first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
