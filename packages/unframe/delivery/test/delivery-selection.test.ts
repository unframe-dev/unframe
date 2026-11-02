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
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import assetSetFixture from "../../../contracts/presentation/fixtures/asset-set-manifest.json";
import capabilityFixture from "../../../contracts/presentation/fixtures/capability-profile.json";
import publicationFixture from "../../../contracts/presentation/fixtures/published-presentation.json";
import buildFixture from "../../../contracts/presentation/fixtures/build-manifest.json";
import { buildRuntimeProjection, selectBuildArtifacts } from "@unframe/delivery";
import { selectDeliveryArtifacts } from "../src/delivery/selection.js";
import { buildProjectionProfile } from "../src/delivery/profile.js";
import { calculateProjectionProfileId } from "../src/delivery/profile-identity.js";
import { buildDeliveryManifest } from "../src/delivery/manifest.js";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";

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
  it("delivers only sorted recognition kinds and referenced center-only Zones to the Presenter", () => {
    const input = baselineSource((current) => {
      current.definition.stage.zones = {
        z: { id: "z", owner: { kind: "presentation" }, center: [3, 2, 1] },
        a: { id: "a", owner: { kind: "presentation" }, center: [0, 0, 0] },
        unused: { id: "unused", owner: { kind: "presentation" }, center: [4, 4, 4] },
      };
      current.definition.flow.groups.intro!.steps.start!.cues = (
        [
          { kind: "gesture", gesture: "swipeUp" },
          { kind: "gesture", gesture: "swipeLeft" },
          { kind: "gesture", gesture: "swipeUp" },
          { kind: "zoneEdge", zoneId: "z", edge: "enter" },
          { kind: "zoneEdge", zoneId: "a", edge: "exit" },
        ] as const
      ).map((trigger, index) => ({
        id: `cue-${index}`,
        trigger: {
          ...trigger,
          actor: { kind: "presenter" },
        },
        priority: 0,
        order: index,
        firePolicy: { kind: "repeatable" },
        actions: [],
        next: { kind: "stay" },
      }));
    });
    const presenter = buildProjectionProfile(input, "presenter").profile;
    expect(presenter.runtimeCatalog?.presenterRecognition).toEqual({
      gestures: [1, 4],
      zones: [
        { zoneId: "a", center: { x: 0, y: 0, z: 0 } },
        { zoneId: "z", center: { x: 3, y: 2, z: 1 } },
      ],
    });
    expect(presenter.requiredRuntimeCapabilities).toEqual(expect.arrayContaining([7, 8, 9, 10]));
    const viewer = buildProjectionProfile(input, "viewer").profile;
    expect(viewer.runtimeCatalog).not.toHaveProperty("presenterRecognition");
    expect(viewer.requiredRuntimeCapabilities).not.toContain(7);
  });

  it.each([67_108_864, 67_126_671])("rejects model import CPU above %s bytes", (limit) => {
    const input = baselineSource((current) => {
      Object.assign(current.renderBundle.models["model-asset"]!, { peakLoadCpuBytes: 67_126_672 });
      current.capability.limits.texture.maxSerialLoadCpuBytes = limit;
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(/Model load CPU bytes/);
  });
  it("admits model import CPU exactly at its serial budget", () => {
    const input = baselineSource((current) => {
      Object.assign(current.renderBundle.models["model-asset"]!, { peakLoadCpuBytes: 67_126_672 });
      current.capability.limits.texture.maxSerialLoadCpuBytes = 67_126_672;
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).not.toThrow();
  });

  it.each(["maxGpuBytes", "maxTextureBindings"] as const)(
    "counts embedded model textures with baked textures against %s",
    (limit) => {
      const input = baselineSource((current) => {
        current.renderBundle.models["model-asset"]!.textures = [
          { pixelSize: [2, 2], bindingCount: 2 },
        ];
        current.capability.limits.texture[limit] = limit === "maxGpuBytes" ? 16_777_232 : 2;
      });
      expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow();
    },
  );
  it("admits embedded and baked textures exactly at the combined budgets", () => {
    const input = baselineSource((current) => {
      current.renderBundle.models["model-asset"]!.textures = [
        { pixelSize: [2, 2], bindingCount: 2 },
      ];
      current.capability.limits.texture.maxGpuBytes = 16_777_248;
      current.capability.limits.texture.maxTextureBindings = 3;
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).not.toThrow();
  });
  it("counts textures from distinct models together", () => {
    const input = baselineSource((current) => {
      const model = current.renderBundle.models["model-asset"]!;
      model.textures = [{ pixelSize: [2, 2], bindingCount: 2 }];
      const node = current.definition.scene.nodes.model!;
      assert(node.kind === "model");
      current.definition.scene.nodes["model-second"] = {
        ...structuredClone(node),
        id: "model-second",
        order: 5,
        assetId: "model-second",
      };
      current.renderBundle.models["model-second"] = {
        ...structuredClone(model),
        assetId: "model-second",
        checksum: `sha256:${"f".repeat(64)}`,
      };
      current.assetSet.assets["model-second"] = {
        ...structuredClone(current.assetSet.assets["model-asset"]!),
        checksum: `sha256:${"f".repeat(64)}`,
      };
      current.capability.limits.texture.maxTextureBindings = 4;
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(/Texture bindings/);
  });

  it("checks embedded model dimensions against the device profile", () => {
    const input = baselineSource((current) => {
      current.renderBundle.models["model-asset"]!.textures = [
        { pixelSize: [2048, 1], bindingCount: 2 },
      ];
      current.capability.limits.texture.maxTextureHeight = 1024;
      current.renderBundle.models["model-asset"]!.textures[0]!.pixelSize = [1, 2048];
      for (const surface of Object.values(current.renderBundle.surfaces))
        for (const render of Object.values(surface.renderSurfaces))
          for (const artifact of Object.values(render.artifacts))
            if (artifact.kind === "baked-web")
              for (const state of Object.values(artifact.states)) {
                state.texture.pixelSize = [2048, 1];
                state.texture.gpuBytes = 8192;
              }
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(/Model texture height/);
  });

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
    const { publishedPresentation: _publication, ...unsupported } = structuredClone(source);
    unsupported.capability.renderers.nativeUi.supported = false;
    unsupported.capability.renderers.nativeUi.features = [];
    expect(() => selectBuildArtifacts(unsupported, "presenter")).toThrow("No compatible artifact");
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

  it("admits non-video builds for video-disabled profiles and rejects video builds", () => {
    const limited = structuredClone(capability);
    limited.renderers.video.supported = false;
    limited.renderers.video.features = [];
    expect(() =>
      selectDeliveryArtifacts({ ...baselineSource(), capability: limited }, "presenter"),
    ).not.toThrow();
    expect(() => selectDeliveryArtifacts({ ...source, capability: limited }, "presenter")).toThrow(
      "No compatible artifact",
    );
  });

  it("selects native UI, model and video assets without changing their renderer contracts", () => {
    const selection = selectDeliveryArtifacts(source, "presenter");
    expect(selection.renderSurfaces.map((surface) => surface.rendererKind)).toEqual([
      "baked-web",
      "native-ui",
      "video",
    ]);
    expect(selection.assets.map((asset) => asset.assetId)).toEqual([
      "font",
      "model-asset",
      "texture",
      "video-asset",
    ]);
    expect(selection.visibleVariableIds).toEqual(["counter"]);
    expect(selection.residency.maximumConcurrentDecoders).toBe(1);
    expect(selection.residency.fontAssetIds).toEqual(["font"]);
  });

  it("enforces native UI and video resource budgets before delivery", () => {
    const native = structuredClone(source);
    native.capability.limits.nativeUi.maxNodesPerArtifact = 1;
    expect(() => selectDeliveryArtifacts(native, "presenter")).toThrow("Native UI");
    const video = structuredClone(source);
    video.capability.limits.video.maxEncodedBytes = 1;
    expect(() => selectDeliveryArtifacts(video, "presenter")).toThrow("Video");
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
    expect(profile.runtimeCatalog?.catalogContractVersion).toBe(3);
    expect((decoded.runtimeCatalog as Record<string, unknown>).catalogContractVersion).toBe(3);
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

describe("Model instance resource budgets", () => {
  const withTwoInstances = (aliasAsset = false, change?: (current: typeof source) => void) =>
    baselineSource((current) => {
      const node = current.definition.scene.nodes.model;
      assert.isDefined(node);
      assert(node.kind === "model");
      current.definition.scene.nodes["model-second"] = {
        ...structuredClone(node),
        id: "model-second",
        order: 5,
        assetId: aliasAsset ? "model-alias" : node.assetId,
      };
      if (aliasAsset) {
        current.renderBundle.models["model-alias"] = {
          ...structuredClone(current.renderBundle.models[node.assetId]!),
          assetId: "model-alias",
        };
        current.assetSet.assets["model-alias"] = structuredClone(
          current.assetSet.assets[node.assetId]!,
        );
      }
      change?.(current);
    });

  it.each([false, true])(
    "imports shared Model bytes once for serial CPU budget (alias %s)",
    (alias) => {
      const input = withTwoInstances(alias, (current) => {
        for (const model of Object.values(current.renderBundle.models))
          model.peakLoadCpuBytes = 67_126_672;
        current.capability.limits.texture.maxSerialLoadCpuBytes = 67_126_672;
      });
      expect(() => selectDeliveryArtifacts(input, "presenter")).not.toThrow();
    },
  );

  it.each([
    ["maxNodes", "nodeCount"],
    ["maxPrimitives", "primitiveCount"],
    ["maxVertices", "vertexCount"],
    ["maxTriangles", "triangleCount"],
  ] as const)("applies %s to every selected Model instance", (limit, field) => {
    const input = withTwoInstances(false, (current) => {
      current.capability.limits.model[limit] = current.renderBundle.models["model-asset"]![field];
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(`Model ${field}`);
  });

  it.each([false, true])(
    "expands wire totals while retaining unique encoded bytes with alias=%s",
    (aliasAsset) => {
      const { publishedPresentation: _, ...input } = withTwoInstances(aliasAsset, (current) => {
        const model = current.renderBundle.models["model-asset"]!;
        Object.assign(current.capability.limits.model, {
          maxAssets: 1,
          maxInstances: 2,
          maxEncodedBytes: model.encodedSizeBytes,
          maxNodes: model.nodeCount * 2,
          maxPrimitives: model.primitiveCount * 2,
          maxVertices: model.vertexCount * 2,
          maxTriangles: model.triangleCount * 2,
        });
      });
      const result = buildRuntimeProjection(input, "presenter");
      const model = input.renderBundle.models["model-asset"]!;
      expect(result.residency.models).toMatchObject({
        modelInstanceCount: "2",
        totalEncodedBytes: String(model.encodedSizeBytes),
        totalNodes: String(model.nodeCount * 2),
        totalPrimitives: String(model.primitiveCount * 2),
        totalVertices: String(model.vertexCount * 2),
        totalTriangles: String(model.triangleCount * 2),
      });
      expect(result.residency.models.models).toHaveLength(aliasAsset ? 2 : 1);
      const modelNodes = result.projection.runtimeCatalog!.nodes!.filter((node) => node.model);
      expect(modelNodes.map((node) => node.model!.modelAssetId).sort()).toEqual(
        aliasAsset ? ["model-alias", "model-asset"] : ["model-asset", "model-asset"],
      );
      for (const node of modelNodes) {
        const binding = result.residency.models.models.find(
          (model) => model.assetId === node.model!.modelAssetId,
        );
        expect(binding).toBeDefined();
      }
      for (const clip of result.projection.runtimeCatalog!.modelClips!)
        expect(
          result.residency.models.models.some((model) => model.assetId === clip.modelAssetId),
        ).toBe(true);
    },
  );
});

describe("Video Delivery admission", () => {
  const videoSource = (change?: (current: typeof source) => void) =>
    baselineSource((current) => {
      current.definition.scene.nodes["node-video"] = structuredClone(
        source.definition.scene.nodes["node-video"]!,
      );
      current.definition.scene.surfaces.video = structuredClone(
        source.definition.scene.surfaces.video!,
      );
      current.renderBundle.surfaces.video = structuredClone(source.renderBundle.surfaces.video!);
      current.assetSet.assets["video-asset"] = structuredClone(
        source.assetSet.assets["video-asset"]!,
      );
      change?.(current);
    });

  it("admits supported H264 Video artifacts and accounts for their decoder residency", () => {
    const { publishedPresentation: _, ...input } = videoSource();
    const result = buildRuntimeProjection(input, "presenter");
    expect(result.selection.residency.maximumConcurrentDecoders).toBe(1);
    expect(result.selection.assets.some((asset) => asset.assetId === "video-asset")).toBe(true);
    expect(result.residency.video.videos).toMatchObject([
      { assetId: "video-asset", decodedFrameBytes: "40000" },
    ]);
  });

  it("rejects Video when the participant profile has no Video decoder support", () => {
    const input = videoSource((current) => {
      current.capability.renderers.video.supported = false;
      current.capability.renderers.video.features = [];
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(
      "No compatible artifact for render-video/default.",
    );
  });
  it.each(["vp9", "av1"] as const)(
    "rejects %s before admitting an unsupported decoder path",
    (codec) => {
      const input = videoSource((current) => {
        const video =
          current.renderBundle.surfaces.video!.renderSurfaces["render-video"]!.artifacts[
            "artifact-video"
          ]!;
        assert(video.kind === "video");
        video.codec = codec;
        video.requiredFeatures = [codec];
      });
      expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow(
        "No compatible artifact for render-video/default.",
      );
    },
  );
  it.each(["loop", "fit"] as const)(
    "reuses source Video bytes across State-specific %s",
    (setting) => {
      const { publishedPresentation: _, ...input } = videoSource((current) => {
        const surface = current.definition.scene.surfaces.video!;
        const compiled = current.renderBundle.surfaces.video!;
        const render = compiled.renderSurfaces["render-video"]!;
        const base = render.artifacts["artifact-video"]!;
        assert(base.kind === "video");
        const loop = setting === "loop" ? !base.loop : base.loop;
        const fit = setting === "fit" ? "cover" : base.fit;
        assert(surface.content.kind === "structured");
        const videoNode = surface.content.nodes.video!;
        assert(videoNode.kind === "video");
        surface.states.variant = {
          ...surface.states.default!,
          id: "variant",
          contentOverrides: { video: { kind: "video", loop, style: { ...videoNode.style, fit } } },
        };
        compiled.semanticsByState.variant = structuredClone(compiled.semanticsByState.default!);
        compiled.interactionsByState.variant = [];
        render.artifacts.variant = { ...base, id: "variant", loop, fit };
        render.stateBindings.variant = { kind: "artifacts", artifactIds: ["variant"] };
      });
      const result = buildRuntimeProjection(input, "presenter");
      expect(
        result.selection.assets.filter((asset) => asset.assetId === "video-asset"),
      ).toHaveLength(1);
      expect(result.residency.video.videos).toHaveLength(1);
      expect(result.residency.video.totalEncodedBytes).toBe("64");
      expect(result.residency.video.maximumConcurrentDecoders).toBe("1");
    },
  );
  it("still rejects conflicting dimensions for the same Video checksum", () => {
    const input = videoSource((current) => {
      const surface = current.definition.scene.surfaces.video!;
      const compiled = current.renderBundle.surfaces.video!;
      const render = compiled.renderSurfaces["render-video"]!;
      const base = render.artifacts["artifact-video"]!;
      assert(base.kind === "video");
      surface.states.variant = { ...surface.states.default!, id: "variant" };
      compiled.semanticsByState.variant = structuredClone(compiled.semanticsByState.default!);
      compiled.interactionsByState.variant = [];
      render.artifacts.variant = { ...base, id: "variant", pixelSize: [200, 100] };
      render.stateBindings.variant = { kind: "artifacts", artifactIds: ["variant"] };
    });
    expect(() => selectDeliveryArtifacts(input, "presenter")).toThrow("asset-descriptor-conflict");
  });
});
