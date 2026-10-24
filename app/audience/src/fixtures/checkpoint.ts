import type { createAnchorSession } from "../experience/anchor-session";
import type { createRuntimePlayback } from "../runtime/playback";

type Context = ReturnType<ReturnType<typeof createAnchorSession>["getDiagnosticContext"]>;
type RuntimeSnapshot = ReturnType<ReturnType<typeof createRuntimePlayback>["getSnapshot"]>;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function numbers(value: unknown, keys: readonly string[]) {
  const source = object(value);
  return Object.fromEntries(keys.map((key) => [key, number(source[key])]));
}
function dimensions(value: unknown) {
  return value == null ? null : numbers(value, ["width", "height"]);
}
const counterNames = [
  "submitted",
  "completed",
  "delivered",
  "stale",
  "cancelled",
  "error",
  "pending",
];
const skippedNames = [
  "not-started",
  "failed",
  "blocked",
  "invalid-clock",
  "repeat-frame",
  "interval",
  "missing-texture",
  "missing-intrinsics",
  "tracking-unavailable",
  "missing-pose",
  "invalid-pose",
  "invalid-geometry",
  "tracking-not-normal",
  "worker-busy",
];

function startupSummary(value: unknown) {
  const source = object(value);
  const phases = [
    "idle",
    "engine-loading",
    "slam-loading",
    "pipeline-starting",
    "running",
    "stopped",
    "error",
  ];
  return {
    phase: phases.includes(String(source.phase)) ? (source.phase as string) : "unknown",
    ...numbers(source, [
      "updates",
      "realityUpdates",
      "poseUpdates",
      "firstUpdateAtMs",
      "lastUpdateAtMs",
    ]),
  };
}
function rawValueSummary(value: unknown) {
  const source = object(value);
  const types = ["undefined", "null", "string", "number", "boolean", "object"];
  return {
    present: source.present === true,
    type: types.includes(String(source.type)) ? (source.type as string) : "unknown",
    value:
      typeof source.value === "string" && /^[A-Z][A-Z0-9_ -]{0,63}$/.test(source.value)
        ? source.value
        : typeof source.value === "number" && Number.isFinite(source.value)
          ? source.value
          : typeof source.value === "boolean"
            ? source.value
            : null,
  };
}
function trackingRow(value: unknown) {
  if (value == null) return null;
  const source = object(value);
  return {
    ...numbers(source, ["sessionId", "callbackAtMs"]),
    appliedTrackingStatus:
      source.appliedTrackingStatus === "NORMAL"
        ? "NORMAL"
        : source.appliedTrackingStatus === "LIMITED"
          ? "LIMITED"
          : null,
    realityPresent: source.realityPresent === true,
    interpretation: ["normal", "limited", "missing", "unrecognized"].includes(
      String(source.interpretation),
    )
      ? (source.interpretation as string)
      : null,
    status: rawValueSummary(source.status),
    reason: rawValueSummary(source.reason),
    trackingStatus: rawValueSummary(source.trackingStatus),
    trackingReason: rawValueSummary(source.trackingReason),
  };
}
function trackingSummary(value: unknown) {
  const source = object(value);
  return {
    ...numbers(source, ["updates", "eventCount"]),
    lastUpdate: trackingRow(source.lastUpdate),
    lastEvent: trackingRow(source.lastEvent),
  };
}
function sensorSummary(value: unknown) {
  const source = object(value);
  return {
    ...numbers(source, [
      "motionEvents",
      "orientationEvents",
      "lastMotionAtMs",
      "lastOrientationAtMs",
    ]),
    accelerationAvailable: source.accelerationAvailable === true,
    rotationRateAvailable: source.rotationRateAvailable === true,
    orientationAvailable: source.orientationAvailable === true,
  };
}

function measurementSummary(value: unknown) {
  if (value == null) return null;
  const source = object(value);
  const capture = object(source.capture);
  const geometry = object(capture.sourceGeometry);
  const metadata = object(capture.lastFrameMetadata);
  return {
    ...numbers(source, [
      "sessionsStarted",
      "sessionId",
      "lastFrameSessionId",
      "lastGeometrySessionId",
      "lastCameraTextureSessionId",
    ]),
    startup: startupSummary(source.startup),
    sensors: sensorSummary(source.sensors),
    trackingDiagnostics: trackingSummary(source.trackingDiagnostics),
    detection: numbers(source.detection, counterNames),
    performance: numbers(source.performance, ["captureHz", "completionHz"]),
    capture: {
      ...numbers(capture, ["updates", "captured", "error"]),
      skipped: numbers(capture.skipped, skippedNames),
      sourceGeometry:
        capture.sourceGeometry == null
          ? null
          : {
              video: dimensions(geometry.video),
              canvas: dimensions(geometry.canvas),
              plannedReadback: dimensions(geometry.plannedReadback),
              maxPixels: number(geometry.maxPixels),
            },
      lastFrameMetadata:
        capture.lastFrameMetadata == null
          ? null
          : {
              ...numbers(metadata, [
                "frameId",
                "callbackAtMs",
                "readbackCompletedAtMs",
                "pixelsReadyAtMs",
              ]),
              video: dimensions(metadata.video),
              canvas: dimensions(metadata.canvas),
              output: dimensions(metadata.output),
              intrinsics: numbers(metadata.intrinsics, ["fx", "fy", "cx", "cy"]),
            },
    },
  };
}
const knownErrors = new Set([
  "SDK camera capture WebGL context is lost",
  "SDK camera capture WebGL error drain limit reached",
  "SDK camera capture framebuffer is incomplete",
  "SDK projection does not satisfy the perspective pinhole contract",
  "Invalid SDK video or canvas dimensions",
  "Invalid SDK frame capture pixel budget or interval",
  "カメラ映像の取得に失敗しました。検証ログを保存してください。",
  "presentation-render-failed",
  "runtime-input-requires-resync",
]);
export function safeCheckpointError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" &&
    (knownErrors.has(value) ||
      /^SDK camera readback WebGL error \d{1,5}$/.test(value) ||
      /^SDK video frame exceeds the \d{1,10} pixel capture budget; downsampling is disabled$/.test(
        value,
      ))
  )
    return value;
  return "unclassified-error";
}
function diagnosticDetail(event: string, value: unknown): unknown {
  const detail = object(value);
  switch (event) {
    case "sdk.startup":
      return startupSummary(detail);
    case "sdk.tracking.raw":
    case "sdk.tracking.raw-change":
    case "sdk.tracking.event":
      return trackingRow(detail);
    case "frame-source-gl-errors":
      return {
        phase:
          detail.phase === "capture" || detail.phase === "before-capture" ? detail.phase : null,
        errors: Array.isArray(detail.errors)
          ? detail.errors
              .filter((value) => typeof value === "number" && Number.isSafeInteger(value))
              .slice(0, 32)
          : [],
        contextLost: detail.contextLost === true,
        limitReached: detail.limitReached === true,
      };
    case "frame-source-error":
    case "experiment.detector-error":
    case "experiment.enable-error":
      return { message: safeCheckpointError(detail.message) };
    case "error":
      return { message: safeCheckpointError(value) };
    case "display.layout":
      return numbers(detail, [
        "viewportWidth",
        "viewportHeight",
        "devicePixelRatio",
        "backingWidth",
        "backingHeight",
      ]);
    case "sdk.started":
      return numbers(detail, ["videoWidth", "videoHeight", "canvasWidth", "canvasHeight"]);
    case "sdk.configuration":
      return {
        disableWorldTracking: detail.disableWorldTracking === true,
        sourceReadbackEnabled: detail.sourceReadbackEnabled === true,
        sourceRegistered: detail.sourceRegistered === true,
      };
    case "session.start":
      return { normalWarmupMs: number(detail.normalWarmupMs ?? detail.normalWaitMs) };
    default:
      return undefined;
  }
}
export function summarizeTrackingDiagnostics(context: Context | null | undefined) {
  return {
    measurementSnapshot: measurementSummary(context?.measurementSnapshot),
    records: (context?.records ?? [])
      .flatMap((row) => {
        const detail = diagnosticDetail(row.event, row.detail);
        return detail === undefined ? [] : [{ timeMs: row.timeMs, event: row.event, detail }];
      })
      .slice(-80),
    droppedSamples: context?.droppedSamples ?? 0,
    droppedTransitions: context?.droppedTransitions ?? 0,
  };
}
export function summarizeRuntime(state: RuntimeSnapshot | null | undefined) {
  if (!state) return null;
  return structuredClone({
    phase: state.phase,
    rendering: state.rendering,
    error: safeCheckpointError(state.error),
    reason: safeCheckpointError(state.reason),
    reliableSequence: state.reliableSequence,
    stateSequence: state.stateSequence,
    progression: state.view?.progression,
    clock: state.view?.clock,
    activeRuns: state.view?.activeRuns.length,
    variables: state.view?.variables,
  });
}
