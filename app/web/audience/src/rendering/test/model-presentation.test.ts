import { describe, it, expect, vi } from "vitest";
import {
  Group,
  AnimationClip,
  AnimationMixer,
  NumberKeyframeTrack,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Matrix4,
} from "three";
import { createModelPresentation } from "../model-presentation";
import { modelFixture as fixture } from "./support/model-fixture";
describe("model presentation", () => {
  it("loads models and applies a held clip using the contract clip index", async () => {
    const { delivery, view } = fixture();
    delivery.capabilityProfile!.model!.features = [1, 7];
    delivery.residency!.models!.models![0]!.animationClipCount = "1";
    delivery.residency!.models!.models![0]!.requiredFeatures = [1, 7];
    delivery.projectionProfile!.runtimeCatalog!.modelClips = [
      {
        modelNodeId: "model",
        modelAssetId: "a",
        clipId: "wave",
        sourceAnimationIndex: 0,
        durationMs: "1000",
      },
    ];
    view.modelClipStates = {
      model: { kind: "heldClip", clip: { clipId: "wave", positionMilliseconds: 500 } },
    } as typeof view.modelClipStates;
    const scene = new Group();
    scene.name = "assetRoot";
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const dispose = vi.fn();
    const host = { contentRoot: new Group(), setPresentationOrigin: vi.fn() };
    const presentation = await createModelPresentation({
      delivery,
      view,
      host,
      loadAsset: async () => ({
        scene,
        animations: [
          new AnimationClip("wave", 1, [
            new NumberKeyframeTrack("assetRoot.position[x]", [0, 1], [0, 2]),
          ]),
        ],
        dispose,
      }),
    });
    expect(presentation.root.getObjectByName("assetRoot")!.position.x).toBeCloseTo(1);
    presentation.dispose();
    presentation.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.contentRoot.children).toHaveLength(0);
  });
  it("returns false for a newly required model without mutating the current scene", async () => {
    const { delivery, view } = fixture();
    const host = { contentRoot: new Group(), setPresentationOrigin: (_v: Matrix4) => {} };
    const p = await createModelPresentation({
      delivery,
      view,
      host,
      loadAsset: async () => ({ scene: new Group(), animations: [], dispose() {} }),
    });
    expect(p.applyView(view)).toBe(true);
    p.dispose();
    expect(p.applyView(view)).toBe(false);
  });
});
describe("model runtime clock", () => {
  async function setup() {
    const { delivery, view } = fixture();
    delivery.capabilityProfile!.model!.features = [1, 7];
    delivery.residency!.models!.models![0]!.animationClipCount = "1";
    delivery.residency!.models!.models![0]!.requiredFeatures = [1, 7];
    delivery.projectionProfile!.runtimeCatalog!.modelClips = [
      {
        modelNodeId: "model",
        modelAssetId: "a",
        clipId: "wave",
        sourceAnimationIndex: 0,
        durationMs: "1000",
      },
    ];
    const scene = new Group();
    scene.name = "animated";
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const presentation = await createModelPresentation({
      delivery,
      view,
      host: { contentRoot: new Group(), setPresentationOrigin() {} },
      loadAsset: async () => ({
        scene,
        animations: [
          new AnimationClip("wave", 1, [
            new NumberKeyframeTrack("animated.position[x]", [0, 1], [0, 2]),
          ]),
        ],
        dispose() {},
      }),
    });
    return {
      presentation,
      view: view as unknown as import("@unframe/contracts/presentation").ParticipantRuntimeView,
    };
  }
  it("samples from reference position and applies speed only to elapsed time", async () => {
    const { presentation, view } = await setup();
    view.modelClipStates.model = { kind: "active", runId: { assignmentEpoch: 1, runSequence: 1 } };
    view.activeRuns = [
      {
        kind: "modelClip",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        modelNodeId: "model",
        owner: { kind: "presentation" },
        cause: {
          cueId: "c",
          causeEventId: "e",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "s",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 100,
        completion: "nonBlocking",
        phase: {
          kind: "single",
          clip: {
            clipId: "wave",
            playback: {
              kind: "playing",
              positionAtReferenceMilliseconds: 200,
              referenceRuntimeTimeMilliseconds: 100,
            },
            speed: 2,
            loop: false,
          },
        },
      },
    ];
    presentation.applyAnimationFrame(view, 200);
    expect(presentation.root.getObjectByName("animated")!.position.x).toBeCloseTo(0.8);
    presentation.dispose();
  });
  it("holds a paused animation and restores the default pose after stop", async () => {
    const { presentation, view } = await setup();
    view.modelClipStates.model = {
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 250 },
    };
    presentation.applyAnimationFrame(view, 9000);
    expect(presentation.root.getObjectByName("animated")!.position.x).toBeCloseTo(0.5);
    view.modelClipStates.model = { kind: "defaultPose" };
    presentation.applyAnimationFrame(view, 10000);
    expect(presentation.root.getObjectByName("animated")!.position.x).toBeCloseTo(0);
    presentation.dispose();
  });
  it("blends held positions of the same animation without overwriting either action", async () => {
    const { presentation, view } = await setup();
    view.modelClipStates.model = {
      kind: "heldBlend",
      from: { clipId: "wave", positionMilliseconds: 200 },
      to: { clipId: "wave", positionMilliseconds: 800 },
      toWeight: 0.25,
    };
    presentation.applyAnimationFrame(view, 9000);
    expect(presentation.root.getObjectByName("animated")!.position.x).toBeCloseTo(0.7);
    presentation.dispose();
  });
  it("applies cumulative node opacity and visibility without changing truth", async () => {
    const { presentation, view } = await setup();
    view.nodeStates.model!.opacity = 0.4;
    view.nodeStates.model!.visible = false;
    presentation.applyAnimationFrame(view, 0);
    const root = presentation.root.getObjectByName("animated")!;
    expect(root.visible).toBe(false);
    expect((root.children[0] as Mesh<BoxGeometry, MeshBasicMaterial>).material.opacity).toBe(0.4);
    expect(view.nodeStates.model!.opacity).toBe(0.4);
    presentation.dispose();
  });
});
describe("model lifetime", () => {
  it("releases model assets and cloned materials after the owning Group leaves", async () => {
    const { delivery, view } = fixture();
    delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.owner = {
      group: { groupId: view.progression.currentGroupId },
    };
    const scene = new Group();
    const material = new MeshBasicMaterial();
    scene.add(new Mesh(new BoxGeometry(), material));
    const dispose = vi.fn();
    const p = await createModelPresentation({
      delivery,
      view,
      host: { contentRoot: new Group(), setPresentationOrigin() {} },
      loadAsset: async () => ({ scene, animations: [], dispose }),
    });
    view.progression.currentGroupId = "different";
    expect(p.applyView(view)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(p.retainedCpuBytes).toBe(0);
    p.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
describe("model aggregate resource budgets", () => {
  function budgetFixture() {
    const f = fixture();
    f.delivery.capabilityProfile!.limits!.texture = {
      tierId: "test",
      maxTextureWidth: "1024",
      maxTextureHeight: "1024",
      maxTexturePixels: "1048576",
      maxTextureBindings: "4",
      maxGpuBytes: "1000",
      maxSerialLoadCpuBytes: "1000",
      maxEncodedCacheBytes: "1000",
      encodedCacheReserveBytes: "1",
    };
    return f;
  }
  it("subtracts reserved PNG and video resources before loading a model", async () => {
    const { delivery, view } = budgetFixture();
    const load = vi.fn(async (asset: import("../../assets/model-asset").ModelAsset) => {
      expect(asset.textureBudget).toMatchObject({
        maxGpuBytes: 700,
        maxBindings: 2,
        maxCpuBytes: 700,
      });
      return {
        scene: new Group(),
        animations: [],
        retainedCpuBytes: 200,
        textureGpuBytes: 100,
        textureBindings: 1,
        dispose() {},
      };
    });
    const p = await createModelPresentation({
      delivery,
      view,
      host: { contentRoot: new Group(), setPresentationOrigin() {} },
      loadAsset: load,
      reservedTextureResources: { gpuBytes: 300, bindings: 2, cpuBytes: 300 },
    });
    expect(p.resourceUsage).toEqual({ gpuBytes: 100, bindings: 1, cpuBytes: 200 });
    p.dispose();
    expect(p.resourceUsage).toEqual({ gpuBytes: 0, bindings: 0, cpuBytes: 0 });
  });
  it("rejects a model before loading if reserved CPU leaves insufficient encoded space", async () => {
    const { delivery, view } = budgetFixture();
    const load = vi.fn();
    await expect(
      createModelPresentation({
        delivery,
        view,
        host: { contentRoot: new Group(), setPresentationOrigin() {} },
        loadAsset: load,
        reservedTextureResources: { gpuBytes: 0, bindings: 0, cpuBytes: 950 },
      }),
    ).rejects.toThrow(/budget/);
    expect(load).not.toHaveBeenCalled();
  });
  it("reduces the second GLB budget by the actual first model resource usage", async () => {
    const { delivery, view } = budgetFixture();
    const node = structuredClone(delivery.projectionProfile!.runtimeCatalog!.nodes![0]!);
    node.nodeId = "second";
    node.model = { modelAssetId: "b" };
    delivery.projectionProfile!.runtimeCatalog!.nodes!.push(node);
    view.nodeStates = { ...view.nodeStates, second: structuredClone(view.nodeStates.model!) };
    delivery.assetAccess!.push({ ...delivery.assetAccess![0], assetId: "b" });
    delivery.residency!.models!.models!.push({
      ...delivery.residency!.models!.models![0],
      assetId: "b",
    });
    const load = vi.fn(async (asset: import("../../assets/model-asset").ModelAsset) => {
      if (asset.assetId === "b")
        expect(asset.textureBudget).toMatchObject({
          maxGpuBytes: 600,
          maxBindings: 3,
          maxCpuBytes: 800,
        });
      return {
        scene: new Group(),
        animations: [],
        retainedCpuBytes: 200,
        textureGpuBytes: 400,
        textureBindings: 1,
        dispose() {},
      };
    });
    const p = await createModelPresentation({
      delivery,
      view,
      host: { contentRoot: new Group(), setPresentationOrigin() {} },
      loadAsset: load,
    });
    expect(p.resourceUsage).toEqual({ gpuBytes: 800, bindings: 2, cpuBytes: 400 });
    p.dispose();
  });
  it("disposes all loaded models when actual total resources exceed the budget", async () => {
    const { delivery, view } = budgetFixture();
    const dispose = vi.fn();
    await expect(
      createModelPresentation({
        delivery,
        view,
        host: { contentRoot: new Group(), setPresentationOrigin() {} },
        loadAsset: async () => ({
          scene: new Group(),
          animations: [],
          retainedCpuBytes: 1001,
          dispose,
        }),
      }),
    ).rejects.toThrow(/budget/);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("model animation storage", () => {
  it("creates independent action wrappers while sharing immutable keyframe arrays", async () => {
    const { delivery, view } = fixture();
    delivery.capabilityProfile!.model!.features = [1, 7];
    delivery.residency!.models!.models![0]!.animationClipCount = "1";
    delivery.residency!.models!.models![0]!.requiredFeatures = [1, 7];
    delivery.projectionProfile!.runtimeCatalog!.modelClips = [
      {
        modelNodeId: "model",
        modelAssetId: "a",
        clipId: "wave",
        sourceAnimationIndex: 0,
        durationMs: "1000",
      },
    ];
    const source = new AnimationClip("wave", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 2]),
    ]);
    const action = vi.spyOn(AnimationMixer.prototype, "clipAction");
    try {
      const p = await createModelPresentation({
        delivery,
        view,
        host: { contentRoot: new Group(), setPresentationOrigin() {} },
        loadAsset: async () => ({ scene: new Group(), animations: [source], dispose() {} }),
      });
      const wrappers = action.mock.calls.map((call) => call[0]) as AnimationClip[];
      expect(wrappers).toHaveLength(2);
      expect(wrappers[0]!.uuid).not.toBe(wrappers[1]!.uuid);
      for (const wrapper of wrappers) {
        expect(wrapper).not.toBe(source);
        expect(wrapper.tracks).toBe(source.tracks);
        expect(wrapper.tracks[0]!.times).toBe(source.tracks[0]!.times);
        expect(wrapper.tracks[0]!.values).toBe(source.tracks[0]!.values);
      }
      p.dispose();
    } finally {
      action.mockRestore();
    }
  });
});
