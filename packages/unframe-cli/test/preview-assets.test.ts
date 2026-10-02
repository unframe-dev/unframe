import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPreviewImageAssets } from "../src/process/preview.js";

const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("loadPreviewImageAssets", () => {
  it("loads only the verified asset closure and checks exact encoded bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-preview-"));
    try {
      const assets = join(directory, "assets");
      await mkdir(assets);
      const selected = new TextEncoder().encode("png");
      await writeFile(join(assets, "selected.png"), selected);
      await writeFile(join(assets, "unlisted.png"), "secret");
      const descriptors = {
        selected: {
          mediaType: "image/png",
          encodedSizeBytes: selected.byteLength,
          checksum: checksum(selected),
        },
      };
      const result = await loadPreviewImageAssets(assets, descriptors);
      expect(result?.names).toEqual(["selected.png"]);
      expect([...result!.images.keys()]).toEqual(["/assets/selected.png"]);
      await writeFile(join(assets, "selected.png"), "png-plus");
      expect(await loadPreviewImageAssets(assets, descriptors)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects oversized sparse PNG before materializing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-preview-"));
    try {
      const assets = join(directory, "assets");
      await mkdir(assets);
      const file = await open(join(assets, "selected.png"), "w");
      try {
        await file.truncate(512 * 1024 * 1024);
      } finally {
        await file.close();
      }
      expect(
        await loadPreviewImageAssets(assets, {
          selected: {
            mediaType: "image/png",
            encodedSizeBytes: 3,
            checksum: checksum(new TextEncoder().encode("png")),
          },
        }),
      ).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
