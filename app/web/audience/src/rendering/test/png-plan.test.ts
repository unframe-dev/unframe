import { describe, expect, it } from "vitest";
import {
  assetSetManifestSchema,
  participantRuntimeViewSchema,
  decodeWireMessage,
  encodeWireMessage,
  renderBundleSchema,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import deliveryFixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import runtimeFixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import bundleFixture from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetsFixture from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import { buildPngPlan } from "../png-plan";

function pngFixture() {
  const delivery = decodeWireMessage(
    deliveryFixture.typeName,
    encodeWireMessage(deliveryFixture.typeName, deliveryFixture.value),
  ) as DeliveryManifestWire;
  const view = structuredClone(runtimeFixture);
  const profile = delivery.projectionProfile!;
  const nodeId = profile.runtimeCatalog!.nodes![0]!.nodeId!;
  const surfaceId = profile.runtimeCatalog!.surfaces![0]!.surfaceId!;
  view.projectionProfileId = profile.projectionProfileId!;
  view.nodeStates = {
    [nodeId]: structuredClone(runtimeFixture.nodeStates["node-baked"]),
  } as typeof view.nodeStates;
  view.surfaceStates = {
    [surfaceId]: { stateId: "reference-surface:default" },
  } as typeof view.surfaceStates;
  view.variables = {} as typeof view.variables;
  view.enabledLogicalInputs = [];
  return { delivery, view, nodeId, surfaceId };
}
describe("PNG contract plan", () => {
  it("plans presentation and current Group resources without requiring another Group's states", () => {
    const { delivery, view, nodeId, surfaceId } = pngFixture();
    const catalog = delivery.projectionProfile!.runtimeCatalog!;
    const node = catalog.nodes![0]!;
    const surface = catalog.surfaces![0]!;
    if (!node.surface) throw new Error("Expected surface fixture");
    node.owner = { group: { groupId: "intro" } };
    surface.owner = { group: { groupId: "intro" } };
    catalog.nodes!.push({
      ...structuredClone(node),
      nodeId: "next-node",
      owner: { group: { groupId: "next" } },
      surface: { semanticSurfaceId: "next-surface" },
    });
    catalog.surfaces!.push({
      ...structuredClone(surface),
      surfaceId: "next-surface",
      hostNodeId: "next-node",
      owner: { group: { groupId: "next" } },
    });
    for (const render of delivery.projectionProfile!.renderSurfaces!.slice()) {
      delivery.projectionProfile!.renderSurfaces!.push({
        ...structuredClone(render),
        renderSurfaceId: `next-${render.renderSurfaceId}`,
        semanticSurfaceId: "next-surface",
      });
    }
    catalog.nodes!.push({
      nodeId: "shared",
      owner: { presentation: {} },
      parent: { stage: {} },
      container: {},
    });
    view.nodeStates = {
      ...view.nodeStates,
      shared: structuredClone(view.nodeStates[nodeId as keyof typeof view.nodeStates]!),
    } as typeof view.nodeStates;
    const current = buildPngPlan(delivery, view);
    expect(current.nodes.map((node) => node.id)).toEqual([nodeId, "shared"]);
    expect(current.planes).toHaveLength(3);
    const next = structuredClone(view);
    next.progression.currentGroupId = "next";
    next.nodeStates = {
      "next-node": next.nodeStates[nodeId as keyof typeof next.nodeStates]!,
      shared: next.nodeStates["shared" as keyof typeof next.nodeStates]!,
    } as unknown as typeof next.nodeStates;
    next.surfaceStates = {
      "next-surface": next.surfaceStates[surfaceId as keyof typeof next.surfaceStates]!,
    } as unknown as typeof next.surfaceStates;
    const switched = buildPngPlan(delivery, next);
    expect(switched.nodes.map((node) => node.id)).toEqual(["next-node", "shared"]);
    expect(switched.planes.map((plane) => plane.nodeId)).toEqual([
      "next-node",
      "next-node",
      "next-node",
    ]);
    expect(switched.planes.every((plane) => plane.id.startsWith("next-"))).toBe(true);
  });
  it("rejects an active Group's spatial parent belonging to another Group", () => {
    const { delivery, view, nodeId } = pngFixture();
    const catalog = delivery.projectionProfile!.runtimeCatalog!;
    catalog.nodes![0]!.parent = { node: { nodeId: "other-parent" } };
    catalog.nodes!.push({
      nodeId: "other-parent",
      owner: { group: { groupId: "other" } },
      parent: { stage: {} },
      container: {},
    });
    view.nodeStates = {
      ...view.nodeStates,
      "other-parent": structuredClone(view.nodeStates[nodeId as keyof typeof view.nodeStates]!),
    } as typeof view.nodeStates;
    expect(() => buildPngPlan(delivery, view)).toThrow("missing spatial parent");
  });
  it("uses selected Delivery partitions with physical sizes, top-left logical coordinates and layer order", () => {
    const { delivery, view } = pngFixture();
    const plan = buildPngPlan(delivery, view);
    expect(plan.planes).toHaveLength(3);
    expect(plan.planes[0]).toMatchObject({
      width: 1,
      height: 0.5625,
      x: 0,
      y: 0,
      layer: 0,
      alphaMode: "opaque",
    });
    expect(plan.planes[1]).toMatchObject({
      width: 1792 / 1920,
      height: 392 / 1920,
      x: 0,
      layer: 1,
      alphaMode: "straight",
    });
    expect(plan.planes[1]!.y).toBeCloseTo((540 - 184 - 196) / 1920, 12);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.assets).toHaveLength(3);
  });
  it("supports contain, cover clipping with UV crop, and stretch", () => {
    const { delivery, view } = pngFixture();
    const surface = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!;
    surface.physicalSizeMeters = { x: 1, y: 1 };
    expect(buildPngPlan(delivery, view).planes[0]!.height).toBe(0.5625);
    surface.fit = 2;
    const cover = buildPngPlan(delivery, view).planes[0]!;
    expect(cover.width).toBe(1);
    expect(cover.height).toBe(1);
    expect(cover.uv[0]).toBeCloseTo(0.21875);
    expect(cover.uv[2]).toBeCloseTo(0.78125);
    surface.fit = 3;
    expect(buildPngPlan(delivery, view).planes[0]).toMatchObject({
      width: 1,
      height: 1,
      uv: [0, 0, 1, 1],
    });
  });
  it("uses runtime visibility and opacity without changing local transforms", () => {
    const { delivery, view, nodeId } = pngFixture();
    const state = view.nodeStates[nodeId as keyof typeof view.nodeStates]!;
    state.opacity = 0.4;
    state.transform.position = [1, 2, -3];
    const plan = buildPngPlan(delivery, view);
    expect(plan.planes[0]!.opacity).toBe(0.4);
    expect(plan.nodes[0]!.transform.position).toEqual([1, 2, -3]);
    state.visible = false;
    expect(buildPngPlan(delivery, view).planes).toHaveLength(0);
  });
  it("rejects projection mismatches, unsupported renderers, missing assets and budgets", () => {
    const { delivery, view } = pngFixture();
    expect(() => buildPngPlan(delivery, { ...view, projectionProfileId: "other" })).toThrow();
    delivery.assetAccess = [];
    expect(() => buildPngPlan(delivery, view)).toThrow();
    const next = pngFixture();
    next.delivery.projectionProfile!.renderSurfaces![0]!.rendererKind = 2;
    expect(() => buildPngPlan(next.delivery, next.view)).toThrow();
    const budget = pngFixture();
    budget.delivery.capabilityProfile!.limits!.texture!.maxGpuBytes = "1";
    expect(() => buildPngPlan(budget.delivery, budget.view)).toThrow();
  });
  it("counts shared PNG bindings once across multiple render partitions", () => {
    const { delivery, view } = pngFixture();
    const renders = delivery.projectionProfile!.renderSurfaces!;
    const texture = renders[0]!.artifacts![0]!.bakedWeb!.states![0]!.texture!;
    for (const render of renders.slice(1)) {
      render.artifacts![0]!.bakedWeb!.states![0]!.texture = structuredClone(texture);
    }
    delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "1";
    const plan = buildPngPlan(delivery, view);
    expect(plan.planes).toHaveLength(3);
    expect(plan.assets).toHaveLength(1);
    expect(new Set(plan.planes.map((plane) => plane.assetId))).toEqual(new Set([texture.assetId]));
  });
  it("shares identical PNG bytes across different asset IDs and access URLs", () => {
    const { delivery, view } = pngFixture();
    const renders = delivery.projectionProfile!.renderSurfaces!;
    const texture = renders[0]!.artifacts![0]!.bakedWeb!.states![0]!.texture!;
    const access = delivery.assetAccess!.find((asset) => asset.assetId === texture.assetId)!;
    for (const [index, render] of renders.slice(1).entries()) {
      const assetId = `alias-${index}`;
      render.artifacts![0]!.bakedWeb!.states![0]!.texture = { ...texture, assetId };
      delivery.assetAccess!.push({
        ...access,
        assetId,
        url: `https://assets.example.invalid/${assetId}`,
        expiresAtUnixMs: "4000",
      });
    }
    delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "1";
    const plan = buildPngPlan(delivery, view);
    expect(plan.planes).toHaveLength(3);
    expect(plan.assets).toHaveLength(1);
    expect(plan.planes.every((plane) => plane.assetId === texture.assetId)).toBe(true);
    expect(plan.assets[0]!.url).toBe(access.url);
  });
  it.each(["pixelSize", "encodedSizeBytes", "alphaMode"] as const)(
    "rejects conflicting %s metadata for the same PNG checksum",
    (field) => {
      const { delivery, view } = pngFixture();
      const renders = delivery.projectionProfile!.renderSurfaces!;
      const texture = structuredClone(renders[0]!.artifacts![0]!.bakedWeb!.states![0]!.texture!);
      const assetId = "alias";
      const access = delivery.assetAccess!.find((asset) => asset.assetId === texture.assetId)!;
      texture.assetId = assetId;
      if (field === "pixelSize") {
        texture.pixelSize = { width: "1", height: "1" };
        texture.decodedGpuBytes = "4";
      } else if (field === "encodedSizeBytes") {
        texture.encodedSizeBytes = String(Number(texture.encodedSizeBytes) + 1);
      } else {
        texture.alphaMode = texture.alphaMode === 1 ? 2 : 1;
      }
      renders[1]!.artifacts![0]!.bakedWeb!.states![0]!.texture = texture;
      delivery.assetAccess!.push({
        ...access,
        assetId,
        encodedSizeBytes: texture.encodedSizeBytes!,
      });
      expect(() => buildPngPlan(delivery, view)).toThrow("conflicting texture metadata");
    },
  );
  it("rejects two distinct selected PNG bindings when only one is allowed", () => {
    const { delivery, view } = pngFixture();
    delivery.projectionProfile!.renderSurfaces!.splice(2);
    delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "1";
    expect(() => buildPngPlan(delivery, view)).toThrow("texture budget exceeded");
  });
  it("accounts for all retained bitmaps while admitting the next serial decode", () => {
    const { delivery, view } = pngFixture();
    delivery.projectionProfile!.renderSurfaces!.reverse();
    delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes = "30000000";
    expect(() => buildPngPlan(delivery, view)).toThrow("CPU texture budget");
  });
  it("handles empty bindings and rejects missing runtime node states and transitions", () => {
    const { delivery, view, nodeId } = pngFixture();
    delivery.projectionProfile!.renderSurfaces![0]!.stateBindings![0] = {
      stateId: "reference-surface:default",
      empty: {},
    };
    expect(buildPngPlan(delivery, view).planes).toHaveLength(2);
    const missing = structuredClone(view);
    delete missing.nodeStates[nodeId as keyof typeof missing.nodeStates];
    expect(() => buildPngPlan(delivery, missing)).toThrow();
    expect(() =>
      buildPngPlan(delivery, { ...view, activeRuns: [{ kind: "surfaceTransition" }] }),
    ).toThrow();
  });
  it("resolves parent transforms, visibility and opacity and rejects spatial cycles", () => {
    const { delivery, view, nodeId } = pngFixture();
    const catalog = delivery.projectionProfile!.runtimeCatalog!;
    catalog.nodes![0]!.parent = { node: { nodeId: "parent" } };
    catalog.nodes!.push({
      nodeId: "parent",
      owner: { presentation: {} },
      parent: { stage: {} },
      container: {},
    });
    const state = structuredClone(view.nodeStates[nodeId as keyof typeof view.nodeStates]!);
    state.opacity = 0.5;
    state.transform.scale = [2, 1, 0.5];
    view.nodeStates = { ...view.nodeStates, parent: state } as typeof view.nodeStates;
    expect(buildPngPlan(delivery, view).nodes[0]!.id).toBe("parent");
    expect(buildPngPlan(delivery, view).planes[0]!.opacity).toBe(0.5);
    state.active = false;
    expect(buildPngPlan(delivery, view).planes).toHaveLength(0);
    catalog.nodes![1]!.parent = { node: { nodeId } };
    expect(() => buildPngPlan(delivery, view)).toThrow("cyclic");
  });
  it("uses existing RenderBundle and AssetSetManifest texture identities without a parallel format", () => {
    const bundle = renderBundleSchema.parse(bundleFixture);
    const assets = assetSetManifestSchema.parse(assetsFixture);
    const artifact =
      bundle.surfaces["baked"]!.renderSurfaces["render-baked"]!.artifacts["artifact-baked"]!;
    if (artifact.kind !== "baked-web") throw new Error("fixture");
    const texture = artifact.states["default"]!.texture;
    expect(assets.assets[texture.assetId]).toMatchObject({
      checksum: texture.checksum,
      encodedSizeBytes: texture.encodedSizeBytes!,
      mediaType: "image/png",
    });
    const { delivery, view } = pngFixture();
    const render = delivery.projectionProfile!.renderSurfaces![0]!;
    delivery.projectionProfile!.renderSurfaces = [render];
    render.artifacts![0]!.bakedWeb!.states![0]!.texture = {
      assetId: texture.assetId,
      checksum: texture.checksum,
      encodedSizeBytes: String(texture.encodedSizeBytes),
      pixelSize: { width: String(texture.pixelSize[0]), height: String(texture.pixelSize[1]) },
      alphaMode: 1,
      mipCount: 1,
      decodedGpuBytes: String(texture.gpuBytes),
    };
    const descriptor = assets.assets[texture.assetId]!;
    delivery.assetAccess = [
      {
        assetId: texture.assetId,
        checksum: descriptor.checksum,
        encodedSizeBytes: String(descriptor.encodedSizeBytes),
        mediaType: descriptor.mediaType,
        url: "https://assets.example.invalid/texture",
        expiresAtUnixMs: "2000",
      },
    ];
    expect(buildPngPlan(delivery, view).assets[0]).toMatchObject({
      assetId: texture.assetId,
      checksum: descriptor.checksum,
      encodedSizeBytes: descriptor.encodedSizeBytes,
    });
  });
});

function transitionFixture() {
  const value = pngFixture();
  const { delivery, view, surfaceId } = value;
  const nextState = "next-state";
  delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.reachableStateIds!.push(nextState);
  const source = structuredClone(
    delivery.assetAccess!.find(
      (asset) =>
        asset.assetId ===
        delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.bakedWeb!.states![0]!
          .texture!.assetId,
    )!,
  );
  source.assetId = "transition-target";
  source.checksum = `sha256:${"a".repeat(64)}`;
  delivery.assetAccess!.push(source);
  for (const render of delivery.projectionProfile!.renderSurfaces!) {
    const artifact = render.artifacts![0]!.bakedWeb!;
    render.stateBindings!.push({
      stateId: nextState,
      artifact: { artifactId: artifact.artifactId! },
    });
    artifact.states!.push({
      stateId: nextState,
      texture: {
        ...structuredClone(
          delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.bakedWeb!.states![0]!
            .texture!,
        ),
        assetId: source.assetId,
        checksum: source.checksum,
      },
    });
  }
  const run = {
    kind: "surfaceTransition" as const,
    surfaceId,
    fromStateId: "reference-surface:default",
    toStateId: nextState,
    durationMilliseconds: 1000,
    completion: "blocking" as const,
    easing: "linear" as const,
    runId: { assignmentEpoch: 1, runSequence: 1 },
    owner: { kind: "presentation" as const },
    cause: {
      cueId: "cue",
      causeEventId: "event",
      groupId: "intro",
      groupEntryEpoch: 1,
      stepId: "first",
      stepEntryEpoch: 1,
    },
    startedAtRuntimeTimeMilliseconds: 0,
  };
  return {
    ...value,
    view: {
      ...view,
      surfaceStates: { [surfaceId]: { stateId: run.toStateId, transitionRunId: run.runId } },
      activeRuns: [run],
    },
  };
}
it("loads both crossfade endpoints and includes them in the texture budget", () => {
  const { delivery, view } = transitionFixture();
  const plan = buildPngPlan(delivery, view);
  expect(plan.planes).toHaveLength(6);
  expect(plan.assets).toHaveLength(4);
  expect(plan.planes.filter((plane) => plane.transition?.phase === "to")).toHaveLength(3);
  delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "3";
  expect(() => buildPngPlan(delivery, view)).toThrow("texture budget");
});

it("rejects a crossfade Surface that needs more than eight distinct texture samplers", () => {
  const { delivery, view } = transitionFixture();
  const renders = delivery.projectionProfile!.renderSurfaces!;
  const template = structuredClone(renders[0]!);
  for (let index = 0; index < 6; index++) {
    const render = structuredClone(template);
    render.renderSurfaceId = `extra-${index}`;
    const texture = render.artifacts![0]!.bakedWeb!.states![0]!.texture!;
    const source = structuredClone(
      delivery.assetAccess!.find((asset) => asset.assetId === texture.assetId)!,
    );
    source.assetId = `extra-asset-${index}`;
    source.checksum = `sha256:${String(index + 1).repeat(64)}`;
    texture.assetId = source.assetId;
    texture.checksum = source.checksum;
    delivery.assetAccess!.push(source);
    renders.push(render);
  }
  expect(() => buildPngPlan(delivery, view)).toThrow("eight texture samplers");
});

it("plans PNG alongside model nodes and video partitions without drawing them twice", () => {
  const delivery = structuredClone(deliveryFixture.value) as DeliveryManifestWire;
  const view = participantRuntimeViewSchema.parse(runtimeFixture);
  const profile = delivery.projectionProfile!;
  const node = profile.runtimeCatalog!.nodes![0]!;
  const surface = profile.runtimeCatalog!.surfaces![0]!;
  view.projectionProfileId = profile.projectionProfileId!;
  view.nodeStates = {
    [node.nodeId!]: structuredClone(
      participantRuntimeViewSchema.parse(runtimeFixture).nodeStates["node-baked"]!,
    ),
  };
  view.surfaceStates = { [surface.surfaceId!]: { stateId: "reference-surface:default" } };
  view.variables = {};
  view.enabledLogicalInputs = [];
  profile.runtimeCatalog!.nodes!.push({
    nodeId: "model",
    parent: { stage: {} },
    owner: { presentation: {} },
    model: { modelAssetId: "model-asset" },
  });
  view.nodeStates.model = structuredClone(view.nodeStates[node.nodeId!]!);
  profile.renderSurfaces!.push({
    renderSurfaceId: "video",
    semanticSurfaceId: surface.surfaceId!,
    rendererKind: 3,
    artifactContractVersion: 1,
  });
  expect(buildPngPlan(delivery, view).nodes.some((value) => value.id === "model")).toBe(true);
  expect(buildPngPlan(delivery, view).planes).toHaveLength(3);
});

it.each(["delivery", "catalog"])("rejects obsolete v2 %s contracts before rendering", (kind) => {
  const { delivery, view } = pngFixture();
  if (kind === "delivery") delivery.deliveryContractVersion = 2;
  else delivery.projectionProfile!.runtimeCatalog!.catalogContractVersion = 2;
  expect(() => buildPngPlan(delivery, view)).toThrow();
});

it("rejects frozen Anchor display state before loading media", () => {
  const { delivery, view } = pngFixture();
  expect(() =>
    buildPngPlan(delivery, {
      ...view,
      frozenAnchors: [{ nodeId: Object.keys(view.nodeStates)[0]!, position: [1, 2, 3] }],
    }),
  ).toThrow(/Anchor/);
});
