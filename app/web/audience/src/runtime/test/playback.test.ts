import { beforeEach, expect, it, vi } from "vitest";
import { createRuntimePlayback } from "../playback";
import { createRuntimeStore } from "../runtime-store";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { participantRuntimeViewSchema } from "@unframe/contracts/presentation";
import { AssetLoadError } from "../../diagnostics/asset-failure";

vi.mock("../runtime-store", () => ({ createRuntimeStore: vi.fn() }));
let snapshot: {
  phase: "ready" | "awaiting-snapshot" | "resync-required" | "ended";
  view: ReturnType<typeof participantRuntimeViewSchema.parse> | null;
  reliableSequence: string;
  stateSequence: string;
  stateSync: "awaiting-keyframe" | "ready";
  reason: string | null;
};
beforeEach(() => {
  snapshot = {
    phase: "ready",
    view: participantRuntimeViewSchema.parse(fixture),
    reliableSequence: "0",
    stateSequence: "0",
    stateSync: "ready",
    reason: null,
  };
  vi.mocked(createRuntimeStore).mockReturnValue({
    applyControl: vi.fn(),
    applyState: vi.fn(),
    restartState: vi.fn(),
    reset: vi.fn(),
    getSnapshot: () => structuredClone(snapshot),
  });
});
it("retains classified asset failures and clears them when a fresh snapshot recovers", async () => {
  const failure = { kind: "png", stage: "response", code: "http-error", httpStatus: 403 } as const;
  const present = vi
    .fn()
    .mockRejectedValueOnce(new AssetLoadError(failure))
    .mockResolvedValue(undefined);
  const playback = createRuntimePlayback({ delivery: {} as never, present, clear: vi.fn() });
  playback.applyControl({} as never);
  await playback.waitForIdle();
  expect(playback.getSnapshot()).toMatchObject({
    error: "presentation-render-failed",
    renderFailurePhase: "prepare",
    assetFailure: failure,
  });
  const exported = playback.getSnapshot().assetFailure!;
  exported.httpStatus = 500;
  expect(playback.getSnapshot().assetFailure?.httpStatus).toBe(403);
  playback.applyControl({ connectionSnapshot: {} } as never);
  await playback.waitForIdle();
  expect(playback.getSnapshot()).toMatchObject({
    rendering: "ready",
    error: null,
    assetFailure: null,
    renderFailurePhase: null,
  });
  playback.reset();
  expect(playback.getSnapshot().assetFailure).toBeNull();
  playback.dispose();
});
it("coalesces updates during loading and applies the newest view without cancelling every frame", async () => {
  let finish!: () => void;
  const present = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const clear = vi.fn();
  const playback = createRuntimePlayback({ delivery: {} as never, present, clear });
  playback.applyControl({} as never);
  await Promise.resolve();
  for (let x = 1; x <= 10; x++) {
    snapshot.view!.nodeStates["node-baked"]!.transform.position[0] = x;
    playback.applyState({} as never);
  }
  expect(present).toHaveBeenCalledTimes(1);
  finish();
  await playback.waitForIdle();
  expect(present).toHaveBeenCalledTimes(2);
  expect(present.mock.calls[1]![0].nodeStates["node-baked"].transform.position[0]).toBe(10);
  expect(clear).not.toHaveBeenCalled();
  playback.dispose();
});
it("clears display immediately on resync and ignores completion of an old view", async () => {
  let finish!: () => void;
  const present = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const clear = vi.fn();
  const playback = createRuntimePlayback({ delivery: {} as never, present, clear });
  playback.applyControl({} as never);
  await Promise.resolve();
  snapshot = { ...snapshot, phase: "resync-required", view: null, reason: "sequence-gap" };
  playback.applyControl({} as never);
  expect(clear).toHaveBeenCalledTimes(1);
  finish();
  await playback.waitForIdle();
  expect(playback.getSnapshot().rendering).not.toBe("ready");
  playback.dispose();
});
it("fails closed when rendering rejects and waits for a new snapshot", async () => {
  const present = vi.fn().mockRejectedValue(new Error("private asset URL must not leak"));
  const clear = vi.fn();
  const playback = createRuntimePlayback({ delivery: {} as never, present, clear });
  playback.applyControl({} as never);
  await playback.waitForIdle();
  expect(playback.getSnapshot()).toMatchObject({
    rendering: "error",
    error: "presentation-render-failed",
    assetFailure: null,
    renderFailurePhase: "prepare",
  });
  expect(clear).toHaveBeenCalledTimes(1);
  playback.applyState({} as never);
  await playback.waitForIdle();
  expect(present).toHaveBeenCalledTimes(1);
  playback.dispose();
});

it("clears an invalid null control item without letting a boundary error retain the old display", () => {
  const clear = vi.fn();
  const playback = createRuntimePlayback({
    delivery: {} as never,
    present: vi.fn().mockResolvedValue(undefined),
    clear,
  });
  snapshot = { ...snapshot, phase: "resync-required", view: null };
  expect(() => playback.applyControl(null as never)).not.toThrow();
  expect(clear).toHaveBeenCalledTimes(1);
  playback.dispose();
});

it("samples only a prepared view and fails closed on a frame renderer error", async () => {
  let now = 0;
  let finish!: () => void;
  const frame = vi.fn();
  const clear = vi.fn();
  const playback = createRuntimePlayback({
    delivery: {} as never,
    now: () => now,
    present: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    frame,
    clear,
  });
  playback.applyControl({} as never);
  await Promise.resolve();
  playback.prepareFrame();
  expect(frame).not.toHaveBeenCalled();
  finish();
  await playback.waitForIdle();
  now = 50;
  playback.prepareFrame();
  expect(frame).toHaveBeenCalledWith(
    snapshot.view,
    snapshot.view!.clock.runtimeTimeMilliseconds + 50,
  );
  frame.mockImplementation(() => {
    throw new Error("sensitive render detail");
  });
  playback.prepareFrame();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(playback.getSnapshot()).toMatchObject({
    error: "presentation-render-failed",
    assetFailure: null,
    renderFailurePhase: "frame",
  });
  playback.prepareFrame();
  expect(frame).toHaveBeenCalledTimes(2);
  playback.dispose();
});
