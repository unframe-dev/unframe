import { describe, it, expect, vi } from "vite-plus/test";
import {
  Group,
  AnimationClip,
  AnimationMixer,
  NumberKeyframeTrack,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Matrix4,
  Scene,
  Camera,
  Vector3,
} from "three";
import { createModelPresentation } from "../model-presentation";
import { modelFixture as fixture } from "./support/model-fixture";
describe("model presentation", () => {
  it("updates rendered model matrices after sampling a frame following a synchronized view", async () => {
    const { delivery, view } = fixture();
    view.nodeStates.model!.transform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const scene = new Scene();
    const contentRoot = new Group();
    contentRoot.position.x = 10;
    scene.add(contentRoot);
    const asset = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "model-mesh";
    asset.add(mesh);
    const presentation = await createModelPresentation({
      delivery,
      view,
      host: { contentRoot, setPresentationOrigin: vi.fn() },
      loadAsset: async () => ({ scene: asset, animations: [], dispose() {} }),
    });
    const sampled = structuredClone(view);
    sampled.nodeStates.model!.transform.position = [5, 0, 0];
    sampled.nodeStates.model!.transform.scale = [2, 2, 2];
    const rendered = presentation.root.getObjectByName("model-mesh")!;
    const camera = new Camera();
    const beforeRender = () => {
      presentation.applyAnimationFrame(sampled, 500);
      presentation.prepareRender(camera);
    };
    scene.onBeforeRender = beforeRender;
    for (let frame = 0; frame < 2; frame++) {
      expect(presentation.applyView(view)).toBe(true);
      // Three.js updates world matrices before invoking the scene's render callback.
      scene.updateMatrixWorld();
      beforeRender();
      expect(new Vector3().setFromMatrixPosition(rendered.matrixWorld).x).toBe(15);
      expect(new Vector3().setFromMatrixScale(rendered.matrixWorld).toArray()).toEqual([2, 2, 2]);
    }
    presentation.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  it("preloads models before their group and applies a held clip using the contract clip index", async () => {
    const { delivery, view } = fixture();
    delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.owner = {
      group: { groupId: "next-group" },
    };
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
    expect(presentation.root.getObjectByName("assetRoot")).toBeUndefined();
    view.progression.currentGroupId = "next-group";
    expect(presentation.applyView(view)).toBe(true);
    expect(presentation.root.getObjectByName("assetRoot")!.position.x).toBeCloseTo(1);
    presentation.dispose();
    presentation.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.contentRoot.children).toHaveLength(0);
  });
  it.each(["a", "b"])(
    "preloads asset %s for a later group and creates instances without loading again",
    async (assetId) => {
      const { delivery, view } = fixture();
      delivery.projectionProfile!.runtimeCatalog!.nodes!.push({
        nodeId: "next-model",
        parent: { stage: {} },
        owner: { group: { groupId: "next-group" } },
        model: { modelAssetId: assetId },
      });
      if (assetId === "b") {
        delivery.residency!.models!.models!.push({
          ...delivery.residency!.models!.models![0]!,
          assetId,
        });
        delivery.assetAccess!.push({ ...delivery.assetAccess![0]!, assetId });
      }
      const disposeAsset = vi.fn();
      const loadAsset = vi.fn(async () => ({
        scene: new Group(),
        animations: [],
        dispose: disposeAsset,
      }));
      const host = { contentRoot: new Group(), setPresentationOrigin: (_v: Matrix4) => {} };
      const p = await createModelPresentation({
        delivery,
        view,
        host,
        loadAsset,
      });
      const assetCount = assetId === "b" ? 2 : 1;
      expect(loadAsset).toHaveBeenCalledTimes(assetCount);
      expect(p.retainedCpuBytes).toBe(assetCount * 100);
      const model = p.root.getObjectByName("model-node:model")!;
      const initialPosition = model.position.toArray();
      const next = structuredClone(view);
      next.nodeStates.model!.transform.position = [9, 0, 0];
      expect(p.canApplyView(next)).toBe(true);
      expect(model.position.toArray()).toEqual(initialPosition);
      next.progression.currentGroupId = "next-group";
      next.nodeStates["next-model"] = structuredClone(next.nodeStates.model!);
      expect(p.canApplyView(next)).toBe(true);
      expect(p.root.getObjectByName("model-node:next-model")).toBeUndefined();
      expect(model.position.toArray()).toEqual(initialPosition);
      expect(p.applyView(next)).toBe(true);
      expect(p.root.getObjectByName("model-node:next-model")).toBeDefined();
      expect(p.applyView(view)).toBe(true);
      expect(p.applyView(next)).toBe(true);
      expect(loadAsset).toHaveBeenCalledTimes(assetCount);
      expect(disposeAsset).not.toHaveBeenCalled();
      p.dispose();
      expect(disposeAsset).toHaveBeenCalledTimes(assetCount);
      expect(p.canApplyView(view)).toBe(false);
      expect(p.applyView(view)).toBe(false);
    },
  );
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
      view: view as unknown as import("@unframe-dev/contracts/presentation").ParticipantRuntimeView,
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
  it("releases instances when their group leaves and retains model assets until disposal", async () => {
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
    const instance = p.root.getObjectByName("model-node:model")!.children[0]!.children[0] as Mesh;
    const disposeMaterial = vi.spyOn(instance.material as MeshBasicMaterial, "dispose");
    view.progression.currentGroupId = "different";
    expect(p.applyView(view)).toBe(true);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(p.retainedCpuBytes).toBe(100);
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
  it("budgets later group GLBs against the actual resource usage of already resident models", async () => {
    const { delivery, view } = budgetFixture();
    const node = structuredClone(delivery.projectionProfile!.runtimeCatalog!.nodes![0]!);
    node.nodeId = "second";
    node.model = { modelAssetId: "b" };
    node.owner = { group: { groupId: "later" } };
    delivery.projectionProfile!.runtimeCatalog!.nodes!.push(node);
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
    expect(load).toHaveBeenCalledTimes(2);
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
