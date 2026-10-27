import { describeTrackingInput } from "../tracking/raw-tracking";
import type { RigidPose } from "./alignment";
import { MAX_DETECTOR_PIXELS } from "./detector-frame";
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface FiducialFrame {
  id: number;
  timestampMs: number;
  sourceVideoTime: number | null;
  width: number;
  height: number;
  pixels: Uint8Array;
  intrinsics: CameraIntrinsics;
  worldFromCamera: RigidPose | null;
  metadata?: FrameCaptureMetadata;
  captureSessionId?: number;
}

export interface CameraTextureObservation {
  callbackAtMs: number | null;
  dimensions: { width: number; height: number } | null;
  dimensionStatus: "available" | "missing" | "invalid";
  orientation: number | null;
  sourceVideoTime: number | null;
  source: "sdk-onupdate-frame-start-result";
  realityResponseSynchronization: "unknown";
}

export interface SourceGeometrySnapshot {
  video: { width: number; height: number };
  canvas: { width: number; height: number };
  plannedReadback: { width: number; height: number } | null;
  maxPixels: number;
  readbackPolicy: "sdk-video-size-no-downsampling";
  realityTexture: null;
  source: "sdk-size-callbacks";
}

export interface FrameMeasurementSnapshot {
  updates: number;
  captured: number;
  error: number;
  skipped: Record<string, number>;
  sourceGeometry: SourceGeometrySnapshot | null;
  lastCameraTextureObservation: CameraTextureObservation | null;
  lastFrameMetadata: FrameCaptureMetadata | null;
}

export interface FrameCaptureMetadata {
  trackingInput?: ReturnType<typeof describeTrackingInput>;
  sdkPoseAttachment?: {
    trackingStatusAllowed: boolean;
    positionPresent: boolean;
    rotationPresent: boolean;
    validPose: boolean;
    attached: boolean;
    reason: "attached" | "tracking-status-not-normal" | "missing-pose" | "invalid-pose";
  };
  frameId: number;
  callbackAtMs: number;
  readbackCompletedAtMs: number;
  pixelsReadyAtMs: number;
  timestampBasis: "sdk-callback-performance-now";
  sensorExposureAtMs: null;
  sourceVideoTime: number | null;
  sourceVideoTimeBasis: "sdk-callback-label";
  intrinsicsSource: "sdk-render-projection-inverse-cover";
  intrinsics: CameraIntrinsics;
  projection: number[];
  distortion: "unknown";
  rectification: "unknown";
  sdkPoseTimeAtMs: null;
  sdkMapEpoch: null;
  video: { width: number; height: number };
  canvas: { width: number; height: number };
  output: { width: number; height: number };
  viewport: Viewport;
  displayViewport: Viewport;
  normalizedVideoToDisplay: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
  pixelOrigin: "top-left";
  textureSource: "sdk-reality-response";
  cameraTextureObservation: CameraTextureObservation;
  realityTextureDimensions: null;
}

type Gl = WebGLRenderingContext | WebGL2RenderingContext;
interface Viewport {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}
export interface FrameRenderer {
  render(options: { renderTexture: WebGLTexture; viewport: Viewport }): unknown;
  framebuffer(): WebGLFramebuffer;
  destroy(): void;
}
export interface FrameSourceOptions {
  createRenderer(options: {
    GLctx: Gl;
    toTexture: { width: number; height: number };
    flipY: boolean;
  }): FrameRenderer;
  canCapture(): boolean;
  captureBlockReason?(): string | null;
  onFrame(frame: FiducialFrame): void;
  onDiagnostic(event: string, detail: unknown): void;
  requireWorldTracking?: boolean;
  maxPixels?: number;
  intervalMs?: number;
  now?: () => number;
}
interface Geometry {
  canvasWidth: number;
  canvasHeight: number;
  videoWidth: number;
  videoHeight: number;
}
const geometryKeys = ["canvasWidth", "canvasHeight", "videoWidth", "videoHeight"] as const;
function validGeometry(value: Geometry): boolean {
  return geometryKeys.every((key) => Number.isInteger(value[key]) && value[key] > 0);
}

interface RealityResponse {
  realityTexture?: WebGLTexture;
  intrinsics?: ArrayLike<number>;
  position?: RigidPose["position"];
  rotation?: RigidPose["rotation"];
  trackingStatus?: unknown;
  trackingReason?: unknown;
}

export function projectionToIntrinsics(
  projection: ArrayLike<number>,
  width: number,
  height: number,
): CameraIntrinsics {
  const values = Array.from(projection);
  if (
    values.length !== 16 ||
    values.some((value) => !Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0 ||
    values[0]! <= 0 ||
    values[5]! <= 0 ||
    Math.abs(values[11]! + 1) > 1e-5 ||
    Math.abs(values[15]!) > 1e-5 ||
    [1, 2, 3, 4, 6, 7, 12, 13].some((index) => Math.abs(values[index]!) > 1e-5)
  ) {
    throw new Error("SDK projection does not satisfy the perspective pinhole contract");
  }
  // The SDK projection uses Three's -Z camera; detector pixels use top-left +Y down.
  return {
    fx: (values[0]! * width) / 2,
    fy: (values[5]! * height) / 2,
    cx: ((1 - values[8]!) * width) / 2,
    cy: ((1 + values[9]!) * height) / 2,
  };
}

export function coverViewport(
  videoWidth: number,
  videoHeight: number,
  width: number,
  height: number,
): Viewport {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  return {
    offsetX: (width - drawnWidth) / 2,
    offsetY: (height - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

export function videoIntrinsicsFromProjection(
  projection: ArrayLike<number>,
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): CameraIntrinsics {
  if (
    ![videoWidth, videoHeight, canvasWidth, canvasHeight].every((v) => Number.isInteger(v) && v > 0)
  ) {
    throw new Error("Invalid SDK video or canvas dimensions");
  }
  const canvas = projectionToIntrinsics(projection, canvasWidth, canvasHeight);
  const viewport = coverViewport(videoWidth, videoHeight, canvasWidth, canvasHeight);
  const scale = viewport.width / videoWidth;
  // The SDK projection describes its cover-cropped canvas, not the complete video.
  return {
    fx: canvas.fx / scale,
    fy: canvas.fy / scale,
    cx: (canvas.cx - viewport.offsetX) / scale,
    cy: (canvas.cy - viewport.offsetY) / scale,
  };
}

export function createFrameSource(options: FrameSourceOptions) {
  const now = options.now ?? (() => performance.now());
  const maxPixels = options.maxPixels ?? MAX_DETECTOR_PIXELS;
  const intervalMs = options.intervalMs ?? 120;
  if (
    !Number.isSafeInteger(maxPixels) ||
    maxPixels < 1 ||
    maxPixels > MAX_DETECTOR_PIXELS ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error("Invalid SDK frame capture pixel budget or interval");
  }
  let gl: Gl | null = null;
  let geometry: Geometry | null = null;
  let renderer: FrameRenderer | null = null;
  let outputWidth = 0;
  let outputHeight = 0;
  let rgba = new Uint8Array();
  let lastCaptureMs = -Infinity;
  let frameId = 0;
  let failed = false;
  const measurement: FrameMeasurementSnapshot = {
    updates: 0,
    captured: 0,
    error: 0,
    skipped: {},
    lastFrameMetadata: null,
    sourceGeometry: null,
    lastCameraTextureObservation: null,
  };
  const skip = (reason: string) => {
    measurement.skipped[reason] = (measurement.skipped[reason] ?? 0) + 1;
  };

  const inspectGlErrors = (phase: "before-capture" | "capture") => {
    const errors: number[] = [];
    let contextLost = gl!.isContextLost();
    let limitReached = false;
    for (let index = 0; index < 32; index++) {
      const error = gl!.getError();
      if (error === gl!.NO_ERROR) break;
      errors.push(error);
      if (error === gl!.CONTEXT_LOST_WEBGL) {
        contextLost = true;
        break;
      }
      if (index === 31) limitReached = true;
    }
    if (errors.length || contextLost || limitReached) {
      options.onDiagnostic("frame-source-gl-errors", {
        phase,
        errors,
        contextLost,
        limitReached,
      });
    }
    if (contextLost) throw new Error("SDK camera capture WebGL context is lost");
    if (limitReached) throw new Error("SDK camera capture WebGL error drain limit reached");
    return errors;
  };

  const release = () => {
    renderer?.destroy();
    renderer = null;
    rgba = new Uint8Array();
  };
  const recordGeometry = () => {
    if (!geometry) return;
    const valid = validGeometry(geometry);
    const snapshot: SourceGeometrySnapshot = {
      video: { width: geometry.videoWidth, height: geometry.videoHeight },
      canvas: { width: geometry.canvasWidth, height: geometry.canvasHeight },
      plannedReadback: valid ? { width: geometry.videoWidth, height: geometry.videoHeight } : null,
      maxPixels,
      readbackPolicy: "sdk-video-size-no-downsampling",
      realityTexture: null,
      source: "sdk-size-callbacks",
    };
    measurement.sourceGeometry = snapshot;
    options.onDiagnostic("frame-source-geometry", structuredClone(snapshot));
  };
  const resize = (value: Partial<Geometry>) => {
    if (!geometry) return;
    const next = { ...geometry };
    for (const key of geometryKeys) {
      if (Object.hasOwn(value, key)) next[key] = value[key]!;
    }
    if (geometryKeys.every((key) => Object.is(next[key], geometry![key]))) return;
    geometry = next;
    release();
    recordGeometry();
  };

  return {
    name: "audience-fiducial-frame",
    getMeasurementSnapshot: (): FrameMeasurementSnapshot => structuredClone(measurement),
    onStart(value: Geometry & { GLctx: Gl }) {
      release();
      gl = value.GLctx;
      geometry = {
        canvasWidth: value.canvasWidth,
        canvasHeight: value.canvasHeight,
        videoWidth: value.videoWidth,
        videoHeight: value.videoHeight,
      };
      measurement.lastCameraTextureObservation = null;
      recordGeometry();
      failed = false;
      lastCaptureMs = -Infinity;
    },
    onCanvasSizeChange(value: { canvasWidth: number; canvasHeight: number }) {
      resize(value);
    },
    onVideoSizeChange(value: { videoWidth: number; videoHeight: number }) {
      resize(value);
    },
    onDeviceOrientationChange(value: Partial<Geometry>) {
      resize(value);
    },
    onDetach() {
      release();
      gl = null;
      geometry = null;
    },
    onUpdate(value: {
      frameStartResult?: {
        videoTime?: number;
        repeatFrame?: boolean;
        textureWidth?: number;
        textureHeight?: number;
        orientation?: number;
      };
      processCpuResult?: { reality?: RealityResponse };
    }) {
      measurement.updates++;
      const timestampMs = now();
      const start = value.frameStartResult;
      const width = start?.textureWidth;
      const height = start?.textureHeight;
      const available =
        typeof width === "number" &&
        Number.isInteger(width) &&
        width > 0 &&
        typeof height === "number" &&
        Number.isInteger(height) &&
        height > 0;
      const observation: CameraTextureObservation = {
        callbackAtMs: Number.isFinite(timestampMs) ? timestampMs : null,
        dimensions: available ? { width, height } : null,
        dimensionStatus: available
          ? "available"
          : width === undefined && height === undefined
            ? "missing"
            : "invalid",
        orientation:
          typeof start?.orientation === "number" && [-90, 0, 90, 180].includes(start.orientation)
            ? start.orientation
            : null,
        sourceVideoTime:
          typeof start?.videoTime === "number" && Number.isFinite(start.videoTime)
            ? start.videoTime
            : null,
        source: "sdk-onupdate-frame-start-result",
        realityResponseSynchronization: "unknown",
      };
      const previous = measurement.lastCameraTextureObservation;
      measurement.lastCameraTextureObservation = observation;
      if (
        !previous ||
        JSON.stringify([previous.dimensions, previous.dimensionStatus, previous.orientation]) !==
          JSON.stringify([
            observation.dimensions,
            observation.dimensionStatus,
            observation.orientation,
          ])
      ) {
        options.onDiagnostic("frame-source-camera-texture", structuredClone(observation));
      }
      if (!gl || !geometry) return skip("not-started");
      if (failed) return skip("failed");
      if (!options.canCapture()) return skip(options.captureBlockReason?.() ?? "blocked");
      if (!Number.isFinite(timestampMs)) return skip("invalid-clock");
      if (value.frameStartResult?.repeatFrame) return skip("repeat-frame");
      if (timestampMs - lastCaptureMs < intervalMs) return skip("interval");
      const reality = value.processCpuResult?.reality;
      if (!reality?.realityTexture) return skip("missing-texture");
      if (!reality.intrinsics) return skip("missing-intrinsics");
      let worldFromCamera: RigidPose | null = null;
      const position = reality.position;
      const rotation = reality.rotation;
      const validPose =
        position &&
        rotation &&
        [position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w].every(
          Number.isFinite,
        ) &&
        Math.abs(Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) - 1) <= 1e-3;
      if (options.requireWorldTracking !== false) {
        if (reality.trackingStatus !== "NORMAL") return skip("tracking-unavailable");
        if (!position || !rotation) return skip("missing-pose");
        if (!validPose) return skip("invalid-pose");
      }
      if (reality.trackingStatus === "NORMAL" && validPose) {
        worldFromCamera = { position: { ...position }, rotation: { ...rotation } };
      }
      if (!validGeometry(geometry)) return skip("invalid-geometry");
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const packAlignment = gl.getParameter(gl.PACK_ALIGNMENT) as number;
      const gl2 = "READ_FRAMEBUFFER" in gl ? (gl as WebGL2RenderingContext) : null;
      const readFramebuffer = gl2?.getParameter(
        gl2.READ_FRAMEBUFFER_BINDING,
      ) as WebGLFramebuffer | null;
      const pixelPackBuffer = gl2?.getParameter(
        gl2.PIXEL_PACK_BUFFER_BINDING,
      ) as WebGLBuffer | null;
      const packKeys = gl2 ? [gl2.PACK_ROW_LENGTH, gl2.PACK_SKIP_ROWS, gl2.PACK_SKIP_PIXELS] : [];
      const packValues = packKeys.map((key) => gl!.getParameter(key) as number);
      try {
        // The SDK and presentation renderer share this context. Earlier errors belong
        // to their own operations; establish a clean boundary before capture work.
        inspectGlErrors("before-capture");
        if (!renderer) {
          outputWidth = geometry.videoWidth;
          outputHeight = geometry.videoHeight;
          if (outputWidth * outputHeight > maxPixels) {
            throw new Error(
              `SDK video frame exceeds the ${maxPixels} pixel capture budget; downsampling is disabled`,
            );
          }
          // SDK video dimensions are reported geometry, not a sensor-native resolution guarantee.
          // Public SDK create/render preserve VAO, program, viewport, textures and buffers.
          // create also changes GENERATE_MIPMAP_HINT, so preserve that additional state here.
          const hint = gl.getParameter(gl.GENERATE_MIPMAP_HINT) as number;
          try {
            renderer = options.createRenderer({
              GLctx: gl,
              toTexture: { width: outputWidth, height: outputHeight },
              flipY: true,
            });
          } finally {
            gl.hint(gl.GENERATE_MIPMAP_HINT, hint);
          }
          rgba = new Uint8Array(outputWidth * outputHeight * 4);
        }
        const intrinsics = videoIntrinsicsFromProjection(
          reality.intrinsics,
          outputWidth,
          outputHeight,
          geometry.canvasWidth,
          geometry.canvasHeight,
        );
        const displayViewport = coverViewport(
          outputWidth,
          outputHeight,
          geometry.canvasWidth,
          geometry.canvasHeight,
        );
        // Read from the reality response rather than substituting the current camera texture.
        // The public callback does not establish exposure/pose synchronization.
        // Preserve the complete reported video extent; flipY makes readPixels top-left.
        renderer.render({
          renderTexture: reality.realityTexture,
          viewport: coverViewport(
            geometry.videoWidth,
            geometry.videoHeight,
            outputWidth,
            outputHeight,
          ),
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.framebuffer());
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error("SDK camera capture framebuffer is incomplete");
        }
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        if (gl2) {
          gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
          for (const key of packKeys) gl2.pixelStorei(key, 0);
        }
        gl.readPixels(0, 0, outputWidth, outputHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const captureErrors = inspectGlErrors("capture");
        if (captureErrors.length) {
          throw new Error(`SDK camera readback WebGL error ${captureErrors[0]}`);
        }
        const readbackCompletedAtMs = now();
        const pixels = new Uint8Array(outputWidth * outputHeight);
        for (let i = 0; i < pixels.length; i++) {
          const offset = i * 4;
          pixels[i] =
            (77 * rgba[offset]! + 150 * rgba[offset + 1]! + 29 * rgba[offset + 2]! + 128) >> 8;
        }
        lastCaptureMs = timestampMs;
        const sourceVideoTime = value.frameStartResult?.videoTime;
        const videoTime =
          typeof sourceVideoTime === "number" && Number.isFinite(sourceVideoTime)
            ? sourceVideoTime
            : null;
        const pixelsReadyAtMs = now();
        const capturedFrame: FiducialFrame = {
          id: ++frameId,
          timestampMs,
          // videoTime labels the SDK callback, not a guaranteed sensor exposure timestamp.
          sourceVideoTime: videoTime,
          width: outputWidth,
          height: outputHeight,
          pixels,
          intrinsics,
          worldFromCamera,
        };
        measurement.lastFrameMetadata = {
          frameId,
          callbackAtMs: timestampMs,
          readbackCompletedAtMs,
          pixelsReadyAtMs,
          timestampBasis: "sdk-callback-performance-now",
          sensorExposureAtMs: null,
          sourceVideoTime: videoTime,
          sourceVideoTimeBasis: "sdk-callback-label",
          trackingInput: describeTrackingInput(reality),
          sdkPoseAttachment: {
            trackingStatusAllowed: reality.trackingStatus === "NORMAL",
            positionPresent: !!position,
            rotationPresent: !!rotation,
            validPose: !!validPose,
            attached: worldFromCamera !== null,
            reason: worldFromCamera
              ? "attached"
              : reality.trackingStatus !== "NORMAL"
                ? "tracking-status-not-normal"
                : !position || !rotation
                  ? "missing-pose"
                  : "invalid-pose",
          },
          intrinsicsSource: "sdk-render-projection-inverse-cover",
          intrinsics: { ...intrinsics },
          projection: Array.from(reality.intrinsics),
          distortion: "unknown",
          rectification: "unknown",
          sdkPoseTimeAtMs: null,
          sdkMapEpoch: null,
          video: { width: geometry.videoWidth, height: geometry.videoHeight },
          canvas: { width: geometry.canvasWidth, height: geometry.canvasHeight },
          output: { width: outputWidth, height: outputHeight },
          viewport: coverViewport(
            geometry.videoWidth,
            geometry.videoHeight,
            outputWidth,
            outputHeight,
          ),
          displayViewport,
          normalizedVideoToDisplay: {
            scaleX: displayViewport.width / geometry.canvasWidth,
            scaleY: displayViewport.height / geometry.canvasHeight,
            offsetX: displayViewport.offsetX / geometry.canvasWidth,
            offsetY: displayViewport.offsetY / geometry.canvasHeight,
          },
          pixelOrigin: "top-left",
          textureSource: "sdk-reality-response",
          cameraTextureObservation: structuredClone(observation),
          realityTextureDimensions: null,
        };
        capturedFrame.metadata = structuredClone(measurement.lastFrameMetadata);
        options.onFrame(capturedFrame);
        measurement.captured++;
      } catch (error) {
        measurement.error++;
        failed = true;
        options.onDiagnostic("frame-source-error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.pixelStorei(gl.PACK_ALIGNMENT, packAlignment);
        if (gl2) {
          gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, readFramebuffer);
          gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, pixelPackBuffer);
          packKeys.forEach((key, index) => gl2.pixelStorei(key, packValues[index]!));
        }
      }
    },
  };
}
