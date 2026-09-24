import { describe, expect, it } from "vitest";
import { demoDocument } from "./demo-document";
import { AssetResolutionError, MapAssetResolver } from "./asset-resolver";

describe("MapAssetResolver", () => {
  it("resolves a runtime URL without adding it to the document", () => {
    const resolver = new MapAssetResolver(new Map([["demo-model", "/fixtures/demo.glb"]]));

    expect(resolver.resolve("demo-model")).toBe("/fixtures/demo.glb");
    expect(JSON.stringify(demoDocument)).not.toContain("fixtures/demo.glb");
  });

  it("reports an unknown asset explicitly", () => {
    const resolver = new MapAssetResolver(new Map());

    expect(() => resolver.resolve("missing")).toThrow(AssetResolutionError);
  });
});
