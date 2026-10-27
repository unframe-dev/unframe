// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scene, PerspectiveCamera } from "three";
import { createTrackingAdapter } from "./adapter";
import type { CameraPipelineModule, XrEngine } from "./types";
import type { FrameSourceOptions, FrameMeasurementSnapshot } from "../fiducials/frame-source";
const source = vi.hoisted(() => ({
  options: null as FrameSourceOptions | null,
  snapshot: null as FrameMeasurementSnapshot | null,
}));
vi.mock("../fiducials/frame-source", () => ({
  createFrameSource: (options: FrameSourceOptions) => {
    source.options = options;
    return {
      name: "audience-fiducial-frame",
      onDetach: vi.fn(),
      onCanvasSizeChange: vi.fn(),
      getMeasurementSnapshot: () =>
        structuredClone(
          source.snapshot ?? {
            updates: 0,
            captured: 0,
            error: 0,
            skipped: {},
            lastFrameMetadata: null,
            sourceGeometry: null,
            lastCameraTextureObservation: null,
          },
        ),
    };
  },
}));
function fixture() {
  source.snapshot = null;
  let modules: CameraPipelineModule[] = [];
  const engine: XrEngine = {
    loadChunk: vi.fn(async () => {}),
    GlTextureRenderer: { pipelineModule: () => ({ name: "camera" }), create: vi.fn() },
    Threejs: {
      pipelineModule: () => ({ name: "three" }),
      xrScene: () => ({
        scene: new Scene(),
        camera: new PerspectiveCamera(),
        renderer: { resetState: vi.fn() },
      }),
    },
    XrController: { configure: vi.fn(), pipelineModule: () => ({ name: "reality" }) },
    addCameraPipelineModules: vi.fn((value) => {
      modules = value;
    }),
    removeCameraPipelineModules: vi.fn(),
    run: vi.fn(() => {
      modules.find((m) => m.name === "audience-fiducial-state")!.onStart!({
        GLctx: {} as WebGLRenderingContext,
        videoWidth: 1280,
        videoHeight: 720,
        canvasWidth: 640,
        canvasHeight: 480,
      });
    }),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const callbacks = {
    onScene: vi.fn(),
    onDetections: vi.fn(),
    onTracking: vi.fn(),
    onPoseSample: vi.fn(),
    onReset: vi.fn(),
    onError: vi.fn(),
    onDiagnostic: vi.fn(),
  };
  const worker = {
    detect: vi.fn(async () => ({ detections: [], durationMs: 1 })),
    dispose: vi.fn(),
  };
  const workerFactory = vi.fn(async () => worker);
  const adapter = createTrackingAdapter(
    { canvas: document.createElement("canvas"), callbacks },
    async () => engine,
    workerFactory,
  );
  const update = (status: string) =>
    modules.find((m) => m.name === "audience-fiducial-state")!.onUpdate!({
      processCpuResult: { reality: { trackingStatus: status } },
    });
  return { engine, callbacks, worker, workerFactory, adapter, update, modules: () => modules };
}
function expectConserved(adapter: ReturnType<typeof createTrackingAdapter>) {
  const value = adapter.getMeasurementSnapshot().detection;
  expect(value.submitted).toBe(
    value.delivered + value.stale + value.cancelled + value.error + value.pending,
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("dedicated detector SDK lifecycle", () => {
  it("preserves geometry without detections and distinguishes old camera texture evidence after restart", async () => {
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    const empty = f.adapter.getMeasurementSnapshot().capture;
    const geometry: NonNullable<FrameMeasurementSnapshot["sourceGeometry"]> = {
      video: { width: 768, height: 1024 },
      canvas: { width: 780, height: 1322 },
      plannedReadback: { width: 768, height: 1024 },
      maxPixels: 4096 * 4096,
      readbackPolicy: "sdk-video-size-no-downsampling",
      realityTexture: null,
      source: "sdk-size-callbacks",
    };
    const texture: NonNullable<FrameMeasurementSnapshot["lastCameraTextureObservation"]> = {
      callbackAtMs: 100,
      dimensions: { width: 768, height: 1024 },
      dimensionStatus: "available",
      orientation: 0,
      sourceVideoTime: 1,
      source: "sdk-onupdate-frame-start-result",
      realityResponseSynchronization: "unknown",
    };
    source.snapshot = { ...empty, sourceGeometry: geometry, lastCameraTextureObservation: texture };
    f.adapter.stop();
    expect(f.adapter.getMeasurementSnapshot()).toMatchObject({
      lastGeometrySessionId: 1,
      lastCameraTextureSessionId: 1,
      lastFrameSessionId: null,
      capture: {
        sourceGeometry: geometry,
        lastCameraTextureObservation: texture,
        lastFrameMetadata: null,
      },
    });
    source.snapshot = {
      ...empty,
      sourceGeometry: { ...geometry, video: { width: 1920, height: 1080 } },
    };
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    const current = f.adapter.getMeasurementSnapshot();
    expect(current).toMatchObject({
      sessionId: 2,
      lastGeometrySessionId: 2,
      lastCameraTextureSessionId: 1,
      capture: {
        sourceGeometry: { video: { width: 1920, height: 1080 } },
        lastCameraTextureObservation: texture,
      },
    });
    current.capture.lastCameraTextureObservation!.dimensions!.width = 999;
    expect(
      f.adapter.getMeasurementSnapshot().capture.lastCameraTextureObservation!.dimensions!.width,
    ).toBe(768);
    f.adapter.stop();
  });
  it("counts cancellation once at stop even before a pending worker settles", async () => {
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    let done!: (value: Awaited<ReturnType<typeof f.worker.detect>>) => void;
    f.worker.detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now(),
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: null,
    });
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      submitted: 1,
      pending: 1,
    });
    f.adapter.stop();
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      submitted: 1,
      cancelled: 1,
      pending: 0,
    });
    done({ detections: [], durationMs: 1 });
    await Promise.resolve();
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      cancelled: 1,
      delivered: 0,
    });
    expect(f.callbacks.onDetections).not.toHaveBeenCalled();
    expect(f.adapter.getMeasurementSnapshot().detection.completed).toBe(1);
    expectConserved(f.adapter);
  });

  it("keeps lifetime totals after restart and gives each session its own identity", async () => {
    const f = fixture();
    const submit = () =>
      source.options!.onFrame({
        id: 1,
        timestampMs: performance.now(),
        sourceVideoTime: 1,
        width: 1,
        height: 1,
        pixels: new Uint8Array(1),
        intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
        worldFromCamera: null,
      });
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    submit();
    await Promise.resolve();
    f.adapter.stop();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    submit();
    await Promise.resolve();
    const snapshot = f.adapter.getMeasurementSnapshot();
    expect(snapshot).toMatchObject({
      scope: "adapter-lifetime",
      sessionsStarted: 2,
      sessionId: 2,
      detection: { submitted: 2, completed: 2, delivered: 2, cancelled: 0, pending: 0 },
    });
    expectConserved(f.adapter);
    expect(f.callbacks.onDetections.mock.calls.map(([frame]) => frame.captureSessionId)).toEqual([
      1, 2,
    ]);
    snapshot.detection.delivered = 99;
    expect(f.adapter.getMeasurementSnapshot().detection.delivered).toBe(2);
    f.adapter.stop();
  });
  it("records stale worker results separately from completed and delivered frames", async () => {
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now() - 501,
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: null,
    });
    await Promise.resolve();
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      submitted: 1,
      completed: 1,
      stale: 1,
      delivered: 0,
      pending: 0,
    });
    expect(f.callbacks.onDetections).not.toHaveBeenCalled();
    expectConserved(f.adapter);
    f.adapter.stop();
  });
  it("records worker errors as terminal results without counting disposal as a second cancellation", async () => {
    const f = fixture();
    f.worker.detect.mockRejectedValue(new Error("worker failed"));
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now(),
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      submitted: 1,
      completed: 0,
      error: 1,
      cancelled: 0,
      pending: 0,
    });
    expectConserved(f.adapter);
    f.adapter.stop();
  });
  it("treats a consumer callback exception as delivered work and reports it separately", async () => {
    const f = fixture();
    f.callbacks.onDetections.mockImplementation(() => {
      throw new Error("consumer failed");
    });
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now(),
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.adapter.getMeasurementSnapshot().detection).toMatchObject({
      submitted: 1,
      completed: 1,
      delivered: 1,
      error: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(f.callbacks.onError).toHaveBeenCalledOnce();
    expectConserved(f.adapter);
    f.adapter.stop();
  });
  it("initializes a single worker and SLAM without Image Targets", async () => {
    const f = fixture();
    expect(f.workerFactory).not.toHaveBeenCalled();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    expect(f.engine.XrController.configure).toHaveBeenCalledWith({
      disableWorldTracking: false,
      scale: "absolute",
    });
    f.update("NORMAL");
    expect(f.callbacks.onTracking).toHaveBeenCalledWith("NORMAL");
    f.adapter.stop();
    expect(f.worker.dispose).toHaveBeenCalledOnce();
    expect(f.engine.stop).toHaveBeenCalledOnce();
  });
  it("registers SDK status delivery before capture and preserves the pose at capture time", async () => {
    const f = fixture();
    const events: string[] = [];
    f.callbacks.onTracking.mockImplementation((status) => events.push(status));
    f.callbacks.onDetections.mockImplementation(() => events.push("detection"));
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    const names = f.modules().map(({ name }) => name);
    expect(names.indexOf("audience-fiducial-state")).toBeLessThan(
      names.indexOf("audience-fiducial-frame"),
    );
    f.update("NORMAL");
    const pose = {
      position: { x: 0.2, y: 0.3, z: 0.4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now(),
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: pose,
    });
    f.modules().find(({ name }) => name === "audience-fiducial-state")!.onUpdate!({
      processCpuResult: {
        reality: {
          trackingStatus: "NORMAL",
          position: { x: 10, y: 20, z: 30 },
          rotation: { x: 0, y: 1, z: 0, w: 0 },
        },
      },
    });
    await Promise.resolve();
    expect(events).toEqual(["NORMAL", "detection"]);
    expect(f.callbacks.onDetections.mock.calls[0]![0].worldFromCamera).toEqual(pose);
    f.adapter.stop();
  });

  it("keeps an in-flight detection when SDK tracking becomes limited", async () => {
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    f.update("NORMAL");
    let done!: (value: Awaited<ReturnType<typeof f.worker.detect>>) => void;
    f.worker.detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    source.options!.onFrame({
      id: 1,
      timestampMs: performance.now(),
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0.5, cy: 0.5 },
      worldFromCamera: null,
    });
    f.update("LIMITED");
    done({ detections: [], durationMs: 1 });
    await Promise.resolve();
    expect(f.callbacks.onDetections).toHaveBeenCalledOnce();
    f.adapter.stop();
  });
  it("pauses while hidden and resumes independent detection", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(source.options!.canCapture()).toBe(false);
    expect(f.callbacks.onReset).toHaveBeenCalledWith("hidden");
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(source.options!.canCapture()).toBe(true);
    f.adapter.stop();
  });
  it("rejects SDK startup failure and disposes the detector", async () => {
    const f = fixture();
    vi.mocked(f.engine.loadChunk).mockRejectedValue(new Error("chunk failed"));
    await expect(f.adapter.start()).rejects.toThrow("chunk failed");
    expect(f.worker.dispose).not.toHaveBeenCalled();
    expect(f.callbacks.onError).toHaveBeenCalledOnce();
  });

  it("reports tracking degradation without discarding the venue alignment", async () => {
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    f.update("NORMAL");
    f.update("NOT_AVAILABLE");
    expect(f.callbacks.onTracking).toHaveBeenLastCalledWith("LIMITED");
    expect(f.callbacks.onReset).not.toHaveBeenCalled();
    expect(source.options!.canCapture()).toBe(true);
    f.adapter.stop();
  });
  it("requires a fresh normal transition after returning from a hidden page", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    f.update("NORMAL");
    expect(source.options!.canCapture()).toBe(true);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.engine.pause).toHaveBeenCalledOnce();
    expect(f.callbacks.onReset).toHaveBeenCalledWith("hidden");
    expect(f.callbacks.onTracking).toHaveBeenLastCalledWith("LIMITED");
    expect(source.options!.canCapture()).toBe(false);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.engine.resume).toHaveBeenCalledOnce();
    expect(source.options!.canCapture()).toBe(true);
    f.update("NORMAL");
    expect(f.callbacks.onTracking).toHaveBeenLastCalledWith("NORMAL");
    expect(source.options!.canCapture()).toBe(true);
    f.adapter.stop();
  });
});

describe("SDK pose sampling", () => {
  it("samples at most 10 Hz while the detector is busy and snapshots mutable SDK poses", async () => {
    const f = fixture();
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    f.callbacks.onPoseSample.mockClear();
    time = 100;
    f.worker.detect.mockImplementation(() => new Promise(() => {}));
    source.options!.onFrame({
      id: 1,
      timestampMs: time,
      sourceVideoTime: 1,
      width: 1,
      height: 1,
      pixels: new Uint8Array(1),
      intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0 },
      worldFromCamera: null,
    });
    const state = f.modules().find((m) => m.name === "audience-fiducial-state")!;
    const position = { x: 1, y: 2, z: 3 };
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    const update = () =>
      state.onUpdate!({
        frameStartResult: { videoTime: 2.5, repeatFrame: false },
        processCpuResult: { reality: { trackingStatus: "NORMAL", position, rotation } },
      });
    update();
    position.x = 99;
    rotation.z = 1;
    rotation.w = 0;
    time = 199;
    update();
    expect(f.callbacks.onPoseSample).toHaveBeenCalledOnce();
    expect(f.callbacks.onPoseSample.mock.calls[0]![0]).toMatchObject({
      sessionId: 1,
      callbackAtMs: 100,
      sourceVideoTime: 2.5,
      repeatFrame: false,
      sdkFromCamera: {
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      trackingStatus: "NORMAL",
      timestampBasis: "sdk-callback-performance-now",
      exposureSynchronization: "unknown",
    });
    time = 200;
    update();
    expect(f.callbacks.onPoseSample).toHaveBeenCalledTimes(2);
    f.adapter.stop();
  });
  it("records missing, non-finite and non-unit poses as null", async () => {
    const f = fixture();
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    f.callbacks.onPoseSample.mockClear();
    time = 100;
    const state = f.modules().find((m) => m.name === "audience-fiducial-state")!;
    for (const reality of [
      undefined,
      { position: { x: NaN, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 2 } },
    ]) {
      state.onUpdate!({
        frameStartResult: { videoTime: NaN },
        processCpuResult: reality ? { reality } : {},
      });
      time += 100;
    }
    expect(f.callbacks.onPoseSample).toHaveBeenCalledTimes(3);
    for (const [sample] of f.callbacks.onPoseSample.mock.calls)
      expect(sample).toMatchObject({
        sdkFromCamera: null,
        sourceVideoTime: null,
        repeatFrame: null,
        trackingStatus: "NORMAL",
        rawTracking: { interpretation: "missing", status: { present: false } },
      });
    f.adapter.stop();
  });
  it("does not sample hidden, stopped or previous-generation callbacks", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const f = fixture();
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    const old = f.modules().find((m) => m.name === "audience-fiducial-state")!;
    f.callbacks.onPoseSample.mockClear();
    time = 100;
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    old.onUpdate!({});
    f.adapter.stop();
    old.onUpdate!({});
    expect(f.callbacks.onPoseSample).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await f.adapter.start();
    f.update("NORMAL");
    await f.adapter.setDetectionEnabled(true);
    expect(f.callbacks.onPoseSample).toHaveBeenCalledOnce();
    expect(f.callbacks.onPoseSample.mock.calls[0]![0].sessionId).toBe(2);
    f.callbacks.onPoseSample.mockClear();
    time = 200;
    old.onUpdate!({});
    expect(f.callbacks.onPoseSample).not.toHaveBeenCalled();
    f.modules().find((m) => m.name === "audience-fiducial-state")!.onUpdate!({});
    expect(f.callbacks.onPoseSample).toHaveBeenCalledOnce();
    expect(f.callbacks.onPoseSample.mock.calls[0]![0].sessionId).toBe(2);
    f.adapter.stop();
  });
  it("gives samples and captured frames matching session identities across restart", async () => {
    const f = fixture();
    for (const sessionId of [1, 2]) {
      await f.adapter.start();
      f.update("NORMAL");
      await f.adapter.setDetectionEnabled(true);
      const state = f.modules().find((m) => m.name === "audience-fiducial-state")!;
      state.onUpdate!({});
      source.options!.onFrame({
        id: 1,
        timestampMs: performance.now(),
        sourceVideoTime: 1,
        width: 1,
        height: 1,
        pixels: new Uint8Array(1),
        intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0 },
        worldFromCamera: null,
      });
      await Promise.resolve();
      expect(f.callbacks.onPoseSample.mock.lastCall![0].sessionId).toBe(sessionId);
      expect(f.callbacks.onDetections.mock.lastCall![0].captureSessionId).toBe(sessionId);
      f.adapter.stop();
    }
  });
});

it("records per-start pipeline progress even while LIMITED prevents tag detection", async () => {
  const f = fixture();
  await f.adapter.start();
  expect(f.adapter.getMeasurementSnapshot().startup).toMatchObject({
    phase: "running",
    updates: 0,
  });
  f.update("LIMITED");
  f.update("LIMITED");
  expect(f.adapter.getMeasurementSnapshot().startup).toMatchObject({
    updates: 2,
    realityUpdates: 2,
    poseUpdates: 0,
  });
  expect(f.adapter.getMeasurementSnapshot().detection.submitted).toBe(0);
  f.adapter.stop();
  expect(f.adapter.getMeasurementSnapshot().startup.phase).toBe("stopped");
  await f.adapter.start();
  expect(f.adapter.getMeasurementSnapshot().startup).toMatchObject({
    phase: "running",
    updates: 0,
  });
  f.adapter.stop();
});
