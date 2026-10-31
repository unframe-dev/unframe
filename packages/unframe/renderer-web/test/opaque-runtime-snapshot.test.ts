import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, lstat } from "node:fs/promises";
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

it("preserves closed internal framework symlinks and their native layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opaque-snapshot-"));
  try {
    const source = join(directory, "source");
    await mkdir(join(source, "Versions", "A"), { recursive: true });
    await writeFile(join(source, "Versions", "A", "framework"), "native dylib");
    await symlink("A", join(source, "Versions", "Current"));
    await symlink("Versions/Current/framework", join(source, "framework"));
    const target = join(directory, "snapshot");
    await snapshotOpaqueRuntimeDirectory(source, target);
    expect(await readFile(join(target, "framework"), "utf8")).toBe("native dylib");
    expect((await lstat(join(target, "framework"))).isSymbolicLink()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects internal symlink cycles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opaque-snapshot-"));
  try {
    const source = join(directory, "source");
    await mkdir(source);
    await symlink(".", join(source, "cycle"));
    await expect(
      snapshotOpaqueRuntimeDirectory(source, join(directory, "snapshot")),
    ).rejects.toThrow("cyclic");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
