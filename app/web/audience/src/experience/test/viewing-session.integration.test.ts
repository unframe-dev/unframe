import { afterEach, expect, test, vi } from "vitest";
import type {
  ConnectionSnapshotEnvelopeWire,
  DeliveryManifestWire,
  ParticipantRuntimeView,
  RuntimeProjectionFenceWire,
  StateServerItemWire,
} from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createRuntimePlayback } from "../../runtime/playback";
import { createViewingSession } from "../viewing-session";

function contractFixture() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
  delivery.projectionProfile!.requiredRuntimeCapabilities = [1, 2, 3, 8, 9, 10];
  const profileId = delivery.projectionProfile!.projectionProfileId!;
  const nodeId = delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.nodeId!;
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const fence: RuntimeProjectionFenceWire = {
    sessionId: delivery.sessionId!,
    publication: delivery.publication!,
    assignmentEpoch: "1",
    projectionProfileId: profileId,
    presentationOriginVersion: "0",
  };
  const transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const snapshot: ConnectionSnapshotEnvelopeWire = {
    schemaVersion: 3,
    connectionId: "connection",
    fence,
    projectionInstance: delivery.projectionInstance!,
    reliableSequence: "0",
    snapshot: {
      projectionProfileId: profileId,
      assignmentEpoch: "1",
      reliableSequence: "0",
      runtimeView: {
        projectionProfileId: profileId,
        assignmentEpoch: "1",
        baseReliableSequence: "0",
        progression: {
          currentGroupId: "intro",
          groupEntryEpoch: "1",
          currentStepId: "start",
          stepEntryEpoch: "1",
          stepEnteredAtRuntimeTimeMs: "0",
          stable: {},
        },
        nodeStates: [{ nodeId, active: true, visible: true, opacity: 1, transform }],
        surfaceStates: [{ surfaceId, stateId: "reference-surface:default" }],
        variables: [],
        activeRuns: [],
        mediaStates: [],
        modelClipStates: [],
        enabledLogicalInputs: [],
        clock: { runtimeTimeMs: "0", running: {} },
        presentationOrigin: {
          version: "0",
          pose: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      },
    },
  };
  return {
    delivery,
    snapshot,
    fence,
    nodeId,
    surfaceId,
    transform,
  };
}

const sessions: ReturnType<typeof createViewingSession>[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});
function setup() {
  const data = contractFixture();
  let running = false;
  let rendered: ParticipantRuntimeView | null = null;
  let runtime: ReturnType<typeof createRuntimePlayback> | null = null;
  const clear = vi.fn(() => {
    rendered = null;
  });
  const present = vi.fn(async (view: ParticipantRuntimeView) => {
    rendered = structuredClone(view);
  });
  const runtimes: ReturnType<typeof createRuntimePlayback>[] = [];
  const host = {
    start: vi.fn(async () => {
      running = true;
    }),
    stop: vi.fn(() => {
      running = false;
      runtime?.dispose();
      runtime = null;
    }),
    dispose: vi.fn(() => {
      running = false;
      runtime?.dispose();
      runtime = null;
    }),
    getSnapshot: () => ({ stage: running ? "running" : "stopped" }),
    openRuntime: vi.fn((delivery: DeliveryManifestWire) => {
      runtime?.dispose();
      runtime = createRuntimePlayback({ delivery, present, clear, now: () => 0 });
      runtimes.push(runtime);
      return runtime;
    }),
  };
  const viewer = createViewingSession(host as never);
  sessions.push(viewer);
  function keyframe(sequence = "1", x = 1): StateServerItemWire {
    return {
      stateFrame: {
        fence: data.fence,
        kind: 1,
        frameSequence: sequence,
        baseReliableSequence: "0",
        elements: [
          {
            elementId: data.nodeId,
            node: {
              active: true,
              visible: true,
              opacity: 0.25,
              transform: { ...data.transform, position: { x, y: 0, z: -2 } },
            },
          },
        ],
      },
    };
  }
  async function start() {
    await viewer.start(data.delivery);
    viewer.getInput()!.applyControl({ connectionSnapshot: data.snapshot });
    await viewer.waitForIdle();
  }
  return {
    ...data,
    host,
    viewer,
    runtimes,
    clear,
    present,
    keyframe,
    start,
    rendered: () => rendered,
  };
}

test("contract Snapshot and State flow through the viewing controller into real Runtime playback", async () => {
  const { viewer, host, start, keyframe, rendered, nodeId, present } = setup();
  await start();
  expect(host.start).toHaveBeenCalledOnce();
  expect(viewer.getSnapshot()).toMatchObject({
    phase: "viewing",
    runtime: { phase: "ready", rendering: "ready", reliableSequence: "0" },
  });
  expect(rendered()?.nodeStates[nodeId]?.transform.position).toEqual([0, 0, 0]);
  viewer.getInput()!.applyState(keyframe());
  await viewer.waitForIdle();
  expect(rendered()?.nodeStates[nodeId]).toMatchObject({
    opacity: 0.25,
    transform: { position: [1, 0, -2] },
  });
  expect(viewer.getSnapshot()).toMatchObject({
    phase: "viewing",
    recovery: null,
    runtime: { stateSequence: "1", stateSync: "ready" },
  });
  expect(present).toHaveBeenCalledTimes(2);
});

test("stopped generation inputs cannot mutate a restarted viewing session", async () => {
  const { viewer, host, delivery, snapshot, start, rendered, nodeId, keyframe } = setup();
  await start();
  const old = viewer.getInput()!;
  viewer.stop();
  expect(rendered()).toBeNull();
  await viewer.start(delivery);
  const current = viewer.getInput()!;
  expect(current).not.toBe(old);
  old.applyControl({ connectionSnapshot: snapshot });
  old.applyState(keyframe("1", 7));
  await viewer.waitForIdle();
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  expect(rendered()).toBeNull();
  current.applyControl({ connectionSnapshot: snapshot });
  await viewer.waitForIdle();
  expect(rendered()?.nodeStates[nodeId]?.transform.position).toEqual([0, 0, 0]);
  expect(host.start).toHaveBeenCalledTimes(2);
});

test("asset URL refresh preserves camera, bound input, real Runtime state, and delivery identity", async () => {
  const { viewer, host, delivery, start, keyframe, rendered, nodeId } = setup();
  await start();
  const input = viewer.getInput()!;
  input.applyState(keyframe("1", 2));
  await viewer.waitForIdle();
  const activeDelivery = host.openRuntime.mock.calls[0]![0];
  const refreshed = structuredClone(delivery);
  const access = refreshed.assetAccess![0]!;
  access.url = "https://assets.example/refreshed.png?signature=new";
  access.expiresAtUnixMs = "2000000000000";
  viewer.updateDelivery(refreshed);
  await viewer.waitForIdle();
  expect(host.start).toHaveBeenCalledOnce();
  expect(host.stop).not.toHaveBeenCalled();
  expect(host.openRuntime).toHaveBeenCalledOnce();
  expect(viewer.getInput()).toBe(input);
  expect(activeDelivery.assetAccess![0]!.url).toBe(access.url);
  expect(viewer.getSnapshot()).toMatchObject({ phase: "viewing", runtime: { stateSequence: "1" } });
  expect(rendered()?.nodeStates[nodeId]?.transform.position).toEqual([2, 0, -2]);
});

test("a new assignment drops displayed state and old inputs until its own Snapshot arrives", async () => {
  const { viewer, host, delivery, snapshot, start, keyframe, rendered } = setup();
  await start();
  const previous = viewer.getInput()!;
  const nextDelivery = structuredClone(delivery);
  nextDelivery.projectionInstance!.assignmentEpoch = "2";
  viewer.updateDelivery(nextDelivery);
  expect(host.start).toHaveBeenCalledOnce();
  expect(host.openRuntime).toHaveBeenCalledTimes(2);
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  expect(rendered()).toBeNull();
  previous.applyControl({ connectionSnapshot: snapshot });
  previous.applyState(keyframe());
  await viewer.waitForIdle();
  expect(viewer.getSnapshot().phase).toBe("awaiting-snapshot");
  const nextSnapshot = structuredClone(snapshot);
  nextSnapshot.connectionId = "connection-new";
  nextSnapshot.fence!.assignmentEpoch = "2";
  nextSnapshot.projectionInstance = nextDelivery.projectionInstance!;
  nextSnapshot.snapshot!.assignmentEpoch = "2";
  nextSnapshot.snapshot!.runtimeView!.assignmentEpoch = "2";
  viewer.getInput()!.applyControl({ connectionSnapshot: nextSnapshot });
  await viewer.waitForIdle();
  expect(viewer.getSnapshot().phase).toBe("viewing");
  expect(rendered()).not.toBeNull();
});

test("a reliable gap removes stale presentation and requests a fresh Snapshot", async () => {
  const { viewer, start, fence, rendered } = setup();
  await start();
  viewer.getInput()!.applyControl({
    reliableEvent: {
      fence,
      sequence: "2",
      eventId: "gap",
      occurredAtRuntimeTimeMs: "1",
      logicalInputAccepted: { logicalEventName: "next" },
    },
  });
  await viewer.waitForIdle();
  expect(rendered()).toBeNull();
  expect(viewer.getSnapshot()).toMatchObject({
    phase: "resync-required",
    recovery: { kind: "snapshot" },
    runtime: { phase: "resync-required", rendering: "idle" },
  });
});

test("a State delta gap preserves display and emits a stable keyframe recovery request", async () => {
  const { viewer, start, keyframe, nodeId, rendered, fence } = setup();
  await start();
  const input = viewer.getInput()!;
  input.applyState(keyframe());
  await viewer.waitForIdle();
  input.applyState({
    stateFrame: {
      fence,
      kind: 2,
      frameSequence: "3",
      baseReliableSequence: "0",
      elements: [{ elementId: nodeId, node: { opacity: 0.9 } }],
    },
  });
  await viewer.waitForIdle();
  const recovery = viewer.getSnapshot().recovery;
  expect(recovery).toMatchObject({ kind: "keyframe", afterSequence: "0" });
  expect(rendered()?.nodeStates[nodeId]?.opacity).toBe(0.25);
  input.applyState({
    stateFrame: {
      fence,
      kind: 2,
      frameSequence: "4",
      baseReliableSequence: "0",
      elements: [{ elementId: nodeId, node: { opacity: 0.9 } }],
    },
  });
  await viewer.waitForIdle();
  expect(viewer.getSnapshot().recovery).toEqual(recovery);
  input.applyState(keyframe("5", 3));
  await viewer.waitForIdle();
  expect(viewer.getSnapshot()).toMatchObject({
    phase: "viewing",
    recovery: null,
    runtime: { stateSequence: "5", stateSync: "ready" },
  });
  expect(rendered()?.nodeStates[nodeId]?.transform.position).toEqual([3, 0, -2]);
});
