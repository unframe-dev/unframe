import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../../../../packages/contracts/presentation/fixtures/build-manifest.json";
import publishedPresentation from "../../../../../../packages/contracts/presentation/fixtures/published-presentation.json";
import { selectDeliveryArtifacts, type DeliverySourceInput } from "@unframe/unframe-core";
import { describe, expect, it } from "vitest";
import { normalizedCapability } from "../../../src/modules/publications/capability";

describe("production presentation capability profiles", () => {
  it("admits the Unity presentation renderers with bounded resource budgets", () => {
    const profile = normalizedCapability("quest-presentation-v2");
    expect(profile.renderers.bakedWeb.supported).toBe(true);
    expect(profile.renderers.nativeUi.supported).toBe(true);
    expect(profile.renderers.video).toMatchObject({ supported: true, features: ["audio", "h264"] });
    expect(profile.model).toMatchObject({ supported: true, formats: ["model/gltf-binary"] });
    expect(profile.limits.model.maxEncodedBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(profile.limits.nativeUi.maxNodesPerArtifact).toBeLessThanOrEqual(1024);
  });

  it("selects the full presentation fixture through the production admission boundary", () => {
    const selection = selectDeliveryArtifacts(
      {
        definition,
        renderBundle,
        assetSet,
        buildManifest,
        publishedPresentation,
        capability: normalizedCapability("quest-presentation-v2"),
      } as unknown as DeliverySourceInput,
      "presenter",
    );
    expect(selection.renderSurfaces.map((surface) => surface.rendererKind)).toEqual([
      "baked-web",
      "native-ui",
      "video",
    ]);
    expect(selection.visibleVariableIds).toEqual(["counter"]);
  });

  it("returns isolated profiles and keeps the baked-only profile restricted", () => {
    const profile = normalizedCapability("quest-presentation-v2");
    profile.renderers.video.features.push("av1");
    expect(normalizedCapability("quest-presentation-v2").renderers.video.features).not.toContain(
      "av1",
    );
    expect(normalizedCapability("quest-baked-web-v1").model.supported).toBe(false);
    expect(() => normalizedCapability("synthetic-test-only")).toThrow(
      "Unsupported device capability profile",
    );
  });
});
