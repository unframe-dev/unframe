import { describe, expect, it } from "vitest";
import type { PresentationDefinition } from "@unframe/unframe-core";
import { checkProjectAssets } from "../src/validation/check-project-assets.js";
import { checksumBytes, decodeCanonicalBase64 } from "../src/validation/source-assets.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=";
const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
const imageSurface = {
  content: { kind: "structured", nodes: { image: { kind: "image", assetId: "picture" } } },
  states: { initial: { contentOverrides: {} } },
} as unknown as PresentationDefinition["scene"]["surfaces"][string];

describe("checkProjectAssets", () => {
  it("rejects base64 above an explicit byte cap before decoding", () => {
    const originalAtob = globalThis.atob;
    let decoded = false;
    globalThis.atob = (value) => {
      decoded = true;
      return originalAtob(value);
    };
    try {
      expect(decodeCanonicalBase64("AQIDBA==", 3)).toBeUndefined();
      expect(decoded).toBe(false);
      expect(decodeCanonicalBase64("AQID", 2)).toBeUndefined();
      expect(decoded).toBe(false);
      expect(decodeCanonicalBase64("AQID", 3)).toEqual(Uint8Array.of(1, 2, 3));
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it("accepts a declared image carrier referenced by resolved content", () => {
    const result = checkProjectAssets(
      [{ kind: "asset-ref", assetId: "picture" }],
      {
        picture: {
          id: "picture",
          mediaType: "image/png",
          checksum: checksumBytes(pngBytes),
          encodedSizeBytes: pngBytes.length,
          dataBase64: pngBase64,
        },
      },
      { surface: imageSurface },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.assetSetAssets.picture?.mediaType).toBe("image/png");
  });

  it("rejects an image carrier whose media type does not match its bytes", () => {
    const result = checkProjectAssets(
      [{ kind: "asset-ref", assetId: "picture" }],
      {
        picture: {
          id: "picture",
          mediaType: "image/jpeg",
          checksum: checksumBytes(pngBytes),
          encodedSizeBytes: pngBytes.length,
          dataBase64: pngBase64,
        },
      },
      { surface: imageSurface },
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain("compiler-invalid-asset");
  });
});
