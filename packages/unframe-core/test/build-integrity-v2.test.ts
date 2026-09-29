import { describe, expect, it } from "vitest";

import definition from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import renderBundle from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import assetSet from "../../contracts/presentation/v2/fixtures/asset-set-manifest.json";
import buildManifest from "../../contracts/presentation/v2/fixtures/build-manifest.json";
import { verifyBuildIntegrityV2 } from "../src/index.js";

const fixture = () => structuredClone({ definition, renderBundle, assetSet, buildManifest });

describe("verifyBuildIntegrityV2", () => {
  it("accepts build artifacts before a publication exists", () => {
    const input = fixture();
    expect(verifyBuildIntegrityV2(input)).toEqual({ valid: true, value: input, diagnostics: [] });
  });

  it("accepts revision zero for an unpublished local build", () => {
    const input = fixture();
    input.buildManifest.sourceDraftRevision = 0;
    expect(verifyBuildIntegrityV2(input)).toEqual({ valid: true, value: input, diagnostics: [] });
  });

  it("rejects a build for another presentation", () => {
    const input = fixture();
    input.buildManifest.presentationId = "another-presentation";
    expect(verifyBuildIntegrityV2(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "artifact.invalid", path: ["buildManifest", "presentationId"] }],
    });
  });

  it("rejects artifact hash drift without requiring a publication", () => {
    const input = fixture();
    input.buildManifest.assetSetHash = `sha256:${"0".repeat(64)}`;
    expect(verifyBuildIntegrityV2(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "hash.invalid", path: ["buildManifest", "assetSetHash"] }],
    });
  });

  it("rejects publication fields at the build boundary", () => {
    expect(verifyBuildIntegrityV2({ ...fixture(), publishedPresentation: {} })).toMatchObject({
      valid: false,
      diagnostics: [{ code: "structure.invalid", path: ["publishedPresentation"] }],
    });
  });

  it("rejects a missing descriptor for a referenced asset", () => {
    const input = fixture();
    input.assetSet.assets = {} as typeof input.assetSet.assets;
    const result = verifyBuildIntegrityV2(input);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "reference.invalid" })]),
    );
  });

  it("rejects a legacy definition at the build boundary", () => {
    const input = fixture();
    input.definition.schemaVersion = 1;
    expect(verifyBuildIntegrityV2(input)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "structure.invalid", path: ["definition", "schemaVersion"] }],
    });
  });

  it("rejects accessors without executing them", () => {
    let calls = 0;
    const input = Object.defineProperty(fixture(), "assetSet", {
      enumerable: true,
      get() {
        calls++;
        return assetSet;
      },
    });
    expect(verifyBuildIntegrityV2(input)).toMatchObject({ valid: false });
    expect(calls).toBe(0);
  });
});
