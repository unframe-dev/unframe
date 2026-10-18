import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readBoundedRegularFile } from "../src/filesystem/path-policy.js";

it("rejects symlink components before reading regular file bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-bounded-symlink-"));
  try {
    await mkdir(join(directory, "actual"));
    await writeFile(join(directory, "actual", "asset.bin"), "base");
    await symlink("actual", join(directory, "alias"));
    expect(
      await readBoundedRegularFile(join(directory, "alias", "asset.bin"), 4, 4),
    ).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
