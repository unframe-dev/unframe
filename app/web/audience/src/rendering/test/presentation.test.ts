import { afterEach, expect, it, vi } from "vitest";
import { AnimationClip, Group, Texture, Mesh, ShaderMaterial } from "three";
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
    presentation.applyAnimationFrame(view, view.clock.runtimeTimeMilliseconds);
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
