import { expect, test } from "vitest";
import { buildViewerDiagnostic } from "./viewer-diagnostic";

test("viewer logs retain operational states while excluding presentation and connection secrets", () => {
  const result = buildViewerDiagnostic({
    tracking: {
      stage: "running",
      tracking: "NORMAL",
      detection: "active",
      error: null,
      anchorUpdateCount: 4,
      completionHz: 12,
      mediaPlaybackBlocked: true,
      lastTagAtMs: 40,
      nowMs: 50,
      credential: "private-credential",
      pixels: [1, 2],
    },
    viewing: {
      phase: "viewing",
      error: null,
      recovery: {
        id: 3,
        kind: "keyframe",
        afterSequence: "5",
        url: "https://secret.test/?signature=private",
      },
      runtime: {
        phase: "ready",
        rendering: "ready",
        stateSync: "awaiting-keyframe",
        reliableSequence: "5",
        stateSequence: "6",
        error: null,
        reason: null,
        view: {
          progression: { currentGroupId: "private-group", currentStepId: "private-step" },
          variables: { password: "private-presentation" },
          activeRuns: [{ secret: "private-run" }],
          clock: {
            runtimeTimeMilliseconds: 400,
            lifecycle: { kind: "running", private: "secret" },
          },
          assetAccess: [{ url: "https://secret.test/?signature=private" }],
        },
      },
    },
    context: { records: [], credential: "private-credential", inputCapture: { pixels: [1, 2] } },
  } as never);
  expect(result).toMatchObject({
    schemaVersion: 1,
    mode: "audience-viewer",
    tracking: {
      stage: "running",
      status: "NORMAL",
      anchorUpdateCount: 4,
      mediaPlaybackBlocked: true,
    },
    viewing: {
      phase: "viewing",
      recovery: { kind: "keyframe", afterSequence: "5" },
      runtime: {
        phase: "ready",
        rendering: "ready",
        stateSync: "awaiting-keyframe",
        reliableSequence: "5",
        stateSequence: "6",
        activeRuns: 1,
        clock: { runtimeTimeMilliseconds: 400, lifecycle: "running" },
      },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private|secret|credential|pixels|variables|progression|signature|url|assetAccess|password/,
  );
});

test("viewer logs sanitize unknown error text and do not serialize invalid status or sequence strings", () => {
  const result = buildViewerDiagnostic({
    tracking: {
      stage: "https://private",
      tracking: "secret",
      detection: "secret",
      error: "private-camera-error",
    },
    viewing: {
      phase: "secret",
      error: "https://private",
      recovery: { kind: "secret", afterSequence: "private" },
      runtime: {
        phase: "secret",
        rendering: "secret",
        stateSync: "secret",
        reliableSequence: "private",
        stateSequence: "private",
        error: "presentation-render-failed",
        reason: "secret",
        view: { activeRuns: { length: "private" } },
      },
    },
    context: {
      records: [{ timeMs: "private", event: "sdk.started", detail: {} }],
      droppedSamples: "private",
    },
  } as never);
  expect(result.viewing?.runtime?.error).toBe("presentation-render-failed");
  expect(result.tracking?.error).toBe("unclassified-error");
  expect(JSON.stringify(result)).not.toMatch(/private|secret|https:/);
});

test("viewer diagnostic supports not-yet-started sessions and returns independent summaries", () => {
  const value = { records: [{ timeMs: 1, event: "sdk.started", detail: { videoWidth: 720 } }] };
  const result = buildViewerDiagnostic({ tracking: null, viewing: null, context: value } as never);
  expect(result.tracking).toBeNull();
  expect(result.viewing).toBeNull();
  value.records[0]!.detail.videoWidth = 1080;
  expect(result.diagnostics.records[0]?.detail).toMatchObject({ videoWidth: 720 });
});
