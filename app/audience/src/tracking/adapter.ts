import { describeRawValue, describeTrackingInput } from "./raw-tracking";
import { loadEngine } from "./engine-loader";
import { createFrameSource, type FrameMeasurementSnapshot } from "../fiducials/frame-source";
import { createDetectorWorker } from "../fiducials/worker-client";
import type { CameraPipelineModule, TrackingCallbacks, XrEngine } from "./types";
interface Options {
  canvas: HTMLCanvasElement;
  callbacks: TrackingCallbacks;
  engineUrl?: string;
}
export function createTrackingAdapter(
  options: Options,
  loader = loadEngine,
  workerFactory = createDetectorWorker,
) {
  const callbacks = options.callbacks;
  let engine: XrEngine | undefined;
  let worker: Awaited<ReturnType<typeof workerFactory>> | undefined;
  let source: ReturnType<typeof createFrameSource> | undefined;
  let cleanup: (() => void) | undefined;
  let moduleNames: string[] = [];
  let generation = 0,
    epoch = 0;
  let running = false,
    hidden = false,
    busy = false;
  let starting: Promise<void> | undefined;
  let cancelStart: (() => void) | undefined;
  let tracking: "NORMAL" | "LIMITED" = "LIMITED";
  let sessionsStarted = 0;
  let detectionActive = false;
  let detectionRevision = 0;
  async function setDetectionEnabled(enabled: boolean): Promise<boolean> {
    if (enabled && (!running || hidden || tracking !== "NORMAL"))
      throw new Error("SDKがNORMALの間に検出を開始してください。");
    const revision = ++detectionRevision;
    const session = generation;
    if (!enabled) {
      detectionActive = false;
      cancelPending();
      epoch++;
      callbacks.onDiagnostic("experiment.detection-disabled", getMeasurementSnapshot());
      return true;
    }
    callbacks.onDiagnostic("experiment.detector-preparing", { sessionId: sessionsStarted });
    try {
      const prepared = worker ?? (await workerFactory());
      if (session !== generation || revision !== detectionRevision || hidden || !running) {
        if (prepared !== worker) prepared.dispose();
        return false;
      }
      worker = prepared;
      callbacks.onDiagnostic("experiment.detector-ready", { sessionId: sessionsStarted, tracking });
      if (tracking !== "NORMAL")
        throw new Error("準備中にSDKがLIMITEDになりました。NORMALへの復帰後に再試行してください。");
      detectionActive = true;
      callbacks.onDiagnostic("experiment.detection-enabled", getMeasurementSnapshot());
      return true;
    } catch (error) {
      if (session !== generation || revision !== detectionRevision) return false;
      callbacks.onDiagnostic("experiment.detector-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  type RawUpdate = ReturnType<typeof describeTrackingInput> & {
    source: "pipeline-update";
    sessionId: number;
    callbackAtMs: number;
    appliedTrackingStatus: "NORMAL" | "LIMITED";
  };
  type RawEvent = {
    source: "reality.trackingstatus";
    phase: "starting" | "running";
    sessionId: number;
    callbackAtMs: number;
    appliedTrackingStatus: "NORMAL" | "LIMITED";
    detail: ReturnType<typeof describeRawValue>;
    status: ReturnType<typeof describeRawValue>;
    reason: ReturnType<typeof describeRawValue>;
    trackingStatus: ReturnType<typeof describeRawValue>;
    trackingReason: ReturnType<typeof describeRawValue>;
  };
  const trackingDiagnostics = {
    scope: "adapter-lifetime" as const,
    updates: 0,
    eventCount: 0,
    statusTypeCounts: {} as Record<string, number>,
    interpretationCounts: {} as Record<string, number>,
    lastUpdate: null as RawUpdate | null,
    lastEvent: null as RawEvent | null,
  };
  // Terminal outcomes partition submitted work; completed counts Worker promise resolutions,
  // including results that were already cancelled before they arrived.
  const detection = {
    submitted: 0,
    completed: 0,
    delivered: 0,
    stale: 0,
    cancelled: 0,
    error: 0,
    pending: 0,
  };
  const submittedTimes: number[] = [];
  const completedTimes: number[] = [];
  function measuredRate(times: number[]) {
    const now = performance.now();
    while (times.length && now - times[0]! > 2000) times.shift();
    return times.length > 1 ? ((times.length - 1) * 1000) / (times.at(-1)! - times[0]!) : null;
  }
  const timing = {
    samples: 0,
    captureToCompletionTotalMs: 0,
    captureToCompletionMaxMs: 0,
    consumerTotalMs: 0,
    consumerMaxMs: 0,
  };
  let pendingJob: { cancelled: boolean } | null = null;
  let lastFrameSessionId: number | null = null;
  let lastGeometrySessionId: number | null = null;
  let lastCameraTextureSessionId: number | null = null;
  const archivedCapture: FrameMeasurementSnapshot = {
    updates: 0,
    captured: 0,
    error: 0,
    skipped: {},
    lastFrameMetadata: null,
    sourceGeometry: null,
    lastCameraTextureObservation: null,
  };
  function cancelPending() {
    if (!pendingJob || pendingJob.cancelled) return;
    pendingJob.cancelled = true;
    detection.cancelled++;
    detection.pending--;
    pendingJob = null;
  }
  function mergeCapture(current: FrameMeasurementSnapshot): FrameMeasurementSnapshot {
    const skipped = { ...archivedCapture.skipped };
    for (const [reason, count] of Object.entries(current.skipped))
      skipped[reason] = (skipped[reason] ?? 0) + count;
    return {
      updates: archivedCapture.updates + current.updates,
      captured: archivedCapture.captured + current.captured,
      error: archivedCapture.error + current.error,
      skipped,
      lastFrameMetadata: current.lastFrameMetadata ?? archivedCapture.lastFrameMetadata,
      sourceGeometry: current.sourceGeometry ?? archivedCapture.sourceGeometry,
      lastCameraTextureObservation:
        current.lastCameraTextureObservation ?? archivedCapture.lastCameraTextureObservation,
    };
  }
  function getMeasurementSnapshot() {
    const current = source?.getMeasurementSnapshot();
    const capture = current ? mergeCapture(current) : archivedCapture;
    return structuredClone({
      scope: "adapter-lifetime" as const,
      sessionsStarted,
      experiment: {
        detectionEnabled: true,
        detectionStart: "manual",
        detectionActive,
        detectionHz: "maximum",
        detector: "tag36h11",
        transferDetectionPixels: true,
        worldTrackingEnabled: true,
        scale: "absolute",
      },
      sessionId: sessionsStarted,
      lastFrameSessionId: current?.lastFrameMetadata ? sessionsStarted : lastFrameSessionId,
      lastGeometrySessionId: current?.sourceGeometry ? sessionsStarted : lastGeometrySessionId,
      lastCameraTextureSessionId: current?.lastCameraTextureObservation
        ? sessionsStarted
        : lastCameraTextureSessionId,
      detection,
      performance: {
        windowMs: 2000,
        captureHz: measuredRate(submittedTimes),
        completionHz: measuredRate(completedTimes),
        timing,
      },
      capture,
      trackingDiagnostics,
    });
  }
  function stop() {
    detectionRevision++;
    detectionActive = false;
    cancelPending();
    if (source) {
      const current = source.getMeasurementSnapshot();
      if (current.lastFrameMetadata) lastFrameSessionId = sessionsStarted;
      if (current.sourceGeometry) lastGeometrySessionId = sessionsStarted;
      if (current.lastCameraTextureObservation) lastCameraTextureSessionId = sessionsStarted;
      Object.assign(archivedCapture, mergeCapture(current));
    }
    generation++;
    epoch++;
    cancelStart?.();
    cancelStart = undefined;
    starting = undefined;
    document.removeEventListener("visibilitychange", visibility);
    source?.onDetach();
    source = undefined;
    worker?.dispose();
    worker = undefined;
    cleanup?.();
    cleanup = undefined;
    if (engine && moduleNames.length) {
      engine.stop();
      engine.removeCameraPipelineModules(moduleNames);
    }
    moduleNames = [];
    running = false;
    busy = false;
    hidden = false;
    tracking = "LIMITED";
    callbacks.onReset("stopped");
  }
  function fail(error: unknown) {
    stop();
    callbacks.onError(error instanceof Error ? error : new Error("追跡処理に失敗しました。"));
  }
  function visibility() {
    if (!running || !engine) return;
    if (document.hidden && !hidden) {
      hidden = true;
      cancelPending();
      epoch++;
      tracking = "LIMITED";
      callbacks.onTracking("LIMITED");
      callbacks.onReset("hidden");
      engine.pause();
    } else if (!document.hidden && hidden) {
      hidden = false;
      engine.resume();
    }
  }
  function updateTracking(raw: unknown, reason: unknown) {
    if (typeof raw !== "string") return;
    const status = raw === "NORMAL" ? "NORMAL" : "LIMITED";
    if (status === tracking) return;
    tracking = status;
    callbacks.onDiagnostic("sdk.tracking", {
      status,
      raw,
      reason: typeof reason === "string" ? reason : null,
    });
    callbacks.onTracking(status);
  }
  function start(): Promise<void> {
    if (starting) return starting;
    if (running) return Promise.resolve();
    const session = ++generation;
    let lastPoseSampleAtMs = -Infinity;
    let lastRawDiagnosticAtMs = -Infinity;
    let lastRawSignature: string | undefined;
    sessionsStarted++;
    starting = new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => report(new Error("検出器またはカメラの起動がタイムアウトしました。")),
        45000,
      );
      cancelStart = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const report = (error: unknown) => {
        if (session !== generation) return;
        window.clearTimeout(timer);
        reject(error);
        fail(error);
      };
      void (async () => {
        try {
          const loaded = await loader(options.engineUrl ?? "/external/xr/xr.js");
          if (session !== generation) return;
          await loaded.loadChunk("slam");
          if (session !== generation) return;
          engine = loaded;
          source = createFrameSource({
            intervalMs: 1,
            requireWorldTracking: false,
            createRenderer: (settings) => loaded.GlTextureRenderer.create(settings),
            canCapture: () =>
              running && !hidden && !busy && detectionActive && worker !== undefined,
            captureBlockReason: () =>
              !running
                ? "not-running"
                : hidden
                  ? "hidden"
                  : busy
                    ? "busy"
                    : !detectionActive
                      ? "detection-disabled"
                      : !worker
                        ? "detector-not-ready"
                        : "tracking-unavailable",
            onDiagnostic: (event, detail) => {
              callbacks.onDiagnostic(event, detail);
              if (event === "frame-source-error")
                queueMicrotask(() =>
                  report(new Error("カメラ映像の取得に失敗しました。検証ログを保存してください。")),
                );
            },
            onFrame: (frame) => {
              const detector = worker;
              if (!detector) return;
              submittedTimes.push(performance.now());
              measuredRate(submittedTimes);
              frame.captureSessionId = sessionsStarted;
              const capturedEpoch = epoch;
              const job = { cancelled: false };
              pendingJob = job;
              detection.submitted++;
              detection.pending++;
              busy = true;
              void detector
                .detect(frame)
                .then((result) => {
                  detection.completed++;
                  const completedAtMs = performance.now();
                  completedTimes.push(completedAtMs);
                  const completionHz = measuredRate(completedTimes);
                  const elapsedMs = completedAtMs - frame.timestampMs;
                  timing.samples++;
                  timing.captureToCompletionTotalMs += elapsedMs;
                  timing.captureToCompletionMaxMs = Math.max(
                    timing.captureToCompletionMaxMs,
                    elapsedMs,
                  );
                  callbacks.onDiagnostic("experiment.worker-completed", {
                    frameId: frame.id,
                    sessionId: frame.captureSessionId,
                    callbackAtMs: completedAtMs,
                    completionHz,
                    detector: "tag36h11",
                    captureAtMs: frame.timestampMs,
                    width: frame.width,
                    height: frame.height,
                    readbackCompletedAtMs: frame.metadata?.readbackCompletedAtMs ?? null,
                    pixelsReadyAtMs: frame.metadata?.pixelsReadyAtMs ?? null,
                    durationMs: result.durationMs,
                    cancelled: job.cancelled,
                  });
                  if (job.cancelled) return;
                  if (session !== generation || capturedEpoch !== epoch || hidden || !running) {
                    cancelPending();
                    return;
                  }
                  pendingJob = null;
                  detection.pending--;
                  const ageMs = performance.now() - frame.timestampMs;
                  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 500) {
                    detection.stale++;
                    callbacks.onDiagnostic("frame.dropped", {
                      id: frame.id,
                      reason: "stale",
                      ageMs,
                    });
                    return;
                  }
                  detection.delivered++;
                  const consumerStartedAtMs = performance.now();
                  try {
                    callbacks.onDetections(frame, result);
                  } finally {
                    const consumerMs = performance.now() - consumerStartedAtMs;
                    timing.consumerTotalMs += consumerMs;
                    timing.consumerMaxMs = Math.max(timing.consumerMaxMs, consumerMs);
                  }
                })
                .catch((error) => {
                  if (job.cancelled) return;
                  if (pendingJob === job) {
                    pendingJob = null;
                    detection.pending--;
                    detection.error++;
                  }
                  report(error);
                })
                .finally(() => {
                  if (session === generation) busy = false;
                });
            },
          });
          const frameSource = source;
          const module: CameraPipelineModule = {
            name: "audience-fiducial-state",
            onStart: (dimensions) => {
              if (session !== generation) return;
              running = true;
              window.clearTimeout(timer);
              cancelStart = undefined;
              callbacks.onDiagnostic("sdk.started", {
                videoWidth: dimensions.videoWidth,
                videoHeight: dimensions.videoHeight,
                canvasWidth: dimensions.canvasWidth,
                canvasHeight: dimensions.canvasHeight,
              });
              const { scene, camera } = loaded.Threejs.xrScene();
              cleanup = callbacks.onScene(scene, camera) ?? undefined;
              document.addEventListener("visibilitychange", visibility);
              visibility();
              resolve();
            },
            onUpdate: ({ processCpuResult, frameStartResult }) => {
              if (session !== generation || hidden || !running) return;
              const reality = processCpuResult?.reality;
              updateTracking(reality?.trackingStatus, reality?.trackingReason);
              const callbackAtMs = performance.now();
              const rawTracking = describeTrackingInput(reality);
              const rawUpdate: RawUpdate = {
                ...rawTracking,
                source: "pipeline-update",
                sessionId: sessionsStarted,
                callbackAtMs,
                appliedTrackingStatus: tracking,
              };
              trackingDiagnostics.updates++;
              const statusType = rawTracking.status.type;
              trackingDiagnostics.statusTypeCounts[statusType] =
                (trackingDiagnostics.statusTypeCounts[statusType] ?? 0) + 1;
              const interpretation = rawTracking.interpretation;
              trackingDiagnostics.interpretationCounts[interpretation] =
                (trackingDiagnostics.interpretationCounts[interpretation] ?? 0) + 1;
              trackingDiagnostics.lastUpdate = rawUpdate;
              const signature = JSON.stringify(rawTracking);
              if (signature !== lastRawSignature) {
                callbacks.onDiagnostic("sdk.tracking.raw-change", rawUpdate);
                lastRawSignature = signature;
              }
              if (callbackAtMs - lastRawDiagnosticAtMs >= 1000) {
                callbacks.onDiagnostic("sdk.tracking.raw", rawUpdate);
                lastRawDiagnosticAtMs = callbackAtMs;
              }
              if (!callbacks.onPoseSample) return;
              if (!Number.isFinite(callbackAtMs) || callbackAtMs - lastPoseSampleAtMs < 100) return;
              lastPoseSampleAtMs = callbackAtMs;
              const position = reality?.position;
              const rotation = reality?.rotation;
              const validPose =
                position &&
                rotation &&
                [
                  position.x,
                  position.y,
                  position.z,
                  rotation.x,
                  rotation.y,
                  rotation.z,
                  rotation.w,
                ].every(Number.isFinite) &&
                Math.abs(Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) - 1) <= 1e-3;
              const sourceVideoTime = frameStartResult?.videoTime;
              callbacks.onPoseSample({
                sessionId: sessionsStarted,
                callbackAtMs,
                sourceVideoTime:
                  typeof sourceVideoTime === "number" && Number.isFinite(sourceVideoTime)
                    ? sourceVideoTime
                    : null,
                repeatFrame:
                  typeof frameStartResult?.repeatFrame === "boolean"
                    ? frameStartResult.repeatFrame
                    : null,
                sdkFromCamera: validPose
                  ? { position: { ...position }, rotation: { ...rotation } }
                  : null,
                trackingStatus: tracking,
                rawTracking,
                timestampBasis: "sdk-callback-performance-now",
                exposureSynchronization: "unknown",
              });
            },
            listeners: [
              {
                event: "reality.trackingstatus",
                process: (event) => {
                  if (session !== generation || hidden) return;
                  const detail = event.detail;
                  const fields =
                    detail !== null && typeof detail === "object"
                      ? (detail as Record<string, unknown>)
                      : null;
                  const field = (key: string) =>
                    describeRawValue(fields?.[key], fields !== null && Object.hasOwn(fields, key));
                  const rawEvent: RawEvent = {
                    source: "reality.trackingstatus",
                    phase: running ? "running" : "starting",
                    sessionId: sessionsStarted,
                    callbackAtMs: performance.now(),
                    appliedTrackingStatus: tracking,
                    detail: describeRawValue(detail, Object.hasOwn(event, "detail")),
                    status: field("status"),
                    reason: field("reason"),
                    trackingStatus: field("trackingStatus"),
                    trackingReason: field("trackingReason"),
                  };
                  trackingDiagnostics.eventCount++;
                  trackingDiagnostics.lastEvent = rawEvent;
                  callbacks.onDiagnostic("sdk.tracking.event", rawEvent);
                },
              },
            ],
            onException: report,
          };
          const configuration: Parameters<XrEngine["XrController"]["configure"]>[0] = {
            disableWorldTracking: false,
            scale: "absolute",
          };
          callbacks.onDiagnostic("sdk.configuration", {
            ...configuration,
            sourceReadbackEnabled: detectionActive,
            sourceRegistered: true,
            detector: "tag36h11",
            transferDetectionPixels: true,
            detectionStart: "manual",
          });
          loaded.XrController.configure(configuration);
          const modules = [
            loaded.GlTextureRenderer.pipelineModule(),
            loaded.Threejs.pipelineModule(),
            loaded.XrController.pipelineModule(),
            module,
            {
              ...frameSource,
              onUpdate: (value: Parameters<typeof frameSource.onUpdate>[0]) => {
                if (detectionActive) frameSource.onUpdate(value);
              },
              onDeviceOrientationChange: () => {
                frameSource.onCanvasSizeChange({
                  canvasWidth: options.canvas.width,
                  canvasHeight: options.canvas.height,
                });
              },
            },
          ];
          moduleNames = modules.map((entry) => entry.name);
          loaded.addCameraPipelineModules(modules);
          await loaded.run({ canvas: options.canvas });
        } catch (error) {
          report(error);
        }
      })();
    });
    return starting;
  }
  return { start, stop, setDetectionEnabled, getMeasurementSnapshot };
}
