// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera, Group, Scene } from "three";
import { createAnchorSession } from "../anchor-session";
import deliveryFixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import { createTrackingAdapter } from "../../tracking/adapter";
import { createPngPresentation } from "../../rendering/png-presentation";
import { createLiveTagAnchor } from "../../rendering/live-tag-anchor";
import type { TrackingCallbacks } from "../../tracking/types";
import type { BoardConfig } from "../../fiducials/config";

vi.mock("../../tracking/adapter", () => ({ createTrackingAdapter: vi.fn() }));
vi.mock("../../rendering/png-presentation", () => ({ createPngPresentation: vi.fn() }));
vi.mock("../../rendering/live-tag-anchor", () => ({ createLiveTagAnchor: vi.fn() }));
const config: BoardConfig = {
  schemaVersion: 2,
  boardId: "test",
  revision: 1,
  markers: [
    {
      id: 0,
      sizeMeters: 0.15,
      venueFromMarker: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
  ],
  presentationToVenue: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
};
let callbacks: TrackingCallbacks;
let cleanup: (() => void) | void;
let renderScene: Scene;
const sdkBeforeRender = vi.fn();
const sceneRenderer = { resetState: vi.fn() };
const anchor = { clear: vi.fn(), dispose: vi.fn(), update: vi.fn(), getDisplayDiagnostic: vi.fn() };
const adapter = {
  start: vi.fn(async () => {
    renderScene = new Scene();
    renderScene.onBeforeRender = sdkBeforeRender;
    cleanup = callbacks.onScene(renderScene, {} as never, sceneRenderer);
  }),
  stop: vi.fn(() => {
    cleanup?.();
    cleanup = undefined;
    callbacks.onReset("stopped");
  }),
  setDetectionEnabled: vi.fn(async () => true),
  getMeasurementSnapshot: vi.fn(() => ({
    trackingDiagnostics: { lastUpdate: { appliedTrackingStatus: "NORMAL" } },
  })),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(createPngPresentation).mockReset();
  cleanup = undefined;
  vi.mocked(createTrackingAdapter).mockImplementation((options) => {
    callbacks = options.callbacks;
    return adapter as never;
  });
  vi.mocked(createLiveTagAnchor).mockReturnValue(anchor as never);
});
afterEach(() => {
  vi.useRealTimers();
});
function setup(requestPermissions = async () => {}) {
  return createAnchorSession({
    canvas: document.createElement("canvas"),
    config,
    onChange: vi.fn(),
    requestPermissions,
  });
}
describe("anchor session ownership", () => {
  it("waits for five continuous NORMAL seconds before enabling detection", async () => {
    const session = setup();
    await session.start();
    callbacks.onTracking("NORMAL");
    await vi.advanceTimersByTimeAsync(4900);
    expect(adapter.setDetectionEnabled).not.toHaveBeenCalled();
    callbacks.onTracking("LIMITED");
    callbacks.onTracking("NORMAL");
    await vi.advanceTimersByTimeAsync(4900);
    expect(adapter.setDetectionEnabled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.setDetectionEnabled).toHaveBeenCalledWith(true);
    expect(session.getSnapshot().detection).toBe("active");
    session.dispose();
  });
  it("does not start the SDK after stop or disposal during permissions", async () => {
    let grant!: () => void;
    const session = setup(
      () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        }),
    );
    const pending = session.start();
    session.stop();
    grant();
    await pending;
    expect(adapter.start).not.toHaveBeenCalled();
    expect(session.getSnapshot().stage).toBe("stopped");
    session.dispose();
    await session.start();
    expect(adapter.start).not.toHaveBeenCalled();
  });
  it("owns a single start, disposes the scene, and removes its timer on exit", async () => {
    const session = setup();
    await Promise.all([session.start(), session.start()]);
    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(createLiveTagAnchor).toHaveBeenCalledTimes(1);
    expect(createLiveTagAnchor).toHaveBeenCalledWith(
      expect.any(Scene),
      config.markers[0]!.sizeMeters,
      config.markers[0]!.venueFromMarker,
      config.presentationToVenue,
      false,
    );
    session.dispose();
    session.dispose();
    expect(anchor.dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    callbacks.onTracking("NORMAL");
    await vi.advanceTimersByTimeAsync(6000);
    expect(adapter.setDetectionEnabled).not.toHaveBeenCalled();
  });
  it("creates a fresh scene after stop and requires a new NORMAL warmup", async () => {
    const session = setup();
    await session.start();
    callbacks.onTracking("NORMAL");
    await vi.advanceTimersByTimeAsync(5000);
    session.stop();
    expect(session.getSnapshot().tracking).toBe("LIMITED");
    await session.start();
    expect(createLiveTagAnchor).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().detection).toBe("waiting");
    session.dispose();
  });
  it("ignores detector preparation finishing after a stop", async () => {
    let finish!: (value: boolean) => void;
    adapter.setDetectionEnabled.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const session = setup();
    await session.start();
    callbacks.onTracking("NORMAL");
    await vi.advanceTimersByTimeAsync(5000);
    expect(session.getSnapshot().detection).toBe("preparing");
    session.stop();
    finish(true);
    await Promise.resolve();
    expect(session.getSnapshot().stage).toBe("stopped");
    expect(session.getSnapshot().detection).toBe("waiting");
    session.dispose();
  });
  it("owns loaded presentation resources with the active scene", async () => {
    const dispose = vi.fn();
    vi.mocked(createPngPresentation).mockResolvedValue({
      root: new Group(),
      dispose,
      prepareRender: vi.fn(),
      applyAnimationFrame: vi.fn(() => true),
      retainedCpuBytes: 100,
      applyView: vi.fn(() => false),
    });
    const session = setup();
    await expect(session.presentPresentation({} as never, {})).rejects.toThrow("scene");
    await session.start();
    await session.presentPresentation({} as never, {});
    const request = vi.mocked(createPngPresentation).mock.calls[0]![0];
    expect(request.host).toBe(anchor);
    session.stop();
    expect(request.signal!.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("includes the current scene in replacement admission and prepares depth order for every draw", async () => {
    const prepareRender = vi.fn();
    const oldDispose = vi.fn();
    vi.mocked(createPngPresentation)
      .mockResolvedValueOnce({
        root: new Group(),
        dispose: oldDispose,
        prepareRender,
        applyAnimationFrame: vi.fn(() => true),
        retainedCpuBytes: 4096,
        applyView: vi.fn(() => false),
      })
      .mockRejectedValueOnce(new Error("CPU budget exceeded"));
    const session = setup();
    await session.start();
    await session.presentPresentation({} as never, {});
    const camera = new Camera();
    renderScene.onBeforeRender(
      {} as never,
      renderScene,
      camera,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(prepareRender).toHaveBeenCalledWith(camera);
    expect(sdkBeforeRender).toHaveBeenCalledTimes(1);
    await expect(session.presentPresentation({} as never, {})).rejects.toThrow("CPU");
    expect(vi.mocked(createPngPresentation).mock.calls[1]![0].residentCpuBytes).toBe(4096);
    expect(oldDispose).not.toHaveBeenCalled();
    session.stop();
    session.dispose();
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(renderScene.onBeforeRender).toBe(sdkBeforeRender);
  });
  it("waits for cancelled loading to release resources before starting its replacement", async () => {
    let finish!: (value: Awaited<ReturnType<typeof createPngPresentation>>) => void;
    const discarded = {
      root: new Group(),
      dispose: vi.fn(),
      prepareRender: vi.fn(),
      applyAnimationFrame: vi.fn(() => true),
      retainedCpuBytes: 4096,
      applyView: vi.fn(() => false),
    };
    const next = {
      root: new Group(),
      dispose: vi.fn(),
      prepareRender: vi.fn(),
      applyAnimationFrame: vi.fn(() => true),
      retainedCpuBytes: 4096,
      applyView: vi.fn(() => false),
    };
    vi.mocked(createPngPresentation)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(next);
    const session = setup();
    await session.start();
    const first = session.presentPresentation({} as never, {});
    await Promise.resolve();
    await Promise.resolve();
    const second = session.presentPresentation({} as never, {});
    await Promise.resolve();
    expect(createPngPresentation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPngPresentation).mock.calls[0]![0].signal!.aborted).toBe(true);
    finish(discarded);
    await Promise.all([first, second]);
    expect(discarded.dispose).toHaveBeenCalledTimes(1);
    expect(createPngPresentation).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("applies loaded PNG state changes without fetching its textures again", async () => {
    const applyView = vi.fn(() => true);
    vi.mocked(createPngPresentation).mockResolvedValue({
      root: new Group(),
      dispose: vi.fn(),
      prepareRender: vi.fn(),
      applyAnimationFrame: vi.fn(() => true),
      retainedCpuBytes: 100,
      applyView,
    });
    const session = setup();
    await session.start();
    const delivery = {} as never;
    await session.presentPresentation(delivery, {});
    const next = { nodeStates: {} };
    await session.presentPresentation(delivery, next);
    expect(applyView).toHaveBeenCalledWith(next);
    expect(createPngPresentation).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("disposes its Runtime receiver on scene stop and ignores late updates", async () => {
    const session = setup();
    await session.start();
    const delivery = structuredClone(deliveryFixture.value) as DeliveryManifestWire;
    delivery.projectionProfile!.key!.role = 2;
    const runtime = session.openRuntime(delivery);
    expect(runtime.getSnapshot().phase).toBe("awaiting-snapshot");
    const prepareFrame = vi.spyOn(runtime, "prepareFrame");
    renderScene.onBeforeRender(
      {} as never,
      renderScene,
      new Camera(),
      {} as never,
      {} as never,
      {} as never,
    );
    expect(prepareFrame).toHaveBeenCalledTimes(1);
    session.stop();
    runtime.applyControl({} as never);
    expect(runtime.getSnapshot().phase).toBe("awaiting-snapshot");
    expect(createPngPresentation).not.toHaveBeenCalled();
    session.dispose();
  });
});

it("unsets the SDK renderer program before replacing and disposing presentation materials", async () => {
  const order: string[] = [];
  sceneRenderer.resetState.mockImplementation(() => {
    order.push("reset");
  });
  const applyView = vi.fn(() => {
    order.push("replace");
    return true;
  });
  const dispose = vi.fn(() => {
    order.push("dispose");
  });
  vi.mocked(createPngPresentation).mockResolvedValue({
    root: new Group(),
    dispose,
    prepareRender: vi.fn(),
    retainedCpuBytes: 0,
    applyView,
    applyAnimationFrame: vi.fn(() => true),
  });
  const session = setup();
  await session.start();
  const delivery = {} as never;
  await session.presentPresentation(delivery, {});
  order.length = 0;
  await session.presentPresentation(delivery, {});
  expect(order).toEqual(["reset", "replace"]);
  order.length = 0;
  session.stop();
  expect(order[0]).toBe("reset");
  expect(order.indexOf("dispose")).toBeGreaterThan(0);
  session.dispose();
  sceneRenderer.resetState.mockReset();
});
