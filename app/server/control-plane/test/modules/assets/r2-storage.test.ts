import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { R2ObjectStorage } from "../../../src/adapters/assets/r2-storage";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const hex = "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6";

describe("R2ObjectStorage", () => {
  it("reads an R2 upload for finalize and removes it on delete", async () => {
    const storage = new R2ObjectStorage(env.ASSETS);
    const key = `assets/r2-${crypto.randomUUID()}`;
    await env.ASSETS.put(key, png, {
      httpMetadata: { contentType: "image/png" },
      sha256: new Uint8Array(hex.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16))),
    });
    await expect(storage.head(key)).resolves.toMatchObject({
      sizeBytes: 8,
      mediaType: "image/png",
      sha256Hex: hex,
    });
    await expect(storage.prefix(key)).resolves.toEqual(png);
    await storage.delete(key);
    await expect(storage.head(key)).resolves.toBeNull();
  });
});
