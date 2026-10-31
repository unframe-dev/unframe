import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareEngine } from "../prepare-engine.ts";
describe("SDK distribution", () => {
  it("copies every artifact unchanged and records hashes including notices", async () => {
    const root = await mkdtemp(join(tmpdir(), "audience-engine-"));
    try {
      const source = join(root, "source");
      const destination = join(root, "public");
      await mkdir(join(source, "dist/resources"), { recursive: true });
      await writeFile(join(source, "package.json"), JSON.stringify({ version: "1.0.0" }));
      for (const [file, content] of [
        ["xr.js", "copyright - engine"],
        ["xr-slam.js", "binary chunk"],
        ["LICENSE", "license text"],
        ["resources/data.bin", "resource bytes"],
      ])
        await writeFile(join(source, "dist", file!), content!);
      await prepareEngine(source, destination);
      expect(await readFile(join(destination, "external/xr/xr-slam.js"), "utf8")).toBe(
        "binary chunk",
      );
      expect(await readFile(join(destination, "external/xr/LICENSE"), "utf8")).toBe("license text");
      const manifest = JSON.parse(
        await readFile(join(destination, "external/engine-manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.files).toHaveLength(4);
      expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("fails when SLAM or attribution is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "audience-missing-"));
    try {
      await mkdir(join(root, "dist"));
      await expect(prepareEngine(root, join(root, "public"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
