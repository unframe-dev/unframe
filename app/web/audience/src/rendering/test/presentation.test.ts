import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  AnimationClip,
  Group,
  Texture,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  ShaderMaterial,
  Camera,
  Vector3,
} from "three";
import { applyRuntimeAnchors } from "../runtime-anchors";
import { evaluateAnimationView } from "../../runtime/animation-view";
import { createPresentation } from "../presentation";
import { createMediaFixtureScenario } from "../../dev/fixtures/media-scenario";
import { createRuntimeStore } from "../../runtime/runtime-store";
import { createPngTexturePool } from "../../assets/png-texture-pool";
import { loadPngTexture } from "../../assets/png-texture";
import { loadVideoAsset } from "../../assets/video-asset";
import { loadModelAsset } from "../../assets/model-asset";

vi.mock("../../assets/png-texture", () => ({ loadPngTexture: vi.fn() }));
vi.mock("../../assets/video-asset", () => ({ loadVideoAsset: vi.fn() }));
vi.mock("../../assets/model-asset", () => ({ loadModelAsset: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => new Response(new TextEncoder().encode(String(url)))),
  );
  const scenario = await createMediaFixtureScenario("https://audience.example.test");
  const store = createRuntimeStore(scenario.delivery);
  store.applyControl({ connectionSnapshot: scenario.snapshot });
  const parent = new Group();
  const video = {
    texture: new Texture(),
    synchronize: vi.fn<(seconds: number, playing: boolean) => void>(),
    playbackBlocked: false,
    resumePlayback: vi.fn(async () => {}),
    dispose: vi.fn(),
    releaseDecoder: vi.fn(),
  };
  vi.mocked(loadVideoAsset).mockResolvedValue(video as never);
  const model = {
    scene: new Group(),
    animations: [new AnimationClip("Rotate", 4, []), new AnimationClip("Bounce", 4, [])],
    dispose: vi.fn(),
    retainedCpuBytes: 1648,
    textureGpuBytes: 0,
    textureBindings: 0,
  };
  vi.mocked(loadModelAsset).mockResolvedValue(model);
  const png = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
  vi.mocked(loadPngTexture).mockResolvedValue(png);
  return { scenario, store, parent, video, model, png };
}
it.each(["gpuBytes", "bindings", "videoDecoders"] as const)(
  "rejects replacement media before decoding when retained %s exhaust the budget",
  async (resource) => {
    const { scenario, store, parent } = await setup();
    const limits = scenario.delivery.capabilityProfile!.limits!;
    const residentResources = { gpuBytes: 0, bindings: 0, videoDecoders: 0 };
    residentResources[resource] = Number(
      resource === "gpuBytes"
        ? limits.texture!.maxGpuBytes
        : resource === "bindings"
          ? limits.texture!.maxTextureBindings
          : limits.video!.maxConcurrentDecoders,
    );
    await expect(
      createPresentation({
        host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
        delivery: scenario.delivery,
        view: store.getSnapshot().view,
        residentResources,
      }),
    ).rejects.toThrow(/budget/);
    expect(loadVideoAsset).not.toHaveBeenCalled();
    expect(loadModelAsset).not.toHaveBeenCalled();
  },
);
it("combines PNG, independently controlled video and model under one committed root", async () => {
  const { scenario, store, parent, video, model, png } = await setup();
  const presentation = await createPresentation({
    host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
    delivery: scenario.delivery,
    view: store.getSnapshot().view,
  });
  expect(parent.children).toEqual([presentation.root]);
  expect(presentation.root.children.map((child) => child.name)).toEqual([
    "model-presentation-stage",
    "surface-presentation-stage",
  ]);
  presentation.setPlaybackEnabled(true);
  for (const action of scenario.actions) {
    store.applyControl(action.item);
    const view = store.getSnapshot().view;
    if (!view) continue;
    expect(presentation.applyView(view), action.label).toBe(true);
    expect(presentation.applyAnimationFrame(view, view.clock.runtimeTimeMilliseconds)).toEqual(
      evaluateAnimationView(scenario.delivery, view, view.clock.runtimeTimeMilliseconds).view,
    );
  }
  expect(loadPngTexture).toHaveBeenCalledTimes(1);
  expect(loadVideoAsset).toHaveBeenCalledTimes(1);
  expect(loadModelAsset).toHaveBeenCalledTimes(1);
  expect(video.synchronize.mock.calls.some(([, playing]) => playing === true)).toBe(true);
  expect(video.synchronize.mock.calls.some(([seconds, playing]) => seconds > 0 && !playing)).toBe(
    true,
  );
  presentation.dispose();
  presentation.dispose();
  expect(parent.children).toHaveLength(0);
  expect(video.dispose).toHaveBeenCalledTimes(1);
  expect(model.dispose).toHaveBeenCalledTimes(1);
  expect(png.dispose).toHaveBeenCalledTimes(1);
});
it("rolls back decoded media when a later resource fails without attaching a partial scene", async () => {
  const { scenario, store, parent, video } = await setup();
  vi.mocked(loadModelAsset).mockRejectedValue(new Error("bad model"));
  await expect(
    createPresentation({
      host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
      delivery: scenario.delivery,
      view: store.getSnapshot().view,
    }),
  ).rejects.toThrow("bad model");
  expect(parent.children).toHaveLength(0);
  expect(video.dispose).toHaveBeenCalledOnce();
});

it("uses resident slides for crossfades without reloading models or videos", async () => {
  const { scenario, store, parent, model, video } = await setup();
  const pool = await createPngTexturePool({
    delivery: scenario.delivery,
    uploadTexture: (texture) => texture.onUpdate?.(texture),
  });
  await pool.acquire("intro");
  const textures = vi.mocked(loadPngTexture).mock.calls.length;
  expect(textures).toBe(2);
  const presentation = await createPresentation({
    host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
    delivery: scenario.delivery,
    view: store.getSnapshot().view,
    pngTexturePool: pool,
  });
  const view = store.getSnapshot().view!;
  const runId = { assignmentEpoch: 1, runSequence: 1 };
  view.surfaceStates["intro-surface"] = { stateId: "slide-b", transitionRunId: runId };
  view.activeRuns.push({
    kind: "surfaceTransition",
    runId,
    owner: { kind: "group", groupId: "intro", groupEntryEpoch: 1 },
    cause: {
      cueId: "fade",
      causeEventId: "fade",
      groupId: "intro",
      groupEntryEpoch: 1,
      stepId: "start",
      stepEntryEpoch: 1,
    },
    completion: "blocking",
    startedAtRuntimeTimeMilliseconds: 0,
    surfaceId: "intro-surface",
    fromStateId: "slide-a",
    toStateId: "slide-b",
    durationMilliseconds: 2000,
    easing: "linear",
  });
  expect(presentation.applyView(view)).toBe(true);
  presentation.applyAnimationFrame(view, 1000);
  const materials: ShaderMaterial[] = [];
  presentation.root.traverse((object) => {
    if (object instanceof Mesh && object.material instanceof ShaderMaterial)
      materials.push(object.material);
  });
  expect(materials.some((material) => material.uniforms.progress!.value === 0.5)).toBe(true);
  expect(parent.children).toEqual([presentation.root]);
  expect(loadPngTexture).toHaveBeenCalledTimes(textures);
  expect(loadModelAsset).toHaveBeenCalledOnce();
  expect(loadVideoAsset).toHaveBeenCalledOnce();
  expect(model.dispose).not.toHaveBeenCalled();
  expect(video.dispose).not.toHaveBeenCalled();
  const videoAsset = vi.mocked(loadVideoAsset).mock.calls[0]![0];
  expect(presentation.resourceUsage).toEqual({
    gpuBytes: videoAsset.pixelSize[0] * videoAsset.pixelSize[1] * 4,
    bindings: 1,
    videoDecoders: 1,
  });
  presentation.dispose();
  expect(presentation.resourceUsage).toEqual({ gpuBytes: 0, bindings: 0, videoDecoders: 0 });
  pool.dispose();
});

it.each([false, true])(
  "renders spatial nodes through presentation lifecycle (media=%s)",
  async (media) => {
    const { scenario, store, parent } = await setup();
    const delivery = scenario.delivery;
    const view = store.getSnapshot().view!;
    const nodes = delivery.projectionProfile!.runtimeCatalog!.nodes!;
    if (!media) {
      delivery.projectionProfile!.runtimeCatalog!.nodes = nodes.filter((node) => !node.model);
      delivery.projectionProfile!.runtimeCatalog!.modelClips = [];
      delivery.projectionProfile!.renderSurfaces =
        delivery.projectionProfile!.renderSurfaces!.filter((surface) => surface.rendererKind !== 3);
      delivery.projectionProfile!.runtimeCatalog!.surfaces =
        delivery.projectionProfile!.runtimeCatalog!.surfaces!.filter(
          (surface) => !surface.hasVideo,
        );
      view.activeRuns = [];
      view.modelClipStates = {};
      view.mediaStates = {};
    }
    const base = structuredClone(Object.values(view.nodeStates)[0]!);
    base.transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    base.active = true;
    base.visible = true;
    base.opacity = 1;
    delivery.projectionProfile!.runtimeCatalog!.nodes!.push(
      {
        nodeId: "test-shape",
        parent: { presenterAnchor: { target: 2, followPosition: true, followRotation: false } },
        owner: { presentation: {} },
        shape: {
          box: { size: { x: 1, y: 1, z: 1 } },
          material: { color: { red: 1, green: 1, blue: 1, alpha: 1 } },
        },
      },
      {
        nodeId: "test-light",
        parent: { stage: {} },
        owner: { presentation: {} },
        light: {
          point: { color: { red: 1, green: 1, blue: 1 }, intensityCandela: 2, rangeMeters: 5 },
        },
      },
    );
    view.nodeStates["test-shape"] = structuredClone(base);
    view.nodeStates["test-light"] = structuredClone(base);
    const presentation = await createPresentation({
      host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
      delivery,
      view,
    });
    const shape = presentation.root.getObjectByName("spatial-node:test-shape")!.children[0] as Mesh;
    expect(shape).toBeInstanceOf(Mesh);
    expect(
      presentation.root.getObjectByName("spatial-node:test-light")!.children[0],
    ).toBeInstanceOf(PointLight);
    const dispose = vi.spyOn(shape.geometry, "dispose");
    view.nodeStates["test-shape"]!.opacity = 0.4;
    expect(presentation.applyView(view)).toBe(true);
    expect((shape.material as MeshBasicMaterial).opacity).toBe(0.4);
    delivery.projectionProfile!.runtimeCatalog!.timelines ??= [];
    delivery.projectionProfile!.runtimeCatalog!.timelines.push({
      timelineId: "spatial-move",
      durationMs: "1000",
      owner: { presentation: {} },
      tracks: [
        {
          target: { nodeId: "test-shape", property: 2 },
          keyframes: [
            { timeMs: "0", vector3: { value: { x: 0, y: 0, z: 0 } }, easingToNext: 1 },
            { timeMs: "1000", vector3: { value: { x: 2, y: 0, z: -4 } } },
          ],
        },
      ],
    });
    view.activeRuns.push({
      kind: "timeline",
      timelineId: "spatial-move",
      runId: { assignmentEpoch: 1, runSequence: 999 },
      owner: { kind: "presentation" },
      completion: "nonBlocking",
      startedAtRuntimeTimeMilliseconds: 0,
      cause: {
        cueId: "move",
        causeEventId: "move",
        groupId: "intro",
        groupEntryEpoch: 1,
        stepId: "start",
        stepEntryEpoch: 1,
      },
    });
    expect(presentation.applyView(view)).toBe(true);
    const sampled = presentation.applyAnimationFrame(view, 500);
    presentation.prepareRender(new Camera());
    expect(sampled.nodeStates["test-shape"]!.transform.position).toEqual([1, 0, -2]);
    expect(shape.getWorldPosition(new Vector3()).toArray()).toEqual([1, 0, -2]);
    view.nodeStates["test-shape"]!.transform = structuredClone(
      sampled.nodeStates["test-shape"]!.transform,
    );
    view.activeRuns = [];
    view.clock.lifecycle = { kind: "paused", reason: "presenter-paused" };
    view.frozenAnchors = [{ nodeId: "test-shape", position: [3, 2, -1] }];
    expect(presentation.applyView(view)).toBe(true);
    presentation.applyAnimationFrame(view, 500);
    applyRuntimeAnchors(presentation.root, delivery, view, {});
    presentation.prepareRender(new Camera());
    expect(shape.getWorldPosition(new Vector3()).toArray()).toEqual([4, 2, -3]);
    expect(shape.parent!.visible).toBe(true);
    view.clock.lifecycle = { kind: "running" };
    view.frozenAnchors = [];
    expect(presentation.applyView(view)).toBe(true);
    presentation.applyAnimationFrame(view, 500);
    applyRuntimeAnchors(presentation.root, delivery, view, {
      "test-shape": {
        nodeId: "test-shape",
        sample: { trackingFrameSequence: "2", position: { x: 5, y: 3, z: -2 } },
      },
    });
    presentation.prepareRender(new Camera());
    expect(shape.getWorldPosition(new Vector3()).toArray()).toEqual([6, 3, -4]);
    presentation.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(parent.children).toHaveLength(0);
  },
);
