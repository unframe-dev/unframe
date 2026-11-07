import { Camera, Group, Quaternion, Texture, Vector3 } from "three";
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
import { evaluateAnimationView } from "../../runtime/animation-view";
import { createSpatialPresentation } from "../../rendering/spatial-presentation";
import { modelFixture } from "../../rendering/test/support/model-fixture";

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
    activateGroup: vi.fn(),
    warm: vi.fn(async () => {}),
    stopWarming: vi.fn(async () => {}),
    discardWarm: vi.fn(),
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
    const pool = await vi.mocked(createPngTexturePool).mock.results[0]!.value;
    expect(pool.activateGroup).toHaveBeenCalledOnce();
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
      activateGroup: vi.fn(),
      warm: vi.fn(async () => {}),
      stopWarming: vi.fn(async () => {}),
      discardWarm: vi.fn(),
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
    const discardedPool = await vi.mocked(createPngTexturePool).mock.results[0]!.value;
    expect(discardedPool.activateGroup).not.toHaveBeenCalled();
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
  it.each(["shape", "light"] as const)(
    "preserves sampled %s transforms when applying a live Presenter Anchor",
    async (kind) => {
      const { delivery: anchoredDelivery, view: canonical } = modelFixture();
      const node = anchoredDelivery.projectionProfile!.runtimeCatalog!.nodes![0]!;
      delete node.model;
      if (kind === "shape")
        node.shape = {
          box: { size: { x: 1, y: 1, z: 1 } },
          material: { color: { red: 1, green: 1, blue: 1, alpha: 1 } },
        };
      else
        node.light = {
          point: { color: { red: 1, green: 1, blue: 1 }, intensityCandela: 1, rangeMeters: 5 },
        };
      node.parent = {
        presenterAnchor: { target: 2, followPosition: true, followRotation: false },
      };
      canonical.presentationOrigin.pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
      canonical.nodeStates.model!.transform = {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      };
      anchoredDelivery.projectionProfile!.runtimeCatalog!.timelines = [
        {
          timelineId: "move",
          owner: { presentation: {} },
          durationMs: "1000",
          tracks: [
            {
              target: { nodeId: "model", property: 2 },
              keyframes: [
                { timeMs: "0", vector3: { value: { x: 0, y: 0, z: 0 } }, easingToNext: 1 },
                { timeMs: "1000", vector3: { value: { x: 2, y: 0, z: 0 } } },
              ],
            },
            {
              target: { nodeId: "model", property: 3 },
              keyframes: [
                {
                  timeMs: "0",
                  quaternion: { value: { x: 0, y: 0, z: 0, w: 1 } },
                  easingToNext: 1,
                },
                { timeMs: "1000", quaternion: { value: { x: 0, y: 1, z: 0, w: 0 } } },
              ],
            },
            {
              target: { nodeId: "model", property: 4 },
              keyframes: [
                { timeMs: "0", vector3: { value: { x: 1, y: 1, z: 1 } }, easingToNext: 1 },
                { timeMs: "1000", vector3: { value: { x: 3, y: 3, z: 3 } } },
              ],
            },
          ],
        },
      ];
      canonical.activeRuns = [
        {
          kind: "timeline",
          timelineId: "move",
          runId: { assignmentEpoch: 1, runSequence: 1 },
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
        },
      ];
      const spatial = createSpatialPresentation(anchoredDelivery, canonical);
      const current = loaded();
      Object.assign(current, { root: spatial.root });
      vi.mocked(current.applyAnimationFrame).mockImplementation((next, time) => {
        const sampled = evaluateAnimationView(anchoredDelivery, next, time).view;
        spatial.applyView(sampled);
        return sampled;
      });
      vi.mocked(current.dispose).mockImplementation(spatial.dispose);
      vi.mocked(createPresentation).mockResolvedValue(current);
      const { session } = setup();
      try {
        session.openRuntime(anchoredDelivery);
        await session.present(anchoredDelivery, canonical);
        const frame = vi.mocked(createRuntimePlayback).mock.calls[0]![0].frame!;
        const target = spatial.root.getObjectByName("spatial-node:model")!;
        for (const time of [250, 500, 750]) {
          frame(canonical, time, {
            2: {
              target: 2,
              sample: { trackingFrameSequence: "1", position: { x: 5, y: 0, z: 0 } },
            },
          });
          spatial.prepareRender();
          expect(target.getWorldPosition(new Vector3()).x).toBeCloseTo(5 + (2 * time) / 1000);
          const rotation = new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            (Math.PI * time) / 1000,
          );
          expect(target.getWorldQuaternion(new Quaternion()).angleTo(rotation)).toBeLessThan(1e-6);
          for (const scale of target.getWorldScale(new Vector3()).toArray())
            expect(scale).toBeCloseTo(1 + (2 * time) / 1000);
        }
        expect(canonical.nodeStates.model!.transform).toEqual({
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        });
      } finally {
        session.dispose();
      }
    },
  );
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
    activateGroup: vi.fn(),
    warm: vi.fn(async () => {}),
    stopWarming: vi.fn(async () => {}),
    discardWarm: vi.fn(),
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

it.each([false, true])(
  "enables authored shadows and restores renderer's initial enabled=%s",
  async (enabled) => {
    const scene = loaded();
    vi.mocked(createPresentation).mockResolvedValue(scene);
    const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked: vi.fn() });
    const renderer = { resetState: vi.fn(), initTexture: vi.fn(), shadowMap: { enabled } };
    session.attachScene(host, renderer);
    const lit = {
      projectionProfile: {
        runtimeCatalog: { nodes: [{ nodeId: "light", light: { point: { castsShadows: true } } }] },
      },
    } as DeliveryManifestWire;
    await session.present(lit, view);
    expect(renderer.shadowMap.enabled).toBe(true);
    session.detachScene(host);
    expect(renderer.shadowMap.enabled).toBe(enabled);
  },
);

it("rejects shadow-casting lights when the XR renderer cannot expose shadow support", async () => {
  const { session } = setup();
  const lit = {
    projectionProfile: {
      runtimeCatalog: { nodes: [{ nodeId: "light", light: { point: { castsShadows: true } } }] },
    },
  } as DeliveryManifestWire;
  await expect(session.present(lit, view)).rejects.toThrow("shadow");
  expect(createPresentation).not.toHaveBeenCalled();
  session.dispose();
});

it("shows the current group without waiting for speculative textures and preserves warming on view updates", async () => {
  const createPool = vi.mocked(createPngTexturePool).getMockImplementation()!;
  vi.mocked(createPngTexturePool).mockImplementationOnce(async (options) => {
    const pool = await createPool(options);
    vi.mocked(pool.warm).mockImplementation(() => new Promise(() => {}));
    return pool;
  });
  const current = loaded();
  vi.mocked(current.applyView).mockReturnValue(true);
  vi.mocked(createPresentation).mockResolvedValue(current);
  const { session } = setup();
  await session.present(delivery, view);
  const pool = await vi.mocked(createPngTexturePool).mock.results[0]!.value;
  expect(pool.warm).toHaveBeenCalledWith({
    signal: expect.any(AbortSignal),
    residentCpuBytes: 4096,
    residentResources: { gpuBytes: 100, bindings: 1 },
  });
  vi.mocked(pool.stopWarming).mockClear();
  await session.present(delivery, view);
  expect(pool.stopWarming).not.toHaveBeenCalled();
  expect(current.applyView).toHaveBeenCalledOnce();
  session.dispose();
});
