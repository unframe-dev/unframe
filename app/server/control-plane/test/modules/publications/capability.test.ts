import {
  audienceWebCapabilityProfileId,
  createAudienceWebCapabilityProfile,
} from "@unframe/contracts/presentation";
import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../../../../packages/contracts/presentation/fixtures/build-manifest.json";
import publishedPresentation from "../../../../../../packages/contracts/presentation/fixtures/published-presentation.json";
import {
  selectBuildArtifacts,
  selectDeliveryArtifacts,
  hashCanonicalJsonPayload,
  type BuildSourceInput,
  type DeliverySourceInput,
} from "@unframe/unframe-core";
import { assert, describe, expect, it } from "vitest";
import { normalizedCapability } from "../../../src/modules/publications/capability";

const mediaBuild = (): Omit<BuildSourceInput, "capability"> => {
  const source = structuredClone({
    definition,
    renderBundle,
    assetSet,
    buildManifest,
  }) as unknown as Omit<BuildSourceInput, "capability">;
  delete source.definition.scene.nodes["node-native"];
  delete source.definition.scene.surfaces.native;
  delete source.renderBundle.surfaces.native;
  return source;
};

const sealBuild = (source: Omit<BuildSourceInput, "capability">) => {
  source.renderBundle.definitionHash = hashCanonicalJsonPayload(source.definition);
  source.buildManifest.definitionHash = source.renderBundle.definitionHash;
  source.buildManifest.renderBundleHash = hashCanonicalJsonPayload(source.renderBundle);
  source.buildManifest.assetSetHash = hashCanonicalJsonPayload(source.assetSet);
};

describe("production presentation capability profiles", () => {
  it("admits the Unity presentation renderers with bounded resource budgets", () => {
    const profile = normalizedCapability("quest-presentation-v2");
    expect(profile.renderers.bakedWeb.supported).toBe(true);
    expect(profile.renderers.nativeUi.supported).toBe(true);
    expect(profile.renderers.video).toMatchObject({ supported: true, features: ["h264", "audio"] });
    expect(profile.model).toMatchObject({ supported: true, formats: ["model/gltf-binary"] });
    expect(profile.limits.model.maxEncodedBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(profile.limits.nativeUi.maxNodesPerArtifact).toBeLessThanOrEqual(1024);
  });

  it("preserves the existing media profile and v3 authority versions", () => {
    const media = normalizedCapability("unity-media-v1");
    const presentation = normalizedCapability("quest-presentation-v2");
    expect(media.schemaVersion).toBe(3);
    expect(presentation.schemaVersion).toBe(3);
    expect(presentation.contractVersions).toEqual(media.contractVersions);
    expect(presentation.model).toEqual(media.model);
    expect(presentation.renderers.video).toEqual(media.renderers.video);
    expect(presentation.renderers.bakedWeb).toEqual(media.renderers.bakedWeb);
    expect(presentation.limits.texture).toEqual(media.limits.texture);
    expect(presentation.limits.video).toEqual(media.limits.video);
    expect(presentation.limits.model).toEqual(media.limits.model);
    expect(media.renderers.nativeUi.supported).toBe(false);
    expect(media.renderers.video.supported).toBe(true);
    expect(media.model.supported).toBe(true);
    expect(media.limits.video.maxConcurrentDecoders).toBe(2);
  });

  it("admits two video surfaces supported by the existing media profile", () => {
    const source = mediaBuild();
    const node = source.definition.scene.nodes["node-video"]!;
    assert(node.kind === "surface");
    source.definition.scene.nodes["node-video-second"] = {
      ...structuredClone(node),
      id: "node-video-second",
      surfaceId: "video-second",
      order: 4,
    };
    source.definition.scene.surfaces["video-second"] = {
      ...structuredClone(source.definition.scene.surfaces.video!),
      id: "video-second",
      hostNodeId: "node-video-second",
    };
    const surface = structuredClone(source.renderBundle.surfaces.video!);
    surface.semanticSurfaceId = "video-second";
    surface.renderSurfaceIds = ["render-video-second"];
    const render = surface.renderSurfaces["render-video"]!;
    render.id = "render-video-second";
    render.semanticSurfaceId = "video-second";
    const artifact = render.artifacts["artifact-video"]!;
    artifact.id = "artifact-video-second";
    render.artifacts = { "artifact-video-second": artifact };
    render.stateBindings.default = { kind: "artifacts", artifactIds: ["artifact-video-second"] };
    surface.renderSurfaces = { "render-video-second": render };
    source.renderBundle.surfaces["video-second"] = surface;
    sealBuild(source);
    const media = selectBuildArtifacts(
      { ...source, capability: normalizedCapability("unity-media-v1") },
      "presenter",
    );
    expect(media.residency.maximumConcurrentDecoders).toBe(2);
    const presentation = selectBuildArtifacts(
      { ...source, capability: normalizedCapability("quest-presentation-v2") },
      "presenter",
    );
    expect(presentation.residency).toEqual(media.residency);
  });

  it("admits existing model and embedded texture budgets in the presentation profile", () => {
    const source = mediaBuild();
    const model = source.renderBundle.models["model-asset"]!;
    model.nodeCount = 8192;
    model.primitiveCount = 4096;
    model.textures = [{ pixelSize: [2, 2], bindingCount: 32 }];
    sealBuild(source);
    const media = selectBuildArtifacts(
      { ...source, capability: normalizedCapability("unity-media-v1") },
      "presenter",
    );
    expect(media.residency.modelTotals.nodeCount).toBe(8192);
    const presentation = selectBuildArtifacts(
      { ...source, capability: normalizedCapability("quest-presentation-v2") },
      "presenter",
    );
    expect(presentation.residency).toEqual(media.residency);
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

it("resolves the exact Audience implementation and resource policy", () => {
  expect(normalizedCapability(audienceWebCapabilityProfileId)).toEqual(
    createAudienceWebCapabilityProfile(),
  );
});

it("rejects unregistered Audience definitions", () => {
  expect(() => normalizedCapability(`audience-web_${"0".repeat(64)}`)).toThrow(RangeError);
});
