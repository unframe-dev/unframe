import type { createTrackingAdapter } from "./adapter";

type Measurement = ReturnType<ReturnType<typeof createTrackingAdapter>["getMeasurementSnapshot"]>;
export interface SdkProgress {
  phase: string;
  updates: number;
  realityUpdates: number;
  poseUpdates: number;
  lastUpdateAtMs: number | null;
  rawStatus: string;
  rawReason: string;
  eventStatus: string;
  sensors: Measurement["sensors"];
}
function label(value: unknown): string {
  if (value === undefined || value === null) return "未取得";
  return typeof value === "string" && /^[A-Z][A-Z0-9_ -]{0,63}$/.test(value) ? value : "形式未対応";
}
export function summarizeSdkProgress(value: Measurement): SdkProgress {
  const update =
    value.trackingDiagnostics.lastUpdate?.sessionId === value.sessionId
      ? value.trackingDiagnostics.lastUpdate
      : null;
  const event =
    value.trackingDiagnostics.lastEvent?.sessionId === value.sessionId
      ? value.trackingDiagnostics.lastEvent
      : null;
  return {
    phase: value.startup?.phase ?? "idle",
    updates: value.startup?.updates ?? 0,
    realityUpdates: value.startup?.realityUpdates ?? 0,
    poseUpdates: value.startup?.poseUpdates ?? 0,
    lastUpdateAtMs: value.startup?.lastUpdateAtMs ?? null,
    rawStatus: label(update?.status?.value),
    rawReason: label(update?.reason?.value),
    eventStatus: label(event?.status?.value),
    sensors: value.sensors ?? {
      motionEvents: 0,
      orientationEvents: 0,
      accelerationAvailable: false,
      rotationRateAvailable: false,
      orientationAvailable: false,
      lastMotionAtMs: null,
      lastOrientationAtMs: null,
    },
  };
}
