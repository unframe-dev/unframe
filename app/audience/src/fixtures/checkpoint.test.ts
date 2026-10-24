import { expect, test } from "vitest";
import { summarizeRuntime, summarizeTrackingDiagnostics } from "./checkpoint";

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

test("runtime概要は固定fixtureの進行・変数を保持し、履歴として独立する", () => {
  const state = {
    phase: "ready",
    rendering: "ready",
    error: null,
    reason: null,
    reliableSequence: "2",
    stateSequence: "3",
    view: {
      variables: { secret: "private" },
      activeRuns: [{}],
      clock: { runtimeTimeMilliseconds: 500, status: "running" },
    },
  };
  const result = summarizeRuntime(state as never);
  state.reliableSequence = "4";
  expect(result).toMatchObject({ reliableSequence: "2", activeRuns: 1 });
  expect(result?.variables).toEqual({ secret: "private" });
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
