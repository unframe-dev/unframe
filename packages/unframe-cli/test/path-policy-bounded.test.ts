import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBoundedRegularFile } from "../src/filesystem/path-policy.js";

describe("readBoundedRegularFile", () => {
  it("rejects sparse regular files above the limit without allocating their declared size", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-bounded-"));
    try {
      const path = join(directory, "large.bin");
      const file = await open(path, "w");
      try {
        await file.truncate(512 * 1024 * 1024);
      } finally {
        await file.close();
      }
      expect(await readBoundedRegularFile(path, 1024)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts exact bytes and rejects a descriptor size mismatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-bounded-"));
    try {
      const path = join(directory, "asset.bin");
      await writeFile(path, "asset");
      expect(new TextDecoder().decode(await readBoundedRegularFile(path, 5, 5))).toBe("asset");
      expect(await readBoundedRegularFile(path, 5, 4)).toBeUndefined();
      expect(await readBoundedRegularFile(path, 5, 6)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
