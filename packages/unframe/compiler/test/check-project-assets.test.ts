import { describe, expect, it } from "vitest";
import type { PresentationDefinition } from "@unframe/presentation";
import { checkProjectAssets } from "../src/validation/check-project-assets.js";
import { checksumBytes } from "../src/validation/source-assets.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=";
const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
const imageSurface = {
  content: { kind: "structured", nodes: { image: { kind: "image", assetId: "picture" } } },
  states: { initial: { contentOverrides: {} } },
} as unknown as PresentationDefinition["scene"]["surfaces"][string];

describe("checkProjectAssets", () => {
  it("accepts descriptor-only assets with independently supplied bytes", () => {
    const result = checkProjectAssets(
      [{ kind: "asset-ref", assetId: "picture" }],
      {
        picture: {
          id: "picture",
          mediaType: "image/png",
          checksum: checksumBytes(pngBytes),
          encodedSizeBytes: pngBytes.length,
        },
      },
      { surface: imageSurface },
      { picture: pngBytes },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.assetSetAssets.picture?.encodedSizeBytes).toBe(pngBytes.length);
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
        },
      },
      { surface: imageSurface },
      { picture: pngBytes },
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
        },
      },
      { surface: imageSurface },
      { picture: pngBytes },
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain("compiler-invalid-asset");
  });
});
