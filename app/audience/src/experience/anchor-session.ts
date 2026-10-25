import { summarizeSdkProgress, type SdkProgress } from "../tracking/progress";
import { createTrackingAdapter } from "../tracking/adapter";
import { createDiagnostics } from "../tracking/diagnostics";
import { createLiveTagAnchor } from "../rendering/live-tag-anchor";
import { createTagAnchorState } from "./tag-anchor-state";
import { createPresentationSession } from "./presentation-session";
import type { BoardConfig } from "../fiducials/config";
import type { DetectorInputCapture } from "../tracking/input-capture";

export const normalWarmupMs = 5000;
export interface AnchorSessionSnapshot {
  stage: "ready" | "starting" | "running" | "stopped" | "error";
  error: string | null;
  tracking: "NORMAL" | "LIMITED";
  detection: "waiting" | "preparing" | "active";
  nowMs: number;
  normalSinceMs: number | null;
  completionHz: number | null;
  anchorUpdateCount: number;
  lastTagAtMs: number | null;
  localizationReason: string;
  captureAvailable: boolean;
  mediaPlaybackBlocked: boolean;
  sdkProgress?: SdkProgress;
}
async function requestMotionPermissions() {
  const results = await Promise.all(
    (["DeviceOrientationEvent", "DeviceMotionEvent"] as const).map((name) => {
      const provider = window[name] as unknown as
        | { requestPermission?: () => Promise<string> }
        | undefined;
      return provider?.requestPermission?.();
    }),
  );
  if (results.some((value) => value !== undefined && value !== "granted"))
    throw new Error("動きの検出を許可してから、もう一度開始してください。");
}
export function createAnchorSession(options: {
  canvas: HTMLCanvasElement;
  config: BoardConfig;
  onChange(snapshot: AnchorSessionSnapshot): void;
  diagnostics?: ReturnType<typeof createDiagnostics>;
  requestPermissions?: () => Promise<void>;
  showGuides?: boolean;
}) {
  const { canvas: surface, config } = options;
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const localization = createTagAnchorState(config);
  let liveAnchor: ReturnType<typeof createLiveTagAnchor> | null = null;
  let inputCapture: DetectorInputCapture | null = null;
  let attempt = 0;
  let snapshot: AnchorSessionSnapshot = {
    stage: "ready",
    error: null,
    tracking: "LIMITED",
    detection: "waiting",
    nowMs: 0,
    normalSinceMs: null,
    completionHz: null,
    anchorUpdateCount: 0,
    lastTagAtMs: null,
    localizationReason: "not-detected",
    captureAvailable: false,
    mediaPlaybackBlocked: false,
  };
  let active = true;
  const publish = (patch: Partial<AnchorSessionSnapshot> = {}) => {
    if (!active) return;
    const value = localization.getSnapshot();
    snapshot = {
      ...snapshot,
      ...patch,
      anchorUpdateCount: value.anchor.updateCount,
      lastTagAtMs: value.anchor.lastTagAtMs,
      localizationReason: value.tagLocalization.reason,
      captureAvailable: inputCapture !== null,
    };
    options.onChange(snapshot);
  };
  const presentationSession = createPresentationSession({
    canPlay: () =>
      !document.hidden &&
      snapshot.tracking === "NORMAL" &&
      localization.getSnapshot().anchor.lastTagAtMs !== null,
    onPlaybackBlocked(blocked) {
      if (snapshot.mediaPlaybackBlocked !== blocked) publish({ mediaPlaybackBlocked: blocked });
    },
  });
  const log = (event: string, detail: unknown) =>
    diagnostics.record(Math.round(performance.now()), event, detail);
  let running = false;
  let normalSince: number | null = null;
  let detectionActive = false;
  let preparing = false;
  let generation = 0;
  let lastFrameAtMs = -Infinity;
  let resetAtMs = -Infinity;
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = Math.round(window.innerWidth * ratio);
    surface.height = Math.round(window.innerHeight * ratio);
    log("display.layout", {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      backingWidth: surface.width,
      backingHeight: surface.height,
    });
  };
  resize();
  window.addEventListener("resize", resize);
  const onVisibility = () => {
    if (document.hidden) presentationSession.pause();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const clearAnchor = (reason: string) => {
    presentationSession.pause();
    liveAnchor?.clear();
    localization.clear();
    publish();
    log("anchor.cleared", { reason });
  };
  const controller = createTrackingAdapter({
    canvas: surface,
    callbacks: {
      onScene(scene, _camera, renderer) {
        running = true;
        const marker = config.markers[0]!;
        const anchor = createLiveTagAnchor(
          scene,
          marker.sizeMeters,
          marker.venueFromMarker,
          config.presentationToVenue,
          options.showGuides ?? false,
        );
        liveAnchor = anchor;
        presentationSession.attachScene(anchor, renderer);
        const previousBeforeRender = scene.onBeforeRender;
        const beforeRender: typeof scene.onBeforeRender = function (...args) {
          previousBeforeRender.apply(scene, args);
          presentationSession.prepareRender(args[2]);
        };
        scene.onBeforeRender = beforeRender;
        return () => {
          if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousBeforeRender;
          presentationSession.detachScene(anchor);
          renderer.resetState();
          anchor.dispose();
          if (liveAnchor === anchor) liveAnchor = null;
        };
      },
      onTracking(status) {
        if (!active) return;
        publish({ tracking: status });
        if (status === "NORMAL") normalSince ??= performance.now();
        else {
          normalSince = null;
          resetAtMs = performance.now();
          clearAnchor("tracking-limited");
        }
        publish({ normalSinceMs: normalSince });
      },
      onPoseSample(sample) {
        if (active) log("sdk.pose", sample);
      },
      onDiagnostic(event, detail) {
        if (active) {
          log(event, detail);
          if (
            event === "experiment.worker-completed" &&
            detail &&
            typeof detail === "object" &&
            "completionHz" in detail
          ) {
            const value = (detail as { completionHz: unknown }).completionHz;
            publish({
              completionHz: typeof value === "number" && Number.isFinite(value) ? value : null,
            });
          }
        }
      },
      onReset(reason) {
        if (!active) return;
        clearAnchor(reason);
        normalSince = null;
        publish({ normalSinceMs: null });
        publish({ tracking: "LIMITED" });
        if (reason === "tracking-lost") return;
        generation++;
        preparing = false;
        detectionActive = false;
        publish({ detection: "waiting" });
        resetAtMs = performance.now();

        if (reason === "stopped") running = false;
        else
          void controller
            .setDetectionEnabled(false)
            .catch((reason) => log("experiment.disable-error", String(reason)));
      },
      onError(reason) {
        if (!active) return;
        publish({ error: reason.message, stage: "error" });
        log("error", reason.message);
      },
      onDetections(frame, result) {
        if (
          !active ||
          !detectionActive ||
          frame.timestampMs <= resetAtMs ||
          frame.timestampMs <= lastFrameAtMs
        )
          return;
        lastFrameAtMs = frame.timestampMs;
        const anchorUpdated = localization.observe(
          frame,
          result,
          () => performance.now(),
          liveAnchor,
        );
        const evaluatedAtMs = performance.now();
        const localized = localization.getSnapshot();
        inputCapture = {
          frame,
          result,
          localization: localized.tagLocalization,
          receivedAtMs: performance.now(),
        };
        publish();
        log("fiducial.frame", {
          id: frame.id,
          sourceCallbackAtMs: frame.timestampMs,
          sourceVideoTime: frame.sourceVideoTime,
          captureSessionId: frame.captureSessionId ?? null,
          captureMetadata: frame.metadata ?? null,
          width: frame.width,
          height: frame.height,
          intrinsics: frame.intrinsics,
          sdkFromCamera: frame.worldFromCamera,
          rawTracking: frame.metadata?.trackingInput ?? null,
          sdkPoseAttachment: frame.metadata?.sdkPoseAttachment ?? null,
          result,
          tagLocalization: localization.getSnapshot().tagLocalization,
          evaluatedAtMs,
          anchorUpdated,
          anchor: localization.getSnapshot().anchor,
          displayStabilization: anchorUpdated ? (liveAnchor?.getDisplayDiagnostic() ?? null) : null,
          latencyMs: evaluatedAtMs - frame.timestampMs,
        });
      },
    },
  });
  const timer = window.setInterval(() => {
    const timestampMs = performance.now();
    publish({
      nowMs: timestampMs,
      sdkProgress: summarizeSdkProgress(controller.getMeasurementSnapshot()),
    });
    if (
      !active ||
      !running ||
      document.hidden ||
      detectionActive ||
      preparing ||
      normalSince === null ||
      timestampMs - normalSince < normalWarmupMs
    )
      return;
    const current = generation;
    const preparedNormalSince = normalSince;
    preparing = true;
    publish({ detection: "preparing" });
    void controller
      .setDetectionEnabled(true)
      .then((enabled) => {
        if (!active || current !== generation) return;
        if (enabled && normalSince !== preparedNormalSince) {
          void controller.setDetectionEnabled(false);
          log("experiment.warmup-interrupted", { preparedNormalSince, normalSince });
          enabled = false;
        }
        detectionActive = enabled;
        publish({ detection: enabled ? "active" : "waiting" });
        if (!enabled) {
          normalSince = null;
          publish({ normalSinceMs: null });
        }
      })
      .catch((reason) => {
        if (!active || current !== generation) return;
        log("experiment.enable-error", { message: String(reason) });
        normalSince = null;
        publish({ normalSinceMs: null });
        publish({ detection: "waiting" });
      })
      .finally(() => {
        if (!active || current !== generation) return;
        preparing = false;
        // Retry only after another complete interval of NORMAL observations.
        if (!detectionActive && !document.hidden) {
          const status =
            controller.getMeasurementSnapshot().trackingDiagnostics.lastUpdate
              ?.appliedTrackingStatus;
          if (status === "NORMAL") {
            normalSince = performance.now();
            publish({ normalSinceMs: normalSince });
          }
        }
      });
  }, 100);
  return {
    getSnapshot: () => snapshot,
    getDiagnosticContext: () => ({
      inputCapture,
      ...localization.getSnapshot(),
      measurementSnapshot: controller.getMeasurementSnapshot(),
      ...diagnostics.snapshot(),
    }),
    presentPresentation: presentationSession.present,
    resumeMediaPlayback: presentationSession.resumePlayback,
    openRuntime: presentationSession.openRuntime,
    async start() {
      if (!active || snapshot.stage === "starting" || snapshot.stage === "running") return;
      const current = ++attempt;
      inputCapture = null;
      publish({ error: null, stage: "starting" });
      try {
        if (window.isSecureContext === false)
          throw new Error("端末が信頼するHTTPSで開いてください。");
        await (options.requestPermissions ?? requestMotionPermissions)();
        if (!active || current !== attempt) return;
        log("session.start", {
          mode: "audience-anchor",
          scale: "absolute",
          detectionHz: "maximum",
          normalWaitMs: normalWarmupMs,
          config,
        });
        await controller.start();
        if (active && current === attempt) publish({ stage: "running" });
      } catch (reason) {
        if (!active || current !== attempt) return;
        controller.stop();
        publish({
          error: reason instanceof Error ? reason.message : "開始できません。",
          stage: "error",
        });
      }
    },
    stop() {
      if (!active) return;
      attempt++;
      presentationSession.clearRuntime();
      controller.stop();
      publish({ stage: "stopped" });
    },
    dispose() {
      if (!active) return;
      active = false;
      generation++;
      attempt++;
      window.clearInterval(timer);
      presentationSession.dispose();
      controller.stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
