import { afterEach, expect, test, vi } from "vitest";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import fixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createViewingSession } from "./viewing-session";

function delivery(): DeliveryManifestWire {
  const value = structuredClone(fixture.value) as DeliveryManifestWire;
  value.projectionProfile!.key!.role = 2;
  value.projectionProfile!.requiredRuntimeCapabilities = [1, 2, 3, 8, 9, 10];
  value.assetAccess![0]!.url = "https://example.test/old";
  return value;
}
function setup() {
  const snapshot = {
    phase: "awaiting-snapshot",
    rendering: "idle",
    view: null,
    error: null,
    reason: null,
    stateSync: "awaiting-keyframe",
    reliableSequence: "0",
    stateSequence: "0",
  };
  const runtimes: ReturnType<typeof runtime>[] = [];
  function runtime() {
    return {
      applyControl: vi.fn(),
      applyState: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
      getSnapshot: vi.fn(() => snapshot),
    };
  }
  const host = {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    dispose: vi.fn(),
    getSnapshot: () => ({ stage: "running" }),
    openRuntime: vi.fn((_delivery: DeliveryManifestWire) => {
      const next = runtime();
      runtimes.push(next);
      return next;
    }),
  };
  const viewer = createViewingSession(host as never);
  return { host, viewer, snapshot, runtimes };
}
afterEach(() => vi.useRealTimers());
test("starts XR, opens runtime, and exposes a generation-bound input", async () => {
  const { viewer, host, runtimes } = setup();
  await viewer.start(delivery());
  expect(host.start).toHaveBeenCalledOnce();
  expect(host.openRuntime).toHaveBeenCalledOnce();
  const input = viewer.getInput()!;
  input.applyControl({ connectionSnapshot: {} });
  await viewer.waitForIdle();
  expect(runtimes[0]!.applyControl).toHaveBeenCalledOnce();
  viewer.stop();
  input.applyControl({ projectionAdvance: { fromExclusive: "0", throughSequence: "1" } });
  expect(runtimes[0]!.applyControl).toHaveBeenCalledOnce();
  expect(host.stop).toHaveBeenCalledOnce();
  viewer.dispose();
});
test("late camera startup cannot open a runtime after stop", async () => {
  const { viewer, host } = setup();
  let complete!: () => void;
  host.start.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const start = viewer.start(delivery());
  viewer.stop();
  complete();
  await start;
  expect(host.openRuntime).not.toHaveBeenCalled();
  viewer.dispose();
});
test("refreshes only asset access in place while retaining the runtime and input", async () => {
  const { viewer, host } = setup();
  await viewer.start(delivery());
  const input = viewer.getInput();
  const active = host.openRuntime.mock.calls[0]![0] as DeliveryManifestWire;
  const next = delivery();
  next.assetAccess![0]!.url = "https://example.test/new";
  viewer.updateDelivery(next);
  expect(viewer.getInput()).toBe(input);
  expect(host.openRuntime).toHaveBeenCalledOnce();
  expect(active.assetAccess![0]!.url).toBe("https://example.test/new");
  viewer.dispose();
});
test("assignment changes replace runtime without restarting camera and reject the old input", async () => {
  const { viewer, host, runtimes } = setup();
  await viewer.start(delivery());
  const old = viewer.getInput()!;
  const next = delivery();
  next.projectionInstance!.assignmentEpoch = "2";
  viewer.updateDelivery(next);
  old.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(runtimes[0]!.applyState).not.toHaveBeenCalled();
  expect(host.start).toHaveBeenCalledOnce();
  expect(host.openRuntime).toHaveBeenCalledTimes(2);
  viewer.dispose();
});
test("reports one recovery request for each missing state baseline and clears it after recovery", async () => {
  const { viewer, snapshot } = setup();
  await viewer.start(delivery());
  const input = viewer.getInput()!;
  Object.assign(snapshot, { phase: "ready", rendering: "ready", stateSync: "awaiting-keyframe" });
  input.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(viewer.getSnapshot().recovery?.kind).toBe("keyframe");
  const request = viewer.getSnapshot().recovery;
  input.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(viewer.getSnapshot().recovery).toEqual(request);
  snapshot.stateSync = "ready";
  input.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(viewer.getSnapshot().recovery).toBeNull();
  snapshot.phase = "resync-required";
  input.applyControl({ projectionAdvance: { fromExclusive: "0", throughSequence: "1" } });
  expect(viewer.getSnapshot().recovery?.kind).toBe("snapshot");
  viewer.restartInput();
  input.applyControl({ projectionAdvance: { fromExclusive: "0", throughSequence: "1" } });
  expect(viewer.getInput()).not.toBe(input);
  viewer.dispose();
});
test("disconnect hides and resets playback; reconnection requires a fresh bound input", async () => {
  const { viewer, runtimes } = setup();
  await viewer.start(delivery());
  const old = viewer.getInput()!;
  old.disconnected();
  expect(viewer.getSnapshot().phase).toBe("disconnected");
  expect(runtimes[0]!.reset).toHaveBeenCalledOnce();
  old.applyControl({ projectionAdvance: { fromExclusive: "0", throughSequence: "1" } });
  expect(runtimes[0]!.applyControl).not.toHaveBeenCalled();
  viewer.restartInput();
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  viewer.dispose();
});

test("camera start failure releases partially started resources and permits retry", async () => {
  const { viewer, host } = setup();
  host.start.mockRejectedValueOnce(new Error("https://private.test/?credential=secret"));
  await viewer.start(delivery());
  expect(viewer.getSnapshot()).toMatchObject({ phase: "error", error: "viewing-start-failed" });
  expect(JSON.stringify(viewer.getSnapshot())).not.toContain("secret");
  expect(host.stop).toHaveBeenCalledOnce();
  await viewer.start(delivery());
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  expect(host.openRuntime).toHaveBeenCalledOnce();
  viewer.dispose();
});

test("runtime initialization failures are safe and invalidate the prior input", async () => {
  const { viewer, host, runtimes } = setup();
  await viewer.start(delivery());
  const old = viewer.getInput()!;
  host.openRuntime.mockImplementationOnce(() => {
    throw new Error("private signed URL");
  });
  const next = delivery();
  next.projectionInstance!.assignmentEpoch = "2";
  expect(() => viewer.updateDelivery(next)).not.toThrow();
  expect(viewer.getSnapshot()).toMatchObject({ phase: "error", error: "viewing-start-failed" });
  expect(viewer.getInput()).toBeNull();
  old.applyControl({ projectionAdvance: { fromExclusive: "0", throughSequence: "1" } });
  expect(runtimes[0]!.applyControl).not.toHaveBeenCalled();
  expect(viewer.restartInput()).not.toBeNull();
  viewer.dispose();
});

test("a changed assignment while the host is stopped invalidates and hides the old runtime", async () => {
  const { viewer, host, runtimes } = setup();
  await viewer.start(delivery());
  const old = viewer.getInput()!;
  vi.spyOn(host, "getSnapshot").mockReturnValue({ stage: "stopped" });
  const next = delivery();
  next.projectionInstance!.assignmentEpoch = "2";
  viewer.updateDelivery(next);
  old.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(runtimes[0]!.applyState).not.toHaveBeenCalled();
  expect(runtimes[0]!.reset).toHaveBeenCalledOnce();
  expect(viewer.getInput()).toBeNull();
  expect(viewer.getRuntimeSnapshot()).toBeNull();
  expect(viewer.getSnapshot().phase).toBe("error");
  viewer.dispose();
});

test("disposal drops the last runtime snapshot and stops periodic inspection", async () => {
  vi.useFakeTimers();
  const { viewer, snapshot, runtimes } = setup();
  await viewer.start(delivery());
  Object.assign(snapshot, { phase: "ready", rendering: "ready", stateSync: "ready", view: {} });
  await vi.advanceTimersByTimeAsync(150);
  expect(viewer.getSnapshot().phase).toBe("viewing");
  const inspected = runtimes[0]!.getSnapshot.mock.calls.length;
  viewer.dispose();
  await vi.advanceTimersByTimeAsync(300);
  expect(runtimes[0]!.getSnapshot).toHaveBeenCalledTimes(inspected);
  expect(viewer.getSnapshot()).toMatchObject({ phase: "idle", runtime: null, recovery: null });
  expect(viewer.getRuntimeSnapshot()).toBeNull();
});

test("a failed superseded camera start cannot cancel a newer startup", async () => {
  const { viewer, host } = setup();
  let rejectOld!: (error: Error) => void;
  let completeNew!: () => void;
  host.start.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  host.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeNew = resolve;
      }),
  );
  const oldStart = viewer.start(delivery());
  viewer.stop();
  const newStart = viewer.start(delivery());
  rejectOld(new Error("stale platform failure"));
  await oldStart;
  expect(viewer.getSnapshot().phase).toBe("starting");
  expect(host.stop).toHaveBeenCalledOnce();
  completeNew();
  await newStart;
  expect(host.openRuntime).toHaveBeenCalledOnce();
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  viewer.dispose();
});

test("periodic inspection removes runtime input when the XR host becomes unavailable", async () => {
  vi.useFakeTimers();
  const { viewer, host, runtimes } = setup();
  await viewer.start(delivery());
  const old = viewer.getInput()!;
  vi.spyOn(host, "getSnapshot").mockReturnValue({ stage: "error" });
  await vi.advanceTimersByTimeAsync(150);
  expect(viewer.getSnapshot()).toMatchObject({
    phase: "error",
    error: "viewing-host-unavailable",
    runtime: null,
  });
  expect(viewer.getInput()).toBeNull();
  old.applyState({ stateFrame: { kind: 1, frameSequence: "1" } });
  expect(runtimes[0]!.applyState).not.toHaveBeenCalled();
  expect(runtimes[0]!.reset).toHaveBeenCalledOnce();
  viewer.dispose();
});
