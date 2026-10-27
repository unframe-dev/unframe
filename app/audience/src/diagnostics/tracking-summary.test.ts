import { expect, test } from "vitest";
import { safeDiagnosticError, summarizeTrackingDiagnostics } from "./tracking-summary";

test("診断は許可したイベントと計測値のみを残し、画像・URL・任意エラー文を除外する", () => {
  const result = summarizeTrackingDiagnostics({
    inputCapture: { pixels: [1, 2], url: "https://private.test/?token=secret" },
    measurementSnapshot: {
      sessionId: 1,
      capture: {
        captured: 12,
        sourceGeometry: { video: { width: 1920, height: 1080 } },
        pixels: [1, 2],
      },
    },
    records: [
      { timeMs: 1, event: "sdk.started", detail: { videoWidth: 1920, url: "secret" } },
      {
        timeMs: 2,
        event: "frame-source-error",
        detail: { message: "https://private.test/?token=secret", pixels: [1, 2] },
      },
      { timeMs: 3, event: "fiducial.frame", detail: { pixels: [1, 2] } },
    ],
    droppedSamples: 2,
    droppedTransitions: 1,
  } as never);
  expect(result.measurementSnapshot).toMatchObject({
    sessionId: 1,
    capture: { captured: 12, sourceGeometry: { video: { width: 1920, height: 1080 } } },
  });
  expect(result.records).toHaveLength(2);
  expect(result.records[1]?.detail).toEqual({ message: "unclassified-error" });
  expect(JSON.stringify(result)).not.toMatch(/secret|private|pixels|inputCapture|url/);
});

test("GLエラーの発生境界と既知readbackエラーを記録する", () => {
  const result = summarizeTrackingDiagnostics({
    records: [
      {
        timeMs: 1,
        event: "frame-source-gl-errors",
        detail: {
          phase: "before-capture",
          errors: [1282],
          contextLost: false,
          limitReached: false,
          url: "private",
        },
      },
      {
        timeMs: 2,
        event: "frame-source-error",
        detail: { message: "SDK camera readback WebGL error 1282" },
      },
    ],
  } as never);
  expect(result.records[0]?.detail).toEqual({
    phase: "before-capture",
    errors: [1282],
    contextLost: false,
    limitReached: false,
  });
  expect(result.records[1]?.detail).toEqual({ message: "SDK camera readback WebGL error 1282" });
  expect(JSON.stringify(result)).not.toContain("private");
});

test("追跡待ちでも起動段階・SDK生状態・更新回数を保存する", () => {
  const result = summarizeTrackingDiagnostics({
    measurementSnapshot: {
      startup: {
        phase: "running",
        updates: 3,
        realityUpdates: 2,
        poseUpdates: 1,
        lastUpdateAtMs: 123,
      },
      sensors: {
        motionEvents: 2,
        orientationEvents: 1,
        accelerationAvailable: true,
        rotationRateAvailable: false,
        orientationAvailable: true,
        lastMotionAtMs: 20,
        lastOrientationAtMs: 10,
      },
      trackingDiagnostics: {
        updates: 3,
        eventCount: 1,
        lastUpdate: {
          callbackAtMs: 123,
          appliedTrackingStatus: "LIMITED",
          realityPresent: true,
          interpretation: "limited",
          status: { present: true, type: "string", value: "LIMITED" },
          reason: { present: true, type: "string", value: "INITIALIZING" },
        },
        lastEvent: {
          status: { present: true, type: "string", value: "NORMAL" },
          reason: { present: true, type: "string", value: "https://secret/?token=private" },
        },
      },
    },
    records: [{ timeMs: 1, event: "sdk.startup", detail: { phase: "slam-loading" } }],
  } as never);
  expect(result.measurementSnapshot).toMatchObject({
    startup: { phase: "running", updates: 3 },
    sensors: { motionEvents: 2 },
    trackingDiagnostics: {
      updates: 3,
      lastUpdate: { status: { value: "LIMITED" }, reason: { value: "INITIALIZING" } },
      lastEvent: { status: { value: "NORMAL" } },
    },
  });
  expect(result.records).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/secret|token|private/);
});

test("unknown diagnostics cannot inject nonnumeric counters or timestamps", () => {
  const result = summarizeTrackingDiagnostics({
    droppedSamples: "private",
    droppedTransitions: Infinity,
    records: [{ timeMs: "private", event: "sdk.started", detail: { videoWidth: 720 } }],
  } as never);
  expect(result.droppedSamples).toBe(0);
  expect(result.droppedTransitions).toBe(0);
  expect(result.records[0]?.timeMs).toBeNull();
  expect(JSON.stringify(result)).not.toContain("private");
});
test("safe error names whitelist operational failures and omit arbitrary payloads", () => {
  expect(safeDiagnosticError("viewing-start-failed")).toBe("viewing-start-failed");
  expect(safeDiagnosticError("runtime-input-requires-resync")).toBe(
    "runtime-input-requires-resync",
  );
  expect(safeDiagnosticError("private-credential")).toBe("unclassified-error");
  expect(safeDiagnosticError(null)).toBeNull();
});

test.each([
  "viewing-start-failed",
  "viewing-host-unavailable",
  "runtime-input-failed",
  "viewing-stop-failed",
])("製品の安全なエラーコード%sを診断に残す", (code) => {
  expect(safeDiagnosticError(code)).toBe(code);
});
