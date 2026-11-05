import { Camera, Group, Texture } from "three";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe-dev/contracts/presentation";
import * as runtimeEffects from "../../rendering/runtime-effects";
import { createPresentation } from "../../rendering/presentation";
import { createPresentationSession } from "../presentation-session";
import { createPngTexturePool } from "../../assets/png-texture-pool";
import { createRuntimePlayback } from "../../runtime/playback";

vi.mock("../../rendering/presentation", () => ({
  createPresentation: vi.fn(),
  hasMediaResources: (delivery: DeliveryManifestWire) =>
    !!delivery.projectionProfile?.renderSurfaces?.some((surface) => surface.rendererKind === 3),
}));
vi.mock("../../assets/png-texture-pool", () => ({ createPngTexturePool: vi.fn() }));
vi.mock("../../runtime/playback", () => ({ createRuntimePlayback: vi.fn() }));
import runtimeFixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
const view = participantRuntimeViewSchema.parse(runtimeFixture);
const delivery = {} as DeliveryManifestWire;
const host = { contentRoot: new Group() } as never;
function loaded() {
  return {
    root: new Group(),
    dispose: vi.fn(),
    applyView: vi.fn(() => false),
    updatePngTextures: vi.fn(),
    prepareRender: vi.fn(),
    applyAnimationFrame: vi.fn((next) => next),
    setPlaybackEnabled: vi.fn(),
    resumePlayback: vi.fn(async () => {}),
    playbackBlocked: false,
    retainedCpuBytes: 4096,
    releaseVideoDecoders: vi.fn(),
    resourceUsage: { gpuBytes: 100, bindings: 1, videoDecoders: 1 },
  } as unknown as Awaited<ReturnType<typeof createPresentation>>;
}
function setup() {
  const renderer = { resetState: vi.fn(), initTexture: vi.fn() };
  const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked: vi.fn() });
  session.attachScene(host, renderer);
  return { renderer, session };
}
beforeEach(() => {
  vi.mocked(createPresentation).mockReset();
  vi.mocked(createPngTexturePool).mockReset();
  vi.mocked(createPngTexturePool).mockImplementation(async () => ({
    assets: [],
    residentAssets: [],
    canAcquire: vi.fn(() => true),
    acquire: vi.fn(async () => ({ assets: [], release: vi.fn() })),
    retainedCpuBytes: 0,
    gpuBytes: 0,
    dispose: vi.fn(),
    getTexture: vi.fn(),
    loadTexture: vi.fn(),
  }));
  vi.mocked(createRuntimePlayback).mockReset();
  vi.mocked(createRuntimePlayback).mockImplementation(
    (options) =>
      ({
        prepareFrame: vi.fn(),
        dispose: vi.fn(options.clear),
      }) as never,
  );
});
describe("presentation session resources", () => {
  it("requires an attached XR host and rejects use after disposal", async () => {
    const { session } = setup();
    session.detachScene(host);
    await expect(session.present(delivery, view)).rejects.toThrow("scene");
    session.dispose();
    expect(() => session.attachScene(host, { resetState() {}, initTexture() {} })).toThrow(
      "disposed",
    );
    await expect(session.present(delivery, view)).rejects.toThrow("scene");
  });
  it("keeps the old PNG while loading and accounts for its retained memory", async () => {
    const previous = loaded();
    vi.mocked(createPresentation)
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new Error("budget"));
    const { session } = setup();
    await session.present(delivery, view);
    await expect(session.present(delivery, view)).rejects.toThrow("budget");
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentCpuBytes).toBe(4096);
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentResources).toEqual({
      gpuBytes: 100,
      bindings: 1,
      videoDecoders: 1,
    });
    expect(previous.dispose).not.toHaveBeenCalled();
    session.dispose();
    expect(previous.dispose).toHaveBeenCalledOnce();
  });
  it("counts a shared resident PNG pool once while preparing replacement media", async () => {
    vi.mocked(createPngTexturePool).mockResolvedValueOnce({
      assets: [{ checksum: "shared" }],
      residentAssets: [{ checksum: "shared" }],
      canAcquire: vi.fn(() => true),
      acquire: vi.fn(async () => ({ assets: [], release: vi.fn() })),
      retainedCpuBytes: 0,
      gpuBytes: 400,
      dispose: vi.fn(),
      getTexture: vi.fn(),
      loadTexture: vi.fn(),
    } as never);
    vi.mocked(createPresentation).mockResolvedValue(loaded());
    const { session } = setup();
    await session.present(delivery, view);
    await session.present(delivery, view);
    expect(createPngTexturePool).toHaveBeenCalledOnce();
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentResources).toEqual({
      gpuBytes: 100,
      bindings: 1,
      videoDecoders: 1,
    });
    session.dispose();
  });
  it("resets the shared GL state before applying a view or disposing materials", async () => {
    const events: string[] = [];
    const current = loaded();
    vi.mocked(current.applyView).mockImplementation(() => {
      events.push("apply");
      return true;
    });
    vi.mocked(current.dispose).mockImplementation(() => {
      events.push("dispose");
    });
    vi.mocked(createPresentation).mockResolvedValue(current);
    const { session, renderer } = setup();
    renderer.resetState.mockImplementation(() => {
      events.push("reset");
    });
    await session.present(delivery, view);
    events.length = 0;
    await session.present(delivery, view);
    expect(events).toEqual(["reset", "apply"]);
    events.length = 0;
    session.detachScene(host);
    expect(events).toEqual(["reset", "dispose"]);
  });
  it("drains canceled work before loading a replacement in a new scene", async () => {
    const discarded = loaded();
    const next = loaded();
    let finish!: (value: typeof discarded) => void;
    vi.mocked(createPresentation)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(next);
    const { session } = setup();
    const pending = session.present(delivery, view);
    await vi.waitFor(() => expect(createPresentation).toHaveBeenCalledOnce());
    session.detachScene(host);
    expect(vi.mocked(createPresentation).mock.calls[0]![0].signal?.aborted).toBe(true);
    const nextHost = {} as never;
    session.attachScene(nextHost, { resetState() {}, initTexture() {} });
    const replacement = session.present(delivery, view);
    await Promise.resolve();
    expect(createPresentation).toHaveBeenCalledOnce();
    finish(discarded);
    await Promise.all([pending, replacement]);
    expect(discarded.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(createPresentation).mock.calls[1]![0].host).toBe(nextHost);
    session.dispose();
  });
  it("keeps media visible until its replacement is ready", async () => {
    const previous = loaded();
    const next = loaded();
    vi.mocked(createPresentation)
      .mockResolvedValueOnce(previous)
      .mockImplementationOnce(async () => {
        expect(previous.dispose).not.toHaveBeenCalled();
        return next;
      });
    const { session } = setup();
    await session.present(delivery, view);
    await session.present(
      { projectionProfile: { renderSurfaces: [{ rendererKind: 3 }] } } as never,
      view,
    );
    expect(vi.mocked(createPresentation).mock.calls[1]![0].residentCpuBytes).toBe(4096);
    expect(previous.dispose).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("prepares camera-dependent ordering and exposes pause and user playback operations", async () => {
    const current = loaded();
    vi.mocked(createPresentation).mockResolvedValue(current);
    const { session } = setup();
    await session.present(delivery, view);
    const camera = new Camera();
    session.prepareRender(camera);
    expect(current.prepareRender).toHaveBeenCalledWith(camera);
    session.pause();
    expect(current.setPlaybackEnabled).toHaveBeenCalledWith(false);
    await session.resumePlayback();
    expect(current.resumePlayback).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("passes the animation sampler view to runtime effects", async () => {
    const frameEffects = vi.fn();
    const factory = vi.spyOn(runtimeEffects, "createRuntimeEffects").mockReturnValue({
      frame: frameEffects,
      dispose: vi.fn(),
    });
    try {
      const { session } = setup();
      const current = loaded();
      const sampled = structuredClone(view);
      vi.mocked(current.applyAnimationFrame).mockReturnValue(sampled);
      vi.mocked(createPresentation).mockResolvedValue(current);
      session.openRuntime(delivery);
      await session.present(delivery, view);
      const frame = vi.mocked(createRuntimePlayback).mock.calls[0]![0].frame!;
      frame(view, 1200, {});
      expect(frameEffects.mock.calls[0]![0]).toBe(sampled);
      expect(frameEffects.mock.calls[0]![1]).toBe(1200);
      session.dispose();
    } finally {
      factory.mockRestore();
    }
  });
  it("samples runtime frames with current playback permission and blocked state", async () => {
    let canPlay = false;
    const blocked = vi.fn();
    const session = createPresentationSession({
      canPlay: () => canPlay,
      onPlaybackBlocked: blocked,
    });
    session.attachScene(host, { resetState() {}, initTexture() {} });
    const current = loaded();
    vi.mocked(createPresentation).mockResolvedValue(current);
    const runtime = session.openRuntime(delivery);
    await session.present(delivery, view);
    const frame = vi.mocked(createRuntimePlayback).mock.calls[0]![0].frame!;
    frame({ effectRuns: [], clock: { lifecycle: { kind: "running" } } } as never, 1200, {});
    expect(current.setPlaybackEnabled).toHaveBeenLastCalledWith(false);
    expect(current.applyAnimationFrame).toHaveBeenCalledWith(
      { effectRuns: [], clock: { lifecycle: { kind: "running" } } },
      1200,
    );
    canPlay = true;
    frame({ effectRuns: [], clock: { lifecycle: { kind: "running" } } } as never, 1400, {});
    expect(current.setPlaybackEnabled).toHaveBeenLastCalledWith(true);
    expect(blocked).toHaveBeenLastCalledWith(false);
    session.prepareRender(new Camera());
    expect(runtime.prepareFrame).toHaveBeenCalledOnce();
    session.detachScene(host);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("releases active effects before a budget-driven replacement starts loading", async () => {
    const current = loaded();
    const target = new Group();
    target.name = "effect-target";
    current.root.add(target);
    vi.mocked(createPresentation).mockResolvedValueOnce(current);
    const { session } = setup();
    session.openRuntime(delivery);
    await session.present(delivery, view);
    const frame = vi.mocked(createRuntimePlayback).mock.calls[0]![0].frame!;
    frame(
      {
        ...view,
        effectRuns: [
          {
            runId: { assignmentEpoch: 1, runSequence: 1 },
            owner: { kind: "presentation" },
            cause: {
              cueId: "wave",
              causeEventId: "event",
              groupId: "intro",
              groupEntryEpoch: 1,
              stepId: "start",
              stepEntryEpoch: 1,
            },
            startedAtRuntimeTimeMilliseconds: 0,
            effectId: "wave",
            nodeId: target.name,
            seed: 1,
            status: "active",
            effect: {
              kind: "wave",
              size: 1,
              color: { red: 1, green: 1, blue: 1, alpha: 1 },
              speed: 1,
              durationMilliseconds: 1000,
              waveCycles: 1,
            },
          },
        ],
      },
      100,
      {},
    );
    expect(target.children).toHaveLength(1);
    const pool = await vi.mocked(createPngTexturePool).mock.results[0]!.value;
    vi.mocked(pool.canAcquire).mockReturnValue(false);
    vi.mocked(pool.acquire).mockRejectedValueOnce(new Error("decode"));
    await expect(session.present(delivery, view)).rejects.toThrow("decode");
    expect(target.children).toHaveLength(0);
    session.dispose();
  });
  it("does not detach a newer scene when an old scene finishes cleanup", async () => {
    const { session } = setup();
    const nextHost = {} as never;
    session.attachScene(nextHost, { resetState() {}, initTexture() {} });
    session.detachScene(host);
    vi.mocked(createPresentation).mockResolvedValue(loaded());
    await session.present(delivery, view);
    expect(vi.mocked(createPresentation).mock.calls[0]![0].host).toBe(nextHost);
    session.dispose();
  });
});

it("waits for PNG residency, reuses it for the same delivery and releases it with the session", async () => {
  const pool = {
    assets: [],
    residentAssets: [],
    canAcquire: vi.fn(() => true),
    acquire: vi.fn(async () => ({ assets: [], release: vi.fn() })),
    retainedCpuBytes: 0,
    gpuBytes: 8192,
    dispose: vi.fn(),
    getTexture: vi.fn(),
    loadTexture: vi.fn(),
  };
  let finishPreload!: (value: typeof pool) => void;
  vi.mocked(createPngTexturePool).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPreload = resolve;
      }),
  );
  const current = loaded();
  vi.mocked(current.applyView).mockReturnValue(true);
  vi.mocked(createPresentation).mockResolvedValue(current);
  const { session } = setup();
  const pending = session.present(delivery, view);
  await vi.waitFor(() => expect(createPngTexturePool).toHaveBeenCalledOnce());
  expect(createPresentation).not.toHaveBeenCalled();
  finishPreload(pool);
  await pending;
  expect(createPresentation).toHaveBeenCalledOnce();
  expect(vi.mocked(createPresentation).mock.calls[0]![0].pngTexturePool).toBe(pool);
  await session.present(delivery, view);
  expect(createPngTexturePool).toHaveBeenCalledOnce();
  expect(current.applyView).toHaveBeenCalledOnce();
  expect(pool.dispose).not.toHaveBeenCalled();
  session.dispose();
  session.dispose();
  expect(pool.dispose).toHaveBeenCalledOnce();
});

it("releases the old decoder without disposing its frame before preparing replacement video", async () => {
  const previous = loaded();
  const releaseVideoDecoders = vi.fn(() => {
    previous.resourceUsage.videoDecoders = 0;
  });
  Object.assign(previous, { releaseVideoDecoders });
  const next = loaded();
  vi.mocked(createPresentation)
    .mockResolvedValueOnce(previous)
    .mockImplementationOnce(async (options) => {
      expect(releaseVideoDecoders).toHaveBeenCalledOnce();
      expect(options.residentResources!.videoDecoders).toBe(0);
      expect(previous.dispose).not.toHaveBeenCalled();
      return next;
    });
  const { session } = setup();
  await session.present(delivery, view);
  await session.present(delivery, view);
  expect(previous.dispose).toHaveBeenCalledOnce();
  session.dispose();
});

it("uploads each PNG with the active renderer and resets the shared GL state afterwards", async () => {
  const current = loaded();
  const texture = new Texture();
  vi.mocked(createPresentation).mockResolvedValue(current);
  const { session, renderer } = setup();
  await session.present(delivery, view);
  const upload = vi.mocked(createPngTexturePool).mock.calls[0]![0].uploadTexture;
  const events: string[] = [];
  renderer.initTexture.mockImplementation(() => {
    events.push("upload");
  });
  renderer.resetState.mockImplementation(() => {
    events.push("reset");
  });
  upload(texture);
  expect(events).toEqual(["upload", "reset"]);
  expect(renderer.initTexture).toHaveBeenCalledWith(texture);
  session.dispose();
});
