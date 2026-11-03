import { describe, expect, it } from "vite-plus/test";
import type { PresentationDefinition } from "@unframe-dev/presentation";
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
  it("identifies an unused presentation asset and explains where to remove or use it", () => {
    const result = checkProjectAssetReferences(
      [{ kind: "asset-ref", assetId: "opening-logo" }],
      {
        "opening-logo": {
          id: "opening-logo",
          mediaType: "image/png",
          checksum: checksumBytes(pngBytes),
          encodedSizeBytes: pngBytes.length,
        },
      },
      {},
    );
    expect(result.diagnostics).toEqual([
      {
        code: "compiler-asset-unreferenced",
        path: ["presentation", "assets", "opening-logo"],
        message:
          "Asset 'opening-logo' is declared in presentation.assets but no resolved content uses it. Reference it from a Text, Image, Video or Model, or remove it from presentation.assets and the asset catalog.",
      },
    ]);
  });

  it("identifies a catalog asset missing from the presentation and gives both corrections", () => {
    const result = checkProjectAssetReferences(
      [],
      {
        "opening-logo": {
          id: "opening-logo",
          mediaType: "image/png",
          checksum: checksumBytes(pngBytes),
          encodedSizeBytes: pngBytes.length,
        },
      },
      {},
    );
    expect(result.diagnostics).toEqual([
      {
        code: "compiler-asset-unreferenced",
        path: ["assets", "opening-logo"],
        message:
          "Asset 'opening-logo' is in the asset catalog but is not declared in presentation.assets. Add its assetRef to presentation.assets and reference it from content, or remove it from the asset catalog.",
      },
    ]);
  });

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
