import { describe, expect, it } from "vitest";
import {
  assetSetManifestV2Schema,
  capabilityProfileV2Schema,
  presentationDefinitionV2Schema,
  renderBundleV2Schema,
  publishedPresentationV2Schema,
  buildManifestV2Schema,
  encodeWireMessage,
  decodeWireMessage,
} from "@unframe/contracts/presentation/v2";
import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import assetSetFixture from "../../contracts/presentation/v2/fixtures/asset-set-manifest.json";
import capabilityFixture from "../../contracts/presentation/v2/fixtures/capability-profile.json";
import publicationFixture from "../../contracts/presentation/v2/fixtures/published-presentation.json";
import buildFixture from "../../contracts/presentation/v2/fixtures/build-manifest.json";
import { selectDeliveryArtifacts } from "../src/delivery/selection.js";
import { buildProjectionProfile } from "../src/delivery/profile.js";
import { calculateProjectionProfileId } from "../src/delivery/profile-identity.js";
import { buildDeliveryManifest } from "../src/delivery/manifest.js";
import { hashCanonicalJsonPayload } from "../src/canonicalization/payload.js";

const definition = presentationDefinitionV2Schema.parse(definitionFixture);
const bundle = renderBundleV2Schema.parse(bundleFixture);
const assets = assetSetManifestV2Schema.parse(assetSetFixture);
const capability = capabilityProfileV2Schema.parse(capabilityFixture);
const publication = publishedPresentationV2Schema.parse(publicationFixture);
const build = buildManifestV2Schema.parse(buildFixture);
const source = {
  definition,
  renderBundle: bundle,
  assetSet: assets,
  buildManifest: build,
  publishedPresentation: publication,
  capability,
};
const baselineSource = (change?: (current: typeof source) => void) => {
  const current = structuredClone(source);
  delete current.definition.scene.nodes["node-native"];
  delete current.definition.scene.nodes["node-video"];
  delete current.definition.scene.surfaces.native;
  delete current.definition.scene.surfaces.video;
  delete current.renderBundle.surfaces.native;
  delete current.renderBundle.surfaces.video;
  delete current.assetSet.assets["video-asset"];
  change?.(current);
  current.renderBundle.definitionHash = hashCanonicalJsonPayload(current.definition);
  current.buildManifest.definitionHash = current.renderBundle.definitionHash;
  current.buildManifest.renderBundleHash = hashCanonicalJsonPayload(current.renderBundle);
  current.buildManifest.assetSetHash = hashCanonicalJsonPayload(current.assetSet);
  current.publishedPresentation.definitionHash = current.buildManifest.definitionHash;
  current.publishedPresentation.renderBundleHash = current.buildManifest.renderBundleHash;
  current.publishedPresentation.assetSetHash = current.buildManifest.assetSetHash;
  const { publicationManifestHash: _, ...payload } = current.publishedPresentation;
  current.publishedPresentation.publicationManifestHash = hashCanonicalJsonPayload(payload);
  return current;
};

describe("Delivery artifact selection and admission", () => {
  it("selects the first compatible candidate and only its transitive Asset closure", () => {
    const selection = selectDeliveryArtifacts(baselineSource(), "presenter");
    expect(selection.renderSurfaces.map((surface) => surface.states[0]?.artifact?.id)).toEqual([
      "artifact-baked",
    ]);
    expect(selection.assets.map((asset) => asset.assetId)).toEqual(["model-asset", "texture"]);
    expect(selection.visibleVariableIds).toEqual([]);
    expect(selection.residency.totalTextureGpuBytes).toBe(16_777_216);
    expect(selection.residency.maximumConcurrentDecoders).toBe(0);
  });

  it("rejects an incompatible first candidate without silently changing the rendering contract", () => {
    const limited = structuredClone(capability);
    limited.renderers.video.supported = false;
    limited.renderers.video.features = [];
    expect(() =>
      selectDeliveryArtifacts({ ...baselineSource(), capability: limited }, "presenter"),
    ).not.toThrow();
    expect(() => selectDeliveryArtifacts(source, "presenter")).toThrow(
      "delivery-artifact-unavailable",
    );
  });

  it("enforces selected texture GPU and serial CPU budgets", () => {
    const limited = structuredClone(capability);
    limited.limits.texture.maxGpuBytes = 100;
    expect(() =>
      selectDeliveryArtifacts({ ...baselineSource(), capability: limited }, "presenter"),
    ).toThrow("Texture GPU bytes exceeds capability limit.");
    limited.limits.texture.maxGpuBytes = capability.limits.texture.maxGpuBytes;
    limited.limits.texture.maxSerialLoadCpuBytes = 2 * 16_777_216 + 63;
    expect(() =>
      selectDeliveryArtifacts({ ...baselineSource(), capability: limited }, "presenter"),
    ).toThrow("Texture load CPU bytes exceeds capability limit.");
    limited.limits.texture.maxSerialLoadCpuBytes += 1;
    expect(() =>
      selectDeliveryArtifacts({ ...baselineSource(), capability: limited }, "presenter"),
    ).not.toThrow();
  });

  it("rejects invalid role, tampered publication, and accessor input", () => {
    expect(() => selectDeliveryArtifacts(baselineSource(), "operator" as never)).toThrow(
      "Delivery role must be presenter or viewer.",
    );
    const tampered = baselineSource();
    tampered.buildManifest.definitionHash = `sha256:${"0".repeat(64)}`;
    expect(() => selectDeliveryArtifacts(tampered, "presenter")).toThrow(
      "Delivery publication is invalid",
    );
    const hostile = baselineSource();
    Object.defineProperty(hostile, "capability", {
      enumerable: true,
      get() {
        throw new Error("executed");
      },
    });
    expect(() => selectDeliveryArtifacts(hostile, "presenter")).toThrow(
      "Delivery inputs must be plain JSON data properties.",
    );
  });

  it("rejects conflicting Model metadata under one checksum before deduplicating budgets", () => {
    const conflicted = baselineSource((current) => {
      const modelNode = current.definition.scene.nodes.model;
      if (!modelNode || modelNode.kind !== "model") throw new Error("Expected Model fixture.");
      current.definition.scene.nodes["model-alias"] = {
        ...structuredClone(modelNode),
        id: "model-alias",
        assetId: "model-alias",
        order: 5,
      };
      current.renderBundle.models["model-alias"] = {
        ...structuredClone(current.renderBundle.models["model-asset"]!),
        assetId: "model-alias",
        nodeCount: 100,
      };
      current.assetSet.assets["model-alias"] = structuredClone(
        current.assetSet.assets["model-asset"]!,
      );
    });
    expect(() => selectDeliveryArtifacts(conflicted, "presenter")).toThrow(
      "asset-descriptor-conflict",
    );
  });

  it("builds a profile that carries semantic, render, and runtime catalog data through Protobuf", () => {
    const { profile } = buildProjectionProfile(baselineSource(), "presenter");
    const encoded = encodeWireMessage("unframe.delivery.v2.ProjectionProfileDescriptor", profile);
    const decoded = decodeWireMessage("unframe.delivery.v2.ProjectionProfileDescriptor", encoded);
    expect(decoded.projectionProfileId).toBe(profile.projectionProfileId);
    expect(profile.runtimeCatalog?.catalogContractVersion).toBe(2);
    expect((decoded.runtimeCatalog as Record<string, unknown>).catalogContractVersion).toBe(2);
    expect(profile.projectionProfileId).toBe(calculateProjectionProfileId(profile));
    expect(decoded.projectionProfileId).toBe(calculateProjectionProfileId(decoded));
    const layered = structuredClone(profile);
    const secondLayer = structuredClone(layered.renderSurfaces![0]!);
    secondLayer.layer = 1;
    secondLayer.renderSurfaceId = `${secondLayer.renderSurfaceId}-layer-1`;
    layered.renderSurfaces!.push(secondLayer);
    layered.projectionProfileId = calculateProjectionProfileId(layered);
    const decodedLayered = decodeWireMessage(
      "unframe.delivery.v2.ProjectionProfileDescriptor",
      encodeWireMessage("unframe.delivery.v2.ProjectionProfileDescriptor", layered),
    );
    delete (decodedLayered.renderSurfaces as Record<string, unknown>[])[0]!.layer;
    expect(calculateProjectionProfileId(decodedLayered)).toBe(layered.projectionProfileId);
    expect((decoded.renderSurfaces as unknown[]).length).toBe(1);
    expect((decoded.semanticSurfaces as unknown[]).length).toBe(1);
    expect(
      ((decoded.runtimeCatalog as Record<string, unknown>).modelClips as unknown[]).length,
    ).toBe(1);
  });

  it("builds a participant manifest with exact selected access bindings", () => {
    const selected = selectDeliveryArtifacts(baselineSource(), "presenter");
    const grants = Object.fromEntries(
      selected.assets.map(({ assetId }) => [
        assetId,
        { url: `https://assets.example/${assetId}`, expiresAtUnixMilliseconds: 2000 },
      ]),
    );
    const manifest = buildDeliveryManifest({
      ...baselineSource(),
      capability,
      role: "presenter",
      sessionId: "session",
      participantId: "participant",
      assignmentEpoch: 1,
      issuedAtUnixMilliseconds: 1000,
      assetAccess: grants,
    });
    const decoded = decodeWireMessage(
      "unframe.delivery.v2.DeliveryManifest",
      encodeWireMessage("unframe.delivery.v2.DeliveryManifest", manifest),
    );
    expect((decoded.assetAccess as unknown[]).length).toBe(selected.assets.length);
    expect((decoded.projectionInstance as Record<string, unknown>).projectionProfileId).toBe(
      (decoded.projectionProfile as Record<string, unknown>).projectionProfileId,
    );
    expect(() =>
      buildDeliveryManifest({
        ...baselineSource(),
        capability,
        role: "presenter",
        sessionId: "session",
        participantId: "participant",
        assignmentEpoch: 1,
        issuedAtUnixMilliseconds: 1000,
        assetAccess: { ...grants, extra: grants.texture! },
      }),
    ).toThrow("exactly match");
  });
});
