import { describe, expect, it } from "vitest";
import type { PresentationDefinition } from "@unframe/presentation";
import { checkProjectAssetReferences } from "../src/validation/check-project-assets.js";
import { checksumBytes } from "./fixtures/checksum-bytes.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=";
const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
const imageSurface = {
  content: { kind: "structured", nodes: { image: { kind: "image", assetId: "picture" } } },
  states: { initial: { contentOverrides: {} } },
} as unknown as PresentationDefinition["scene"]["surfaces"][string];

describe("checkProjectAssetReferences", () => {
  it("accepts descriptor-only assets with independently supplied bytes", () => {
    const result = checkProjectAssetReferences(
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
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.assetSetAssets.picture?.encodedSizeBytes).toBe(pngBytes.length);
  });
  it("accepts a declared image carrier referenced by resolved content", () => {
    const result = checkProjectAssetReferences(
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
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.assetSetAssets.picture?.mediaType).toBe("image/png");
  });
});
