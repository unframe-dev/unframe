import { afterEach, expect, it, vi } from "vitest";
import { AnimationClip, Group, Texture } from "three";
import { createPresentation } from "../presentation";
import { createMediaFixtureScenario } from "../../dev/fixtures/media-scenario";
import { createRuntimeStore } from "../../runtime/runtime-store";
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
  const png = { texture: new Texture(), dispose: vi.fn() };
  vi.mocked(loadPngTexture).mockResolvedValue(png);
  return { scenario, store, parent, video, model, png };
}
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
