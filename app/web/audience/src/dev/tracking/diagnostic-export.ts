import { createTagLocalizationState } from "../../fiducials/tag-localization";
import type { createDiagnostics } from "../../tracking/diagnostics";
import { serializeDetectorInput } from "../../tracking/input-capture";
import { poseEstimatorPolicy } from "../../fiducials/pose";
import { displayJitterPolicy } from "../../rendering/jitter-filter";
import { detectorImplementations, type BoardConfig, type TagProfile } from "../../fiducials/config";
import { normalWarmupMs, type createAnchorSession } from "../../experience/anchor-session";
type DiagnosticExportOptions = {
  session: ReturnType<typeof createAnchorSession> | null;
  diagnostics: ReturnType<typeof createDiagnostics>;
  config: BoardConfig | null;
  profile: TagProfile | null;
  includeImage?: boolean;
};
export function buildAnchorDiagnosticExport(options: DiagnosticExportOptions) {
  const { config, profile, includeImage = false } = options;
  const context = options.session?.getDiagnosticContext() ?? {
    inputCapture: null,
    tagLocalization: createTagLocalizationState(),
    anchor: { updateCount: 0, lastTagAtMs: null, sdkFromVenue: null },
    measurementSnapshot: null,
    ...options.diagnostics.snapshot(),
  };
  const capture = includeImage ? context.inputCapture : null;
  if (includeImage && !capture) return null;
  const detectorInput = capture ? serializeDetectorInput(capture) : undefined;
  const payload = {
    schemaVersion: 21,
    poseEstimatorPolicy,
    ...(detectorInput ? { detectorInput } : {}),
    mode: "audience-anchor",
    sdkScale: "absolute",
    experiment: {
      detectionHz: "maximum",
      normalWaitMs: normalWarmupMs,
      presentation: "live-tag-update-with-sdk-hold",
      anchorUpdate: "every-valid-single-tag-pose-immediate",
      anchorHold: "sdk-world-until-next-valid-tag",
      trackingLoss: "hide-and-require-new-tag",
      detectorExecution: "april-only",
      pixelTransport: "transfer-and-return",
      anchorSmoothing: false,
      displayStabilization: displayJitterPolicy,
      outlierWait: false,
      exposurePoseSynchronization: "unknown",
    },
    recordedAt: new Date().toISOString(),
    environment: { userAgent: navigator.userAgent, secureContext: window.isSecureContext },
    detector: "april",
    board: config,
    profile,
    detectorImplementations,
    engineVersion: "@8thwall/engine-binary@1.0.0",
    tagLocalization: context.tagLocalization,
    anchor: context.anchor,
    measurementSnapshot: context.measurementSnapshot,
    records: context.records,
    droppedSamples: context.droppedSamples,
    droppedTransitions: context.droppedTransitions,
  };
  return {
    payload,
    filename: includeImage
      ? `audience-anchor-input-s${capture!.frame.captureSessionId ?? 0}-f${capture!.frame.id}.json`
      : "audience-anchor-tracking-log.json",
  };
}
export function downloadAnchorDiagnostics(options: DiagnosticExportOptions) {
  const result = buildAnchorDiagnosticExport(options);
  if (!result) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
