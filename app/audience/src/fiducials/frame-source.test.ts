import { describe, expect, it, vi } from "vitest";
import { estimateMarkerPose } from "./pose";
import {
  createFrameSource,
  coverViewport,
  projectionToIntrinsics,
  videoIntrinsicsFromProjection,
} from "./frame-source";

const projection = [2, 0, 0, 0, 0, 3, 0, 0, 0.2, -0.1, -1, -1, 0, 0, -0.2, 0];

function fixture(requireWorldTracking = true) {
  let clock = 100;
  let busy = false;
  const state = new Map<number, unknown>();
  const gl = {
    FRAMEBUFFER: 1,
    FRAMEBUFFER_BINDING: 2,
    PACK_ALIGNMENT: 3,
    RGBA: 4,
    UNSIGNED_BYTE: 5,
    FRAMEBUFFER_COMPLETE: 6,
    GENERATE_MIPMAP_HINT: 7,
    NO_ERROR: 0,
    getError: vi.fn(() => 0),
    getParameter: vi.fn((key: number) => state.get(key)),
    bindFramebuffer: vi.fn((_target: number, value: unknown) => state.set(2, value)),
    pixelStorei: vi.fn((key: number, value: unknown) => state.set(key, value)),
    hint: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 6),
    readPixels: vi.fn(
      (
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        _format: number,
        _type: number,
        out: Uint8Array,
      ) => {
        out.fill(90);
      },
    ),
  };
  state.set(2, "existing-framebuffer");
  state.set(3, 8);
  state.set(7, 999);
  const renderer = { render: vi.fn(), framebuffer: () => "capture-framebuffer", destroy: vi.fn() };
  const onFrame = vi.fn();
  const onDiagnostic = vi.fn();
  const createRenderer = vi.fn(() => renderer);
  const source = createFrameSource({
    createRenderer: createRenderer as never,
    onFrame,
    onDiagnostic,
    canCapture: () => !busy,
    now: () => clock,
    intervalMs: 120,
    requireWorldTracking,
  });
  source.onStart({
    GLctx: gl as never,
    canvasWidth: 4,
    canvasHeight: 8,
    videoWidth: 8,
    videoHeight: 8,
  });
  onDiagnostic.mockClear();
  const reality = {
    realityTexture: "sdk-response-texture" as unknown as WebGLTexture,
    intrinsics: projection,
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    trackingStatus: "NORMAL",
  };
  const update = () =>
    source.onUpdate({
      frameStartResult: { videoTime: 1, repeatFrame: false },
      processCpuResult: { reality },
    });
  return {
    source,
    update,
    reality,
    onFrame,
    onDiagnostic,
    renderer,
    createRenderer,
    gl,
    state,
    tick: () => {
      clock += 120;
    },
    setBusy: () => {
      busy = true;
    },
  };
}

describe("SDK frame source", () => {
  it.each([
    [390, 844],
    [844, 390],
    [768, 1024],
  ])(
    "recovers full-video anisotropic intrinsics after canvas cover at %s by %s",
    (canvasWidth, canvasHeight) => {
      const videoWidth = 768;
      const videoHeight = 1024;
      const truth = { fx: 810, fy: 795, cx: 351, cy: 493 };
      const display = coverViewport(videoWidth, videoHeight, canvasWidth, canvasHeight);
      const scale = display.width / videoWidth;
      const canvasK = {
        fx: truth.fx * scale,
        fy: truth.fy * scale,
        cx: truth.cx * scale + display.offsetX,
        cy: truth.cy * scale + display.offsetY,
      };
      const p = [...projection];
      p[0] = (2 * canvasK.fx) / canvasWidth;
      p[5] = (2 * canvasK.fy) / canvasHeight;
      p[8] = 1 - (2 * canvasK.cx) / canvasWidth;
      p[9] = (2 * canvasK.cy) / canvasHeight - 1;
      const k = videoIntrinsicsFromProjection(
        p,
        videoWidth,
        videoHeight,
        canvasWidth,
        canvasHeight,
      );
      for (const key of ["fx", "fy", "cx", "cy"] as const)
        expect(k[key]).toBeCloseTo(truth[key], 10);
      for (const point of [
        [-0.1, -0.1, 2],
        [0.1, -0.1, 2],
        [0.1, 0.1, 2],
        [-0.1, 0.1, 2],
      ]) {
        const u = (k.fx * point[0]!) / point[2]! + k.cx;
        const v = (k.fy * point[1]!) / point[2]! + k.cy;
        expect(u * scale + display.offsetX).toBeCloseTo(
          (canvasK.fx * point[0]!) / point[2]! + canvasK.cx,
        );
        expect(v * scale + display.offsetY).toBeCloseTo(
          (canvasK.fy * point[1]!) / point[2]! + canvasK.cy,
        );
      }
    },
  );

  it("passes recovered SDK intrinsics to the metric pose estimator without distance scale bias", () => {
    const width = 768;
    const height = 1024;
    const canvasWidth = 390;
    const canvasHeight = 844;
    const truth = { fx: 810, fy: 795, cx: 351, cy: 493 };
    const viewport = coverViewport(width, height, canvasWidth, canvasHeight);
    const scale = viewport.width / width;
    const p = [...projection];
    p[0] = (2 * truth.fx * scale) / canvasWidth;
    p[5] = (2 * truth.fy * scale) / canvasHeight;
    p[8] = 1 - (2 * (truth.cx * scale + viewport.offsetX)) / canvasWidth;
    p[9] = (2 * (truth.cy * scale + viewport.offsetY)) / canvasHeight - 1;
    const k = videoIntrinsicsFromProjection(p, width, height, canvasWidth, canvasHeight);
    const distance = 7;
    const markerSize = 0.14;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => ({
      x: (truth.fx * x! * markerSize) / (2 * distance) + truth.cx,
      y: (truth.fy * y! * markerSize) / (2 * distance) + truth.cy,
    }));
    const estimated = estimateMarkerPose(corners, k, markerSize);
    expect(estimated).not.toBeNull();
    expect(estimated!.cameraFromMarker.position.z).toBeCloseTo(-distance, 5);
    expect(estimated!.reprojectionErrorPixels).toBeLessThan(1e-5);
  });

  it("reads SDK video size beyond the former 960 pixel limit without cropping or scaling", () => {
    const f = fixture(false);
    f.source.onVideoSizeChange({ videoWidth: 1920, videoHeight: 1080 });
    f.update();
    expect(f.onFrame.mock.calls[0]![0]).toMatchObject({ width: 1920, height: 1080 });
    expect(f.renderer.render).toHaveBeenCalledWith({
      renderTexture: f.reality.realityTexture,
      viewport: { offsetX: 0, offsetY: 0, width: 1920, height: 1080 },
    });
  });

  it("rejects over-budget video explicitly rather than silently reducing its resolution", () => {
    const f = fixture(false);
    f.source.onVideoSizeChange({ videoWidth: 8192, videoHeight: 4096 });
    f.update();
    expect(f.onFrame).not.toHaveBeenCalled();
    expect(f.createRenderer).not.toHaveBeenCalled();
    expect(f.onDiagnostic).toHaveBeenCalledWith("frame-source-error", {
      message: expect.stringContaining("downsampling is disabled"),
    });
    expect(f.state.get(2)).toBe("existing-framebuffer");
    expect(f.state.get(3)).toBe(8);
  });

  it("records full-video normalized coordinates mapped to the display cover crop", () => {
    const f = fixture(false);
    f.update();
    expect(f.onFrame.mock.calls[0]![0].metadata).toMatchObject({
      viewport: { offsetX: 0, offsetY: 0, width: 8, height: 8 },
      displayViewport: { offsetX: -2, offsetY: 0, width: 8, height: 8 },
      normalizedVideoToDisplay: { scaleX: 2, scaleY: 1, offsetX: -0.5, offsetY: 0 },
    });
  });

  it("records source dimensions before detection and ignores unchanged resizes", () => {
    const f = fixture(false);
    expect(f.source.getMeasurementSnapshot().sourceGeometry).toMatchObject({
      video: { width: 8, height: 8 },
      canvas: { width: 4, height: 8 },
      plannedReadback: { width: 8, height: 8 },
      readbackPolicy: "sdk-video-size-no-downsampling",
      realityTexture: null,
    });
    f.source.onCanvasSizeChange({ canvasWidth: 4, canvasHeight: 8 });
    expect(f.onDiagnostic).not.toHaveBeenCalled();
    f.source.onVideoSizeChange({ videoWidth: 16, videoHeight: 8 });
    expect(f.onDiagnostic).toHaveBeenCalledTimes(1);
    expect(f.source.getMeasurementSnapshot().sourceGeometry?.video.width).toBe(16);
  });

  it("observes callback texture dimensions even when capture is blocked without asserting synchronization", () => {
    const f = fixture(false);
    f.setBusy();
    const frameStartResult = {
      textureWidth: 1024,
      textureHeight: 768,
      orientation: 90,
      videoTime: 2,
    };
    f.source.onUpdate({ frameStartResult });
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation).toMatchObject({
      callbackAtMs: 100,
      dimensions: { width: 1024, height: 768 },
      orientation: 90,
      sourceVideoTime: 2,
      realityResponseSynchronization: "unknown",
    });
    frameStartResult.textureWidth = 99;
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation?.dimensions?.width).toBe(
      1024,
    );
    f.source.onUpdate({
      frameStartResult: { textureWidth: 1024, textureHeight: 768, orientation: 90, videoTime: 3 },
    });
    expect(f.onDiagnostic).toHaveBeenCalledTimes(1);
    f.source.onUpdate({ frameStartResult: { textureWidth: NaN, textureHeight: -1 } });
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation?.dimensions).toBeNull();
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation?.dimensionStatus).toBe(
      "invalid",
    );
    f.source.onUpdate({});
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation?.dimensionStatus).toBe(
      "missing",
    );
  });

  it("attaches capture metadata independently of the frame handed to consumers", () => {
    const f = fixture(false);
    f.source.onUpdate({
      frameStartResult: { textureWidth: 1024, textureHeight: 768 },
      processCpuResult: { reality: f.reality },
    });
    const frame = f.onFrame.mock.calls[0]![0];
    expect(frame.metadata.cameraTextureObservation.dimensions).toEqual({
      width: 1024,
      height: 768,
    });
    frame.metadata.intrinsics.fx = 0;
    frame.metadata.cameraTextureObservation.dimensions.width = 1;
    expect(f.source.getMeasurementSnapshot().lastFrameMetadata?.intrinsics.fx).toBe(4);
    expect(f.source.getMeasurementSnapshot().lastCameraTextureObservation?.dimensions?.width).toBe(
      1024,
    );
  });

  it("ignores extra SDK callback fields when planning readback and comparing geometry", () => {
    const f = fixture(false);
    f.update();
    const same = {
      canvasWidth: 4,
      canvasHeight: 8,
      GLctx: f.gl,
      framework: { dispatchEvent() {} },
    };
    f.source.onCanvasSizeChange(same);
    expect(f.source.getMeasurementSnapshot().sourceGeometry?.plannedReadback).toEqual({
      width: 8,
      height: 8,
    });
    expect(f.renderer.destroy).not.toHaveBeenCalled();
    f.source.onVideoSizeChange({ videoWidth: 16, videoHeight: 8, extra: "sdk" } as never);
    expect(f.source.getMeasurementSnapshot().sourceGeometry?.plannedReadback).toEqual({
      width: 16,
      height: 8,
    });
    f.tick();
    f.update();
    expect(f.onFrame.mock.calls.at(-1)![0]).toMatchObject({ width: 16, height: 8 });
    f.source.onDeviceOrientationChange({
      canvasWidth: 8,
      canvasHeight: 4,
      orientation: 90,
    } as never);
    expect(f.source.getMeasurementSnapshot().sourceGeometry?.plannedReadback).toEqual({
      width: 16,
      height: 8,
    });
  });

  it.each([undefined, "8", NaN, 0, -1, 4.5])(
    "rejects an invalid known dimension %s without treating it as an unknown callback field",
    (canvasWidth) => {
      const f = fixture(false);
      f.source.onCanvasSizeChange({ canvasWidth, canvasHeight: 8 } as never);
      expect(f.source.getMeasurementSnapshot().sourceGeometry?.plannedReadback).toBeNull();
      f.update();
      expect(f.onFrame).not.toHaveBeenCalled();
      expect(f.source.getMeasurementSnapshot().skipped["invalid-geometry"]).toBe(1);
    },
  );

  it("does not recreate the readback target for unchanged source geometry", () => {
    const f = fixture(false);
    f.update();
    f.source.onCanvasSizeChange({ canvasWidth: 4, canvasHeight: 8 });
    f.tick();
    f.update();
    expect(f.createRenderer).toHaveBeenCalledTimes(1);
    expect(f.renderer.destroy).not.toHaveBeenCalled();
    f.source.onCanvasSizeChange({ canvasWidth: 8, canvasHeight: 4 });
    expect(f.source.getMeasurementSnapshot().sourceGeometry?.plannedReadback).toEqual({
      width: 8,
      height: 8,
    });
    f.tick();
    f.update();
    expect(f.createRenderer).toHaveBeenCalledTimes(2);
  });

  it("keeps unavailable source dimensions explicit and protects geometry from diagnostics mutation", () => {
    const f = fixture(false);
    f.source.onVideoSizeChange({ videoWidth: 0, videoHeight: 8 });
    const event = f.onDiagnostic.mock.calls.find(([name]) => name === "frame-source-geometry")![1];
    event.video.width = 999;
    const snapshot = f.source.getMeasurementSnapshot();
    expect(snapshot.sourceGeometry).toMatchObject({
      video: { width: 0, height: 8 },
      plannedReadback: null,
      realityTexture: null,
    });
    f.update();
    expect(f.onFrame).not.toHaveBeenCalled();
    expect(f.source.getMeasurementSnapshot().skipped["invalid-geometry"]).toBe(1);
    f.source.onDetach();
    expect(f.source.getMeasurementSnapshot().sourceGeometry).toEqual(snapshot.sourceGeometry);
  });

  it("accounts for every update without filling the event log and preserves unknown calibration", () => {
    const f = fixture(false);
    f.update();
    f.update();
    f.tick();
    f.setBusy();
    f.update();
    const snapshot = f.source.getMeasurementSnapshot();
    expect(snapshot).toMatchObject({
      updates: 3,
      captured: 1,
      error: 0,
      skipped: { interval: 1, blocked: 1 },
      lastFrameMetadata: {
        callbackAtMs: 100,
        sensorExposureAtMs: null,
        timestampBasis: "sdk-callback-performance-now",
        sourceVideoTime: 1,
        intrinsicsSource: "sdk-render-projection-inverse-cover",
        distortion: "unknown",
        rectification: "unknown",
        sdkMapEpoch: null,
        output: { width: 8, height: 8 },
      },
    });
    expect(f.onDiagnostic).toHaveBeenCalledTimes(1);
    f.source.onDetach();
    expect(f.source.getMeasurementSnapshot()).toEqual(snapshot);
    snapshot.skipped.interval = 999;
    expect(f.source.getMeasurementSnapshot().skipped.interval).toBe(1);
  });

  it("keeps separate skip denominators for repeated frames, missing pixels, and missing projection", () => {
    const f = fixture(false);
    f.source.onUpdate({ frameStartResult: { repeatFrame: true } });
    f.source.onUpdate({ processCpuResult: { reality: { intrinsics: projection } } });
    f.source.onUpdate({
      processCpuResult: { reality: { realityTexture: f.reality.realityTexture } },
    });
    expect(f.source.getMeasurementSnapshot()).toMatchObject({
      updates: 3,
      captured: 0,
      skipped: { "repeat-frame": 1, "missing-texture": 1, "missing-intrinsics": 1 },
    });
  });
  it("counts synchronous consumer failure as one failed update while preserving capture evidence", () => {
    const f = fixture(false);
    f.onFrame.mockImplementation(() => {
      throw new Error("consumer failed");
    });
    f.update();
    const snapshot = f.source.getMeasurementSnapshot();
    expect(snapshot.updates).toBe(
      snapshot.captured +
        snapshot.error +
        Object.values(snapshot.skipped).reduce((sum, count) => sum + count, 0),
    );
    expect(snapshot).toMatchObject({ captured: 0, error: 1, lastFrameMetadata: { frameId: 1 } });
  });

  it("counts a readback failure once and subsequent failed-source exclusions separately", () => {
    const f = fixture(false);
    f.gl.readPixels.mockImplementation(() => {
      throw new Error("readback failed");
    });
    f.update();
    f.update();
    expect(f.source.getMeasurementSnapshot()).toMatchObject({
      updates: 2,
      captured: 0,
      error: 1,
      skipped: { failed: 1 },
    });
  });
  it("does not treat a non-finite SDK video label as a sensor timestamp", () => {
    const f = fixture(false);
    f.source.onUpdate({
      frameStartResult: { videoTime: NaN },
      processCpuResult: { reality: f.reality },
    });
    expect(f.onFrame.mock.calls[0]![0].sourceVideoTime).toBeNull();
    expect(f.source.getMeasurementSnapshot().lastFrameMetadata).toMatchObject({
      sourceVideoTime: null,
      sensorExposureAtMs: null,
    });
  });
  it("converts a column-major Three projection into top-left pixel intrinsics", () => {
    expect(projectionToIntrinsics(projection, 640, 480)).toEqual({
      fx: 640,
      fy: 720,
      cx: 256,
      cy: 216,
    });
  });

  it("projects 3D points consistently between SDK -Z/+Y and detector +Z/-Y coordinates", () => {
    const width = 640;
    const height = 480;
    const k = projectionToIntrinsics(projection, width, height);
    const x = 0.1;
    const y = 0.2;
    const z = -2;
    const ndcX = (projection[0]! * x + projection[8]! * z) / -z;
    const ndcY = (projection[5]! * y + projection[9]! * z) / -z;
    expect((k.fx * x) / -z + k.cx).toBeCloseTo(((ndcX + 1) * width) / 2);
    expect((k.fy * -y) / -z + k.cy).toBeCloseTo(((1 - ndcY) * height) / 2);
  });

  it("matches the SDK background cover crop in portrait and landscape", () => {
    const portrait = coverViewport(1920, 1080, 480, 960);
    expect(portrait.offsetX).toBeCloseTo(-613.3333333333334);
    expect(portrait.width).toBeCloseTo(1706.6666666666667);
    expect(portrait.offsetY).toBe(0);
    expect(portrait.height).toBe(960);
    const landscape = coverViewport(1080, 1920, 960, 480);
    expect(landscape.offsetY).toBeCloseTo(-613.3333333333334);
    expect(landscape.height).toBeCloseTo(1706.6666666666667);
    expect(landscape.offsetX).toBe(0);
    expect(landscape.width).toBe(960);
  });

  it("captures pose and texture from the same reality response, with owned grayscale pixels", () => {
    const f = fixture();
    f.update();
    expect(f.createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ toTexture: { width: 8, height: 8 }, flipY: true }),
    );
    expect(f.renderer.render).toHaveBeenCalledWith({
      renderTexture: "sdk-response-texture",
      viewport: { offsetX: 0, offsetY: 0, width: 8, height: 8 },
    });
    const frame = f.onFrame.mock.calls[0]![0];
    expect(frame).toMatchObject({
      id: 1,
      timestampMs: 100,
      sourceVideoTime: 1,
      width: 8,
      height: 8,
      worldFromCamera: { position: { x: 1, y: 2, z: 3 } },
    });
    expect([...frame.pixels]).toEqual(Array(64).fill(90));
    f.reality.position.x = 9;
    expect(frame.worldFromCamera.position.x).toBe(1);
    expect(f.state.get(2)).toBe("existing-framebuffer");
    expect(f.state.get(3)).toBe(8);
  });

  it("captures tag pixels and projection without a SLAM pose or NORMAL status", () => {
    const f = fixture(false);
    f.reality.position = undefined as never;
    f.reality.rotation = undefined as never;
    f.reality.trackingStatus = "LIMITED";
    f.update();
    expect(f.onFrame).toHaveBeenCalledOnce();
    expect(f.onFrame.mock.calls[0]![0].worldFromCamera).toBeNull();
    expect(f.onFrame.mock.calls[0]![0].intrinsics.fx).toBe(4);
  });
  it("attaches a valid NORMAL pose when world tracking is optional", () => {
    const f = fixture(false);
    f.update();
    expect(f.onFrame.mock.calls[0]![0].worldFromCamera).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    f.reality.position.x = 9;
    expect(f.onFrame.mock.calls[0]![0].worldFromCamera.position.x).toBe(1);
  });
  it("applies backpressure and interval limits without starting another camera loop", () => {
    const f = fixture();
    f.update();
    f.update();
    expect(f.onFrame).toHaveBeenCalledTimes(1);
    f.tick();
    f.setBusy();
    f.update();
    expect(f.onFrame).toHaveBeenCalledTimes(1);
  });

  it("refuses missing synchronized texture or untracked poses", () => {
    const f = fixture();
    f.reality.trackingStatus = "LIMITED";
    f.update();
    expect(f.onFrame).not.toHaveBeenCalled();
    f.reality.trackingStatus = "NORMAL";
    f.reality.realityTexture = undefined as never;
    f.update();
    expect(f.onFrame).not.toHaveBeenCalled();
  });

  it("restores framebuffer and pack alignment on readback failure and reports once", () => {
    const f = fixture();
    f.gl.readPixels.mockImplementation(() => {
      throw new Error("readback failed");
    });
    f.update();
    f.tick();
    f.update();
    expect(
      f.onDiagnostic.mock.calls.filter(([event]) => event === "frame-source-error"),
    ).toHaveLength(1);
    expect(f.onDiagnostic).toHaveBeenCalledWith(
      "frame-source-error",
      expect.objectContaining({ message: "readback failed" }),
    );
    expect(f.state.get(2)).toBe("existing-framebuffer");
    expect(f.state.get(3)).toBe(8);
  });

  it("reports unsupported GPU readback instead of emitting an invalid black frame", () => {
    const f = fixture();
    f.gl.getError.mockReturnValue(1282);
    f.update();
    expect(f.onFrame).not.toHaveBeenCalled();
    expect(f.onDiagnostic).toHaveBeenCalledWith("frame-source-error", {
      message: "SDK camera readback WebGL error 1282",
    });
  });

  it("releases its framebuffer on detach and recreates on resize", () => {
    const f = fixture();
    f.update();
    f.source.onCanvasSizeChange({ canvasWidth: 8, canvasHeight: 4 });
    expect(f.renderer.destroy).toHaveBeenCalledTimes(1);
    f.tick();
    f.update();
    expect(f.createRenderer).toHaveBeenCalledTimes(2);
    f.source.onDetach();
    expect(f.renderer.destroy).toHaveBeenCalledTimes(2);
  });

  it("rejects projection matrices outside a perspective pinhole contract", () => {
    expect(() => projectionToIntrinsics(Array(16).fill(0), 640, 480)).toThrow();
    expect(() => projectionToIntrinsics([...projection.slice(0, 15), NaN], 640, 480)).toThrow();
  });
});
