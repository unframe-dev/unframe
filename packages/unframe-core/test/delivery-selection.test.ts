import { assert, describe, expect, it } from "vitest";
import {
  assetSetManifestSchema,
  capabilityProfileSchema,
  presentationDefinitionSchema,
  renderBundleSchema,
  publishedPresentationSchema,
  buildManifestSchema,
  encodeWireMessage,
  decodeWireMessage,
} from "@unframe/contracts/presentation";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import assetSetFixture from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import capabilityFixture from "../../contracts/presentation/fixtures/capability-profile.json";
import publicationFixture from "../../contracts/presentation/fixtures/published-presentation.json";
import buildFixture from "../../contracts/presentation/fixtures/build-manifest.json";
import { buildRuntimeProjection, selectBuildArtifacts } from "../src/index.js";
import { selectDeliveryArtifacts } from "../src/delivery/selection.js";
import { buildProjectionProfile } from "../src/delivery/profile.js";
import { calculateProjectionProfileId } from "../src/delivery/profile-identity.js";
import { buildDeliveryManifest } from "../src/delivery/manifest.js";
import { hashCanonicalJsonPayload } from "../src/canonicalization/payload.js";

const definition = presentationDefinitionSchema.parse(definitionFixture);
const bundle = renderBundleSchema.parse(bundleFixture);
const assets = assetSetManifestSchema.parse(assetSetFixture);
const capability = capabilityProfileSchema.parse(capabilityFixture);
const publication = publishedPresentationSchema.parse(publicationFixture);
const build = buildManifestSchema.parse(buildFixture);
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
  it("builds the identical render and runtime projection without publication identity", () => {
    const { publishedPresentation: _, ...input } = baselineSource();
    const {
      projectionProfileId: _id,
      key: _key,
      ...expected
    } = buildProjectionProfile(baselineSource(), "presenter").profile;
    const result = buildRuntimeProjection(input, "presenter");
    expect(result.projection).toEqual(expected);
    expect(result.selection).toEqual(selectBuildArtifacts(input, "presenter"));
  });

  it("selects unpublished build artifacts with the same admission rules as Delivery", () => {
    const { publishedPresentation: _, ...input } = baselineSource();
    expect(selectBuildArtifacts(input, "presenter")).toEqual(
      selectDeliveryArtifacts(baselineSource(), "presenter"),
    );
  });
  it("rejects a hash-consistent publication whose compiled Surface size differs from its Definition", () => {
    const input = baselineSource((current) => {
      const surface = current.renderBundle.surfaces.baked;
      assert.isDefined(surface);
      surface.physicalSizeMeters = [3, 2];
    });

    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(
      "Compiled surface sizes must match the Definition.",
    );
  });

  it("keeps every Group in the catalog while admission remains role-specific", () => {
    const source = baselineSource((current) => {
      current.definition.flow.groups.later = {
        id: "later",
        initialStepId: "start",
        steps: { start: { id: "start", cues: [] } },
      };
      current.definition.scene.nodes["node-baked"]!.owner = { kind: "group", groupId: "later" };
      current.definition.scene.nodes["node-baked"]!.audience = { kind: "role", role: "presenter" };
    });
    const { publishedPresentation: _, ...input } = source;
    expect(buildRuntimeProjection(input, "presenter").projection.runtimeCatalog?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "node-baked", owner: { group: { groupId: "later" } } }),
      ]),
    );
    expect(buildRuntimeProjection(input, "viewer").projection.visibleSurfaceIds).toEqual([]);
  });

  it("rejects invalid unpublished build hashes, renderer tiers and budgets", () => {
    const { publishedPresentation: _, ...input } = baselineSource();
    const tampered = structuredClone(input);
    tampered.buildManifest.definitionHash = `sha256:${"0".repeat(64)}`;
    expect(() => selectBuildArtifacts(tampered, "presenter")).toThrow("Delivery build is invalid");
    const limited = structuredClone(input);
    limited.capability.limits.texture.maxGpuBytes = 100;
    expect(() => buildRuntimeProjection(limited, "presenter")).toThrow(
      "Texture GPU bytes exceeds capability limit",
    );
    const { publishedPresentation: _publication, ...unsupported } = source;
    expect(() => selectBuildArtifacts(unsupported, "presenter")).toThrow(
      "delivery-artifact-unavailable",
    );
  });

  it("rejects hash-consistent invalid Surface geometry for unpublished projection", () => {
    const { publishedPresentation: _, ...input } = baselineSource((current) => {
      current.renderBundle.surfaces.baked!.physicalSizeMeters = [3, 2];
    });
    expect(() => buildRuntimeProjection(input, "presenter")).toThrow(
      "Compiled surface sizes must match the Definition",
    );
  });

  it("rejects publication fields and accessor properties on the local build boundary", () => {
    expect(() => selectBuildArtifacts(baselineSource(), "presenter")).toThrow("input envelope");
    const { publishedPresentation: _, ...input } = baselineSource();
    let reads = 0;
    Object.defineProperty(input, "capability", {
      enumerable: true,
      get() {
        reads += 1;
        return capability;
      },
    });
    expect(() => selectBuildArtifacts(input, "presenter")).toThrow("plain JSON");
    expect(reads).toBe(0);
  });

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
    const encoded = encodeWireMessage("unframe.delivery.ProjectionProfileDescriptor", profile);
    const decoded = decodeWireMessage("unframe.delivery.ProjectionProfileDescriptor", encoded);
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
      "unframe.delivery.ProjectionProfileDescriptor",
      encodeWireMessage("unframe.delivery.ProjectionProfileDescriptor", layered),
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
      "unframe.delivery.DeliveryManifest",
      encodeWireMessage("unframe.delivery.DeliveryManifest", manifest),
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
