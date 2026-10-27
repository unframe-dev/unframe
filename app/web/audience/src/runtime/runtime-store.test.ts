import { encodeWireMessage } from "@unframe/contracts/presentation";
import { describe, expect, it } from "vitest";
import type {
  ConnectionSnapshotEnvelopeWire,
  DeliveryManifestWire,
  RuntimeProjectionFenceWire,
  RuntimeRunSnapshotWire,
  ControlServerItemWire,
} from "@unframe/contracts/presentation";
import fixture from "../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createRuntimeStore } from "./runtime-store";

function setup() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
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
    store: createRuntimeStore(delivery),
    snapshot,
    fence,
    nodeId,
    surfaceId,
    transform,
  };
}

describe("runtime store", () => {
  it.each([
    { gestureInputAccepted: { gesture: 1 } },
    { zoneInputAccepted: { zoneId: "stage", edge: 1 } },
  ])(
    "advances accepted Presenter recognition events without enabling Viewer inputs (%j)",
    (payload) => {
      const { store, snapshot, fence } = setup();
      store.applyControl({ connectionSnapshot: snapshot });
      store.applyControl({
        reliableEvent: {
          fence,
          sequence: "1",
          eventId: "accepted",
          occurredAtRuntimeTimeMs: "0",
          ...payload,
        },
      });
      expect(store.getSnapshot()).toMatchObject({ phase: "ready", reliableSequence: "1" });
      expect(store.getSnapshot().view!.enabledLogicalInputs).toEqual([]);
    },
  );

  it.each([6, 7])("rejects ControlConnected requiring unsupported capability %s", (capability) => {
    const { store, delivery } = setup();
    store.applyControl({
      connected: {
        protocolVersion: "v3",
        progressionContractVersion: 2,
        requiredCapabilities: [1, capability, 8, 9, 10],
        connectionId: "connection",
        projectionInstance: delivery.projectionInstance!,
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("accepts v3 Control negotiation and then a Viewer snapshot", () => {
    const { store, delivery, snapshot } = setup();
    store.applyControl({
      connected: {
        protocolVersion: "v3",
        progressionContractVersion: 2,
        requiredCapabilities: [1, 2, 3, 4, 5, 8, 9, 10],
        connectionId: "connection",
        projectionInstance: delivery.projectionInstance!,
      },
    });
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
  });
  it.each([
    {
      presenterStepSelectionCatalog: {
        reachedSteps: [{ groupId: "intro", stepId: "start" }],
        reliableSequence: "0",
      },
    },
    {
      presenterInputSynchronization: {
        phase: 1,
        reason: 1,
        synchronizationRevision: "1",
        commandEpoch: "1",
        reliableSequence: "0",
        inputContext: {
          inputEpoch: "1",
          groupId: "intro",
          groupEntryEpoch: "1",
          stepId: "start",
          stepEntryEpoch: "1",
        },
        recognitionCatalog: {},
      },
    },
  ])("rejects Presenter-only Control data on the Viewer stream (%j)", (payload) => {
    const { store, snapshot } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(() => encodeWireMessage("unframe.realtime.ControlServerItem", payload)).not.toThrow();
    store.applyControl(payload);
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });

  it("atomically restores a complete Viewer view at the reliable event cut", () => {
    const { store, snapshot, fence, nodeId } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    const replacement = structuredClone(snapshot.snapshot!.runtimeView!);
    replacement.baseReliableSequence = "1";
    replacement.progression!.currentStepId = "restored";
    replacement.progression!.stepEntryEpoch = "2";
    replacement.nodeStates![0]!.opacity = 0.4;
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "restore",
        occurredAtRuntimeTimeMs: "0",
        runtimeViewReplaced: { runtimeView: replacement },
      },
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "ready",
      reliableSequence: "1",
      stateSync: "awaiting-keyframe",
    });
    expect(store.getSnapshot().view!.progression.currentStepId).toBe("restored");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.4);
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "1",
        baseReliableSequence: "0",
        kind: 2,
        elements: [{ elementId: nodeId, node: { opacity: 1 } }],
      },
    });
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.4);
  });
  it.each(["cut", "profile", "assignment", "origin", "time"])(
    "rejects a replacement with mismatching %s",
    (kind) => {
      const { store, snapshot, fence } = setup();
      store.applyControl({ connectionSnapshot: snapshot });
      const replacement = structuredClone(snapshot.snapshot!.runtimeView!);
      replacement.baseReliableSequence = "1";
      if (kind === "cut") replacement.baseReliableSequence = "0";
      if (kind === "profile") replacement.projectionProfileId = "other";
      if (kind === "assignment") replacement.assignmentEpoch = "2";
      if (kind === "origin") replacement.presentationOrigin!.version = "1";
      if (kind === "time") replacement.clock!.runtimeTimeMs = "1";
      store.applyControl({
        reliableEvent: {
          fence,
          sequence: "1",
          eventId: "restore",
          occurredAtRuntimeTimeMs: "0",
          runtimeViewReplaced: { runtimeView: replacement },
        },
      });
      expect(store.getSnapshot().phase).toBe("resync-required");
      expect(store.getSnapshot().view).toBeNull();
    },
  );

  it("rejects a v2 snapshot instead of rendering it under v3 delivery", () => {
    const { store, snapshot } = setup();
    snapshot.schemaVersion = 2;
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });
  it("rejects frozen anchor state until Viewer anchor rendering is supported", () => {
    const { store, snapshot, nodeId } = setup();
    snapshot.snapshot!.runtimeView!.frozenAnchors = [{ nodeId, position: { x: 1 } }];
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });

  it("applies a snapshot without sharing mutable input or output", () => {
    const { store, snapshot, nodeId } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    snapshot.snapshot!.runtimeView!.nodeStates![0]!.opacity = 0;
    const state = store.getSnapshot();
    expect(state.view!.nodeStates[nodeId]!.opacity).toBe(1);
    state.view!.nodeStates[nodeId]!.opacity = 0;
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
  });
  it("advances hidden sequences and applies a complete node commit", () => {
    const { store, snapshot, fence, nodeId, transform } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({ projectionAdvance: { fence, fromExclusive: "0", throughSequence: "2" } });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "3",
        eventId: "event",
        occurredAtRuntimeTimeMs: "10",
        nodeStateCommitted: {
          state: { nodeId, active: true, visible: false, opacity: 0.5, transform },
        },
      },
    });
    expect(store.getSnapshot().reliableSequence).toBe("3");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.visible).toBe(false);
  });
  it.each(["gap", "fence", "unsupported"])("clears the display on %s reliable failure", (kind) => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence: kind === "fence" ? { ...fence, assignmentEpoch: "2" } : fence,
        sequence: kind === "gap" ? "2" : "1",
        eventId: "event",
        occurredAtRuntimeTimeMs: "10",
        ...(kind === "unsupported"
          ? { timelineStarted: {} }
          : { logicalInputAccepted: { logicalEventName: "next" } }),
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });
  it("accepts keyframe then contiguous delta and ignores old frames", () => {
    const { store, snapshot, fence, nodeId, transform } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "4",
        baseReliableSequence: "0",
        kind: 1,
        elements: [
          { elementId: nodeId, node: { active: true, visible: true, opacity: 1, transform } },
        ],
      },
    });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "5",
        baseReliableSequence: "0",
        kind: 2,
        elements: [{ elementId: nodeId, node: { opacity: 0.3 } }],
      },
    });
    store.applyState({
      stateFrame: { fence, frameSequence: "4", baseReliableSequence: "0", kind: 2, elements: [] },
    });
    expect(store.getSnapshot().stateSequence).toBe("5");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.3);
  });
  it("requires full keyframes and contiguous deltas", () => {
    const { store, snapshot, fence, nodeId } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "1",
        baseReliableSequence: "0",
        kind: 1,
        elements: [{ elementId: nodeId, node: { opacity: 1 } }],
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
    store.reset();
    expect(store.getSnapshot().phase).toBe("awaiting-snapshot");
  });
  it("rejects an inconsistent snapshot fence", () => {
    const { store, snapshot } = setup();
    snapshot.fence!.presentationOriginVersion = "2";
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().view).toBeNull();
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("applies a surface state and rejects mismatching previous state", () => {
    const { store, snapshot, fence, surfaceId } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "surface-event",
        surfaceStateChanged: {
          surfaceId,
          fromStateId: "reference-surface:default",
          stateId: "reference-surface:inactive",
        },
      },
    });
    expect(store.getSnapshot().view!.surfaceStates[surfaceId]!.stateId).toBe(
      "reference-surface:inactive",
    );
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "bad-surface",
        surfaceStateChanged: {
          surfaceId,
          fromStateId: "reference-surface:default",
          stateId: "reference-surface:inactive",
        },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("advances origin under the previous fence and rejects later old fences", () => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "origin",
        presentationOriginChanged: {
          origin: { version: "1", pose: { position: { x: 2 }, rotation: { w: 1 } } },
        },
      },
    });
    expect(store.getSnapshot().view!.presentationOrigin.pose.position).toEqual([2, 0, 0]);
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "old",
        logicalInputAccepted: { logicalEventName: "next" },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("applies step entry only with consecutive epoch and matching runtime timestamp", () => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "step",
        occurredAtRuntimeTimeMs: "20",
        stepEntered: {
          groupId: "intro",
          groupEntryEpoch: "1",
          stepId: "second",
          stepEntryEpoch: "2",
          enteredAtRuntimeTimeMs: "20",
        },
      },
    });
    expect(store.getSnapshot().view!.progression.currentStepId).toBe("second");
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "old-clock",
        occurredAtRuntimeTimeMs: "19",
        logicalInputAccepted: { logicalEventName: "next" },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("pauses and ends without advancing a local authoritative clock", () => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "pause",
        runtimeStatusChanged: { paused: { reason: 8 } },
      },
    });
    expect(store.getSnapshot().view!.clock.lifecycle.kind).toBe("paused");
    store.applyControl({
      reliableEvent: { fence, sequence: "2", eventId: "end", presentationEnded: { reason: 1 } },
    });
    expect(store.getSnapshot().phase).toBe("ended");
    store.reset();
    expect(store.getSnapshot().view).toBeNull();
  });
  it.each(["unsafe", "duplicate", "unknown", "empty"])("rejects %s state input", (kind) => {
    const { store, snapshot, fence, nodeId, transform } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    const full = {
      elementId: nodeId,
      node: { active: true, visible: true, opacity: 1, transform },
    };
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "1",
        baseReliableSequence: "0",
        kind: 1,
        elements: [full],
      },
    });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: kind === "unsafe" ? "9007199254740992" : kind === "delta-gap" ? "3" : "2",
        baseReliableSequence: kind === "future-base" ? "1" : "0",
        kind: 2,
        elements:
          kind === "duplicate"
            ? [full, full]
            : kind === "unknown"
              ? [{ ...full, elementId: "missing" }]
              : kind === "empty"
                ? [{ elementId: nodeId, node: { transform: {} } }]
                : [full],
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });
  it("rejects multiple wire variants instead of selecting one", () => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "event",
        logicalInputAccepted: { logicalEventName: "next" },
        presentationEnded: { reason: 1 },
      },
    } as never);
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it.each(["anchor", "variable"])(
    "rejects an unsupported anchor or missing variable state (%s)",
    (kind) => {
      const { delivery, snapshot } = setup();
      const catalog = delivery.projectionProfile!.runtimeCatalog!;
      if (kind === "anchor") catalog.nodes![0]!.parent = { presenterAnchor: {} };
      if (kind === "variable")
        catalog.variables = [{ variableId: "counter", type: 1, owner: { presentation: {} } }];
      const store = createRuntimeStore(delivery);
      store.applyControl({ connectionSnapshot: snapshot });
      expect(store.getSnapshot().phase).toBe("resync-required");
      expect(store.getSnapshot().view).toBeNull();
    },
  );
  it("rejects a repeated snapshot instead of rolling reliable state back", () => {
    const { store, snapshot, fence } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({ projectionAdvance: { fence, fromExclusive: "0", throughSequence: "5" } });
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
    store.reset();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
  });
  it("rejects repeated StateConnected and resets the attachment guard on reset", () => {
    const { store, snapshot } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
    expect(store.getSnapshot().phase).toBe("ready");
    store.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
    store.reset();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
    expect(store.getSnapshot().phase).toBe("ready");
  });
  it("rejects a late StateConnected after accepting frames", () => {
    const { store, snapshot, fence, nodeId, transform } = setup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "4",
        kind: 1,
        elements: [
          { elementId: nodeId, node: { active: true, visible: true, opacity: 1, transform } },
        ],
      },
    });
    store.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
});

describe("independent State recovery", () => {
  it.each([{}, { nextStateFrameSequence: "0" }, { nextStateFrameSequence: "9007199254740992" }])(
    "rejects invalid State attachment sequence %j after restart",
    (sequence) => {
      const { store, snapshot } = setup();
      store.applyControl({ connectionSnapshot: snapshot });
      store.restartState();
      store.applyState({ connected: { connectionId: "connection", ...sequence } });
      expect(store.getSnapshot()).toMatchObject({ phase: "resync-required", view: null });
    },
  );

  it("reattaches State repeatedly after gaps while retaining the Control cut and displayed view", () => {
    const { store, snapshot, fence, nodeId, transform } = setup();
    snapshot.reliableSequence = "7";
    snapshot.snapshot!.reliableSequence = "7";
    snapshot.snapshot!.runtimeView!.baseReliableSequence = "7";
    store.applyControl({ connectionSnapshot: snapshot });
    const connected = { connected: { connectionId: "connection", nextStateFrameSequence: "1" } };
    const keyframe = {
      stateFrame: {
        fence,
        frameSequence: "1",
        baseReliableSequence: "7",
        kind: 1,
        elements: [
          { elementId: nodeId, node: { active: true, visible: true, opacity: 0.25, transform } },
        ],
      },
    };
    const delta = (sequence: string, opacity: number) => ({
      stateFrame: {
        fence,
        frameSequence: sequence,
        baseReliableSequence: "7",
        kind: 2,
        elements: [{ elementId: nodeId, node: { opacity } }],
      },
    });
    store.applyState(connected);
    store.applyState(keyframe);
    store.applyState(delta("3", 0.9));
    expect(store.getSnapshot()).toMatchObject({
      phase: "ready",
      stateSync: "awaiting-keyframe",
      reliableSequence: "7",
      stateSequence: "1",
    });
    const displayed = store.getSnapshot().view;
    store.restartState();
    expect(store.getSnapshot()).toMatchObject({
      phase: "ready",
      stateSync: "awaiting-keyframe",
      reliableSequence: "7",
      stateSequence: "0",
      view: displayed,
    });
    store.applyState(connected);
    expect(store.getSnapshot().phase).toBe("ready");
    store.applyState(delta("1", 0.9));
    expect(store.getSnapshot().view).toEqual(displayed);
    expect(store.getSnapshot().stateSync).toBe("awaiting-keyframe");
    store.applyState(keyframe);
    store.applyState(delta("2", 0.5));
    expect(store.getSnapshot()).toMatchObject({
      phase: "ready",
      stateSync: "ready",
      reliableSequence: "7",
      stateSequence: "2",
    });
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.5);
    store.applyState(delta("4", 0.9));
    store.restartState();
    store.applyState(connected);
    store.applyState(keyframe);
    store.applyState(delta("2", 0.75));
    expect(store.getSnapshot()).toMatchObject({
      phase: "ready",
      stateSync: "ready",
      reliableSequence: "7",
      stateSequence: "2",
    });
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.75);
  });

  it.each([1, 2] as const)(
    "discards a stale State frame of kind %s after a reliable node commit",
    (kind) => {
      const { store, snapshot, fence, nodeId, transform } = setup();
      store.applyControl({ connectionSnapshot: snapshot });
      store.applyState({
        stateFrame: {
          fence,
          frameSequence: "1",
          baseReliableSequence: "0",
          kind: 1,
          elements: [
            { elementId: nodeId, node: { active: true, visible: true, opacity: 1, transform } },
          ],
        },
      });
      store.applyControl({
        reliableEvent: {
          fence,
          sequence: "1",
          eventId: "node-commit",
          occurredAtRuntimeTimeMs: "10",
          nodeStateCommitted: {
            state: { nodeId, active: true, visible: true, opacity: 0.8, transform },
          },
        },
      });
      store.applyState({
        stateFrame: {
          fence,
          frameSequence: "2",
          baseReliableSequence: "0",
          kind,
          elements: [
            { elementId: nodeId, node: { active: true, visible: true, opacity: 0.3, transform } },
          ],
        },
      });
      expect(store.getSnapshot()).toMatchObject({
        phase: "ready",
        reliableSequence: "1",
        stateSequence: "1",
        stateSync: "awaiting-keyframe",
      });
      expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.8);
      store.applyState({
        stateFrame: {
          fence,
          frameSequence: "3",
          baseReliableSequence: "1",
          kind: 1,
          elements: [
            { elementId: nodeId, node: { active: true, visible: true, opacity: 0.6, transform } },
          ],
        },
      });
      expect(store.getSnapshot().stateSync).toBe("ready");
      expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.6);
    },
  );
  it.each(["gap", "future-base", "fence", "initial-delta"])(
    "preserves Control and waits for a keyframe after %s",
    (kind) => {
      const { store, snapshot, fence, nodeId, transform } = setup();
      const elements = [
        { elementId: nodeId, node: { active: true, visible: true, opacity: 1, transform } },
      ];
      store.applyControl({ connectionSnapshot: snapshot });
      expect(store.getSnapshot().stateSync).toBe("awaiting-keyframe");
      if (kind !== "initial-delta")
        store.applyState({
          stateFrame: {
            fence,
            frameSequence: "1",
            baseReliableSequence: "0",
            kind: 1,
            elements,
          },
        });
      store.applyState({
        stateFrame: {
          fence: kind === "fence" ? { ...fence, presentationOriginVersion: "3" } : fence,
          frameSequence: kind === "gap" ? "3" : "2",
          baseReliableSequence: kind === "future-base" ? "2" : "0",
          kind: 2,
          elements: [{ elementId: nodeId, node: { opacity: 0.2 } }],
        },
      });
      expect(store.getSnapshot()).toMatchObject({ phase: "ready", stateSync: "awaiting-keyframe" });
      expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
      const cursor = "1";
      store.applyControl({
        reliableEvent: {
          fence,
          sequence: cursor,
          eventId: "control-continues",
          logicalInputAccepted: { logicalEventName: "next" },
        },
      });
      expect(store.getSnapshot().reliableSequence).toBe(cursor);
      store.applyState({
        stateFrame: {
          fence,
          frameSequence: "4",
          baseReliableSequence: cursor,
          kind: 2,
          elements: [{ elementId: nodeId, node: { opacity: 0.3 } }],
        },
      });
      expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
      store.applyState({
        stateFrame: {
          fence,
          frameSequence: "5",
          baseReliableSequence: cursor,
          kind: 1,
          elements: [{ ...elements[0]!, node: { ...elements[0]!.node, opacity: 0.7 } }],
        },
      });
      expect(store.getSnapshot()).toMatchObject({
        phase: "ready",
        stateSync: "ready",
        stateSequence: "5",
      });
      expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.7);
    },
  );
});

it("accepts a keyframe at the currently applied Control cut", () => {
  const { store, snapshot, fence, nodeId, transform } = setup();
  store.applyControl({ connectionSnapshot: snapshot });
  store.applyControl({
    reliableEvent: {
      fence,
      sequence: "1",
      eventId: "advance",
      logicalInputAccepted: { logicalEventName: "next" },
    },
  });
  store.applyState({
    stateFrame: {
      fence,
      frameSequence: "1",
      baseReliableSequence: "1",
      kind: 1,
      elements: [
        { elementId: nodeId, node: { active: true, visible: true, opacity: 0.4, transform } },
      ],
    },
  });
  expect(store.getSnapshot()).toMatchObject({
    phase: "ready",
    reliableSequence: "1",
    stateSync: "ready",
  });
  expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.4);
});

function groupSetup() {
  const initial = setup();
  const catalog = initial.delivery.projectionProfile!.runtimeCatalog!;
  const node = structuredClone(catalog.nodes![0]!);
  const surface = structuredClone(catalog.surfaces![0]!);
  for (const groupId of ["intro", "next"]) {
    catalog.nodes!.push({ ...node, nodeId: `${groupId}-node`, owner: { group: { groupId } } });
    catalog.surfaces!.push({
      ...surface,
      surfaceId: `${groupId}-surface`,
      hostNodeId: `${groupId}-node`,
      owner: { group: { groupId } },
    });
  }
  const view = initial.snapshot.snapshot!.runtimeView!;
  view.nodeStates!.push({ ...structuredClone(view.nodeStates![0]!), nodeId: "intro-node" });
  view.nodeStates!.sort((a, b) => a.nodeId!.localeCompare(b.nodeId!));
  view.surfaceStates!.push({ surfaceId: "intro-surface", stateId: "reference-surface:default" });
  view.surfaceStates!.sort((a, b) => a.surfaceId!.localeCompare(b.surfaceId!));
  const store = createRuntimeStore(initial.delivery);
  const initialization = {
    nodeStates: [
      {
        nodeId: "next-node",
        active: true,
        visible: true,
        opacity: 0.4,
        transform: initial.transform,
      },
    ],
    surfaceStates: [{ surfaceId: "next-surface", stateId: "reference-surface:default" }],
  };
  const event = (sequence: number, payload: object) =>
    store.applyControl({
      reliableEvent: {
        fence: initial.fence,
        sequence: String(sequence),
        eventId: `event-${sequence}`,
        occurredAtRuntimeTimeMs: "10",
        ...payload,
      },
    } as never);
  return { ...initial, store, event, initialization };
}

describe("group ownership and progression", () => {
  it("accepts exactly presentation-owned and current Group-owned snapshot state", () => {
    const { store, snapshot } = groupSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.nodeStates["intro-node"]).toBeDefined();
    expect(store.getSnapshot().view!.nodeStates["next-node"]).toBeUndefined();
  });
  it("removes exiting resources and publishes the next Group only after its Step arrives", () => {
    const { store, snapshot, event, initialization, nodeId } = groupSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view).toBeNull();
    event(2, { groupEntered: { groupId: "next", groupEntryEpoch: "2", initialization } });
    expect(store.getSnapshot().view).toBeNull();
    event(3, {
      stepEntered: {
        groupId: "next",
        groupEntryEpoch: "2",
        stepId: "first",
        stepEntryEpoch: "2",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    const state = store.getSnapshot();
    expect(state.phase).toBe("ready");
    expect(state.view!.progression.currentGroupId).toBe("next");
    expect(state.view!.nodeStates["intro-node"]).toBeUndefined();
    expect(state.view!.nodeStates["next-node"]!.opacity).toBeCloseTo(0.4);
    expect(state.view!.nodeStates[nodeId]).toBeDefined();
    expect(state.view!.surfaceStates["next-surface"]).toBeDefined();
    expect(state.stateSync).toBe("awaiting-keyframe");
  });
  it.each(["missing", "foreign", "duplicate", "media", "epoch", "no-exit"])(
    "rejects invalid Group initialization: %s",
    (kind) => {
      const { store, snapshot, event, initialization, nodeId } = groupSetup();
      store.applyControl({ connectionSnapshot: snapshot });
      if (kind !== "no-exit") event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
      if (kind === "missing") initialization.nodeStates = [];
      if (kind === "foreign") initialization.nodeStates[0]!.nodeId = nodeId;
      if (kind === "duplicate") initialization.nodeStates.push(initialization.nodeStates[0]!);
      event(kind === "no-exit" ? 1 : 2, {
        groupEntered: {
          groupId: "next",
          groupEntryEpoch: kind === "epoch" ? "3" : "2",
          initialization: { ...initialization, ...(kind === "media" ? { mediaStates: [{}] } : {}) },
        },
      });
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
  it("rejects an exit for another Group or epoch", () => {
    const { store, snapshot, event } = groupSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "2" } });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
});

describe("Group State stream fencing", () => {
  it("ignores State while exiting and requires a keyframe based on the completed Group entry", () => {
    const { store, snapshot, event, initialization, fence, nodeId, transform } = groupSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
    store.applyState({
      stateFrame: {
        fence,
        frameSequence: "1",
        baseReliableSequence: "1",
        kind: 1,
        elements: [{ elementId: "intro-node", node: { opacity: 0 } }],
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().stateSequence).toBe("0");
    event(2, { groupEntered: { groupId: "next", groupEntryEpoch: "2", initialization } });
    event(3, {
      stepEntered: {
        groupId: "next",
        groupEntryEpoch: "2",
        stepId: "first",
        stepEntryEpoch: "2",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    const elements = ["next-node", nodeId].sort().map((elementId) => ({
      elementId,
      node: { active: true, visible: true, opacity: 0.2, transform },
    }));
    store.applyState({
      stateFrame: { fence, frameSequence: "2", baseReliableSequence: "0", kind: 1, elements },
    });
    expect(store.getSnapshot().stateSync).toBe("awaiting-keyframe");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
    store.applyState({
      stateFrame: { fence, frameSequence: "3", baseReliableSequence: "3", kind: 1, elements },
    });
    expect(store.getSnapshot().stateSync).toBe("ready");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBeCloseTo(0.2);
  });
  it("reinitializes a reentered Group instead of restoring its previous state", () => {
    const { store, snapshot, event, initialization, transform } = groupSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
    event(2, { groupEntered: { groupId: "next", groupEntryEpoch: "2", initialization } });
    event(3, {
      stepEntered: {
        groupId: "next",
        groupEntryEpoch: "2",
        stepId: "first",
        stepEntryEpoch: "2",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    event(4, { groupExited: { groupId: "next", groupEntryEpoch: "2" } });
    event(5, {
      groupEntered: {
        groupId: "intro",
        groupEntryEpoch: "3",
        initialization: {
          nodeStates: [
            { nodeId: "intro-node", active: true, visible: true, opacity: 0.6, transform },
          ],
          surfaceStates: [{ surfaceId: "intro-surface", stateId: "reference-surface:default" }],
        },
      },
    });
    event(6, {
      stepEntered: {
        groupId: "intro",
        groupEntryEpoch: "3",
        stepId: "start",
        stepEntryEpoch: "3",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    expect(store.getSnapshot().view!.progression.groupEntryEpoch).toBe(3);
    expect(store.getSnapshot().view!.nodeStates["intro-node"]!.opacity).toBeCloseTo(0.6);
    expect(store.getSnapshot().view!.nodeStates["next-node"]).toBeUndefined();
  });
});

describe("Group snapshot completeness", () => {
  it.each(["missing-current", "foreign-group", "transitioning"])("rejects %s snapshot", (kind) => {
    const { store, snapshot } = groupSetup();
    const view = snapshot.snapshot!.runtimeView!;
    if (kind === "missing-current")
      view.nodeStates = view.nodeStates!.filter((node) => node.nodeId !== "intro-node");
    if (kind === "foreign-group") view.nodeStates![0]!.nodeId = "next-node";
    if (kind === "transitioning")
      view.progression = { ...view.progression!, stable: undefined, transitioning: {} } as never;
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
    expect(store.getSnapshot().view).toBeNull();
  });
  it("accepts a Snapshot with no resources owned by its current Group", () => {
    const { store, snapshot } = groupSetup();
    snapshot.snapshot!.runtimeView!.progression!.currentGroupId = "empty";
    snapshot.snapshot!.runtimeView!.nodeStates = snapshot.snapshot!.runtimeView!.nodeStates!.filter(
      (node) => node.nodeId !== "intro-node",
    );
    snapshot.snapshot!.runtimeView!.surfaceStates =
      snapshot.snapshot!.runtimeView!.surfaceStates!.filter(
        (surface) => surface.surfaceId !== "intro-surface",
      );
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
  });
});

function animatedSetup() {
  const result = setup();
  const timelineId = result.delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.timelineId!;
  const runId = { assignmentEpoch: "1", runSequence: "1" };
  const started = {
    runId,
    timelineId,
    owner: { presentation: {} },
    cause: {
      cueId: "fade",
      causeEventId: "cause",
      groupId: "intro",
      groupEntryEpoch: "1",
      stepId: "start",
      stepEntryEpoch: "1",
    },
    completion: 2,
    startedAtRuntimeTimeMs: "10",
  };
  return { ...result, timelineId, runId, started };
}

describe("runtime animation runs", () => {
  it("accepts a timeline run and commits its final track values on completion", () => {
    const { store, snapshot, fence, started, runId, timelineId, nodeId } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(1);
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "end",
        occurredAtRuntimeTimeMs: "1010",
        timelineCompleted: { runId, timelineId },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(0);
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(0.5);
  });
  it("rejects a completion before its deadline", () => {
    const { store, snapshot, fence, started, runId, timelineId } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "end",
        occurredAtRuntimeTimeMs: "11",
        timelineCompleted: { runId, timelineId },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("rejects State writes to a property owned by an active timeline", () => {
    const { store, snapshot, fence, started, nodeId, transform } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyState({
      stateFrame: {
        fence,
        kind: 1,
        frameSequence: "1",
        baseReliableSequence: "1",
        elements: [
          { elementId: nodeId, node: { active: true, visible: true, opacity: 0.3, transform } },
        ],
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("accepts an active timeline in a mid-run snapshot", () => {
    const { store, snapshot, started } = animatedSetup();
    const { timelineId, ...run } = started;
    snapshot.snapshot!.runtimeView!.activeRuns = [{ ...run, timeline: { timelineId } }];
    snapshot.snapshot!.runtimeView!.clock!.runtimeTimeMs = "500";
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(1);
  });
  it("rejects a stale group owner epoch on a timeline", () => {
    const { store, snapshot, fence, started } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: {
          ...started,
          owner: { group: { groupId: "intro", groupEntryEpoch: "2" } },
        },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
});

describe("runtime animation lifecycle validation", () => {
  it("commits the interpolated current value on explicit timeline stop", () => {
    const { store, snapshot, fence, started, runId, timelineId, nodeId } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "stop",
        occurredAtRuntimeTimeMs: "510",
        timelineCanceled: { runId, timelineId, reason: 1 },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBeCloseTo(0.75);
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(0);
  });
  it("accepts a keyframe that omits the Timeline-owned property", () => {
    const { store, snapshot, fence, started, nodeId, transform } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyState({
      stateFrame: {
        fence,
        kind: 1,
        frameSequence: "1",
        baseReliableSequence: "1",
        elements: [{ elementId: nodeId, node: { active: true, visible: true, transform } }],
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().stateSync).toBe("ready");
  });
  it("does not commit Timeline values on presentation termination cancel", () => {
    const { store, snapshot, fence, started, runId, timelineId, nodeId } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "stop",
        occurredAtRuntimeTimeMs: "510",
        timelineCanceled: { runId, timelineId, reason: 3 },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
  });
  it("rejects reuse of an already completed Run ID", () => {
    const { store, snapshot, fence, started, runId, timelineId } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "stop",
        occurredAtRuntimeTimeMs: "1010",
        timelineCompleted: { runId, timelineId },
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "3",
        eventId: "reuse",
        occurredAtRuntimeTimeMs: "1020",
        timelineStarted: { ...started, startedAtRuntimeTimeMs: "1020" },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("applies a Surface crossfade start and completion", () => {
    const { delivery, snapshot, fence, started, runId, surfaceId } = animatedSetup();
    const definition = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!;
    const fromStateId = snapshot.snapshot!.runtimeView!.surfaceStates![0]!.stateId!;
    definition.reachableStateIds!.push("next");
    const store = createRuntimeStore(delivery);
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        surfaceTransitionStarted: {
          surfaceId,
          runId,
          fromStateId,
          stateId: "next",
          startedAtRuntimeTimeMs: "10",
          durationMs: "500",
          easing: 1,
          run: {
            runId,
            owner: started.owner,
            cause: started.cause,
            completion: 1,
            startedAtRuntimeTimeMs: "10",
            surfaceTransition: {
              surfaceId,
              fromStateId,
              toStateId: "next",
              durationMs: "500",
              easing: 1,
            },
          },
        },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.surfaceStates[surfaceId]!.stateId).toBe("next");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(1);
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "done",
        occurredAtRuntimeTimeMs: "510",
        surfaceTransitionCompleted: { surfaceId, runId, stateId: "next" },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(0);
    expect(store.getSnapshot().view!.surfaceStates[surfaceId]!.transitionRunId).toBeUndefined();
  });
});

describe("runtime animation snapshot invariants", () => {
  it("accepts blocking Timeline progression and releases it on completion", () => {
    const { store, snapshot, started, fence, runId, timelineId } = animatedSetup();
    const view = snapshot.snapshot!.runtimeView!;
    const { timelineId: _id, ...run } = started;
    view.activeRuns = [{ ...run, completion: 1, timeline: { timelineId } }];
    view.clock!.runtimeTimeMs = "500";
    const { stable: _stable, ...progression } = view.progression!;
    view.progression = {
      ...progression,
      transitioning: { blockingRunIds: [runId], pendingNext: { stay: {} } },
    };
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.progression.phase.kind).toBe("transitioning");
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "end",
        occurredAtRuntimeTimeMs: "1010",
        timelineCompleted: { runId, timelineId },
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.progression.phase.kind).toBe("stable");
  });
  it("rejects blocking progression that references a nonexistent Run", () => {
    const { store, snapshot, runId } = animatedSetup();
    const view = snapshot.snapshot!.runtimeView!;
    const { stable: _stable, ...progression } = view.progression!;
    view.progression = {
      ...progression,
      transitioning: { blockingRunIds: [runId], pendingNext: { stay: {} } },
    };
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("rejects concurrent Timeline claims on the same property", () => {
    const { store, snapshot, fence, started } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "2",
        eventId: "conflict",
        occurredAtRuntimeTimeMs: "20",
        timelineStarted: {
          ...started,
          runId: { assignmentEpoch: "1", runSequence: "2" },
          startedAtRuntimeTimeMs: "20",
        },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("rejects a Surface transition with no matching active run", () => {
    const { store, snapshot, runId } = animatedSetup();
    snapshot.snapshot!.runtimeView!.surfaceStates![0]!.transitionRunId = runId;
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it("rejects an assignment mismatch in Run ID", () => {
    const { store, snapshot, fence, started } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: { ...started, runId: { assignmentEpoch: "2", runSequence: "1" } },
      },
    });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
});

describe("runtime animation State dependency", () => {
  it("discards a State keyframe sampled before Timeline start without losing the control view", () => {
    const { store, snapshot, fence, started, nodeId, transform } = animatedSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    store.applyControl({
      reliableEvent: {
        fence,
        sequence: "1",
        eventId: "start",
        occurredAtRuntimeTimeMs: "10",
        timelineStarted: started,
      },
    });
    store.applyState({
      stateFrame: {
        fence,
        kind: 1,
        frameSequence: "1",
        baseReliableSequence: "0",
        elements: [
          { elementId: nodeId, node: { active: true, visible: true, opacity: 0.3, transform } },
        ],
      },
    });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().stateSync).toBe("awaiting-keyframe");
    expect(store.getSnapshot().view!.activeRuns).toHaveLength(1);
    expect(store.getSnapshot().view!.nodeStates[nodeId]!.opacity).toBe(1);
  });
});

function variableSetup() {
  const initial = setup();
  initial.delivery.projectionProfile!.runtimeCatalog!.variables = [
    { variableId: "global", type: 1, owner: { presentation: {} } },
    { variableId: "local", type: 2, owner: { group: { groupId: "intro" } } },
    { variableId: "next-local", type: 3, owner: { group: { groupId: "next" } } },
    { variableId: "nullable", type: 4, owner: { presentation: {} } },
  ];
  initial.snapshot.snapshot!.runtimeView!.variables = [
    { variableId: "global", value: { stringValue: "initial" } },
    { variableId: "local", value: { numberValue: 1 } },
    { variableId: "nullable", value: { nullValue: {} } },
  ];
  const store = createRuntimeStore(initial.delivery);
  const event = (sequence: number, payload: object) =>
    store.applyControl({
      reliableEvent: {
        fence: initial.fence,
        sequence: String(sequence),
        eventId: `variable-${sequence}`,
        occurredAtRuntimeTimeMs: "10",
        ...payload,
      },
    } as never);
  return { ...initial, store, event };
}

describe("runtime variable ownership and types", () => {
  it.each(["duplicate", "unspecified-type", "unknown-type", "missing-owner"])(
    "rejects %s variable catalog definitions",
    (kind) => {
      const { delivery, snapshot } = variableSetup();
      const definitions = delivery.projectionProfile!.runtimeCatalog!.variables!;
      if (kind === "duplicate") definitions.push(structuredClone(definitions[0]!));
      if (kind === "unspecified-type") delete definitions[2]!.type;
      if (kind === "unknown-type") definitions[2]!.type = 99;
      if (kind === "missing-owner") delete definitions[2]!.owner;
      if (kind === "unknown-type") {
        expect(() => createRuntimeStore(delivery)).toThrow();
        return;
      }
      const store = createRuntimeStore(delivery);
      store.applyControl({ connectionSnapshot: snapshot });
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
  it.each([
    ["global", { nullValue: {} }],
    ["nullable", { stringValue: "null" }],
    ["local", { booleanValue: true }],
  ])("rejects mismatched scalar type for %s", (variableId, value) => {
    const { store, snapshot, event } = variableSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, { variableChanged: { state: { variableId, value } } });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });

  it("accepts typed presentation and current Group variables and applies VariableChanged", () => {
    const { store, snapshot, event } = variableSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.variables).toEqual({
      global: "initial",
      local: 1,
      nullable: null,
    });
    event(1, { variableChanged: { state: { variableId: "local", value: { numberValue: 0 } } } });
    event(2, { variableChanged: { state: { variableId: "global", value: { stringValue: "" } } } });
    expect(store.getSnapshot().view!.variables).toEqual({ global: "", local: 0, nullable: null });
  });
  it.each([
    "missing",
    "unknown",
    "foreign",
    "duplicate",
    "wrong-type",
    "missing-value",
    "unsorted",
  ])("rejects %s Snapshot variables", (kind) => {
    const { store, snapshot } = variableSetup();
    const variables = snapshot.snapshot!.runtimeView!.variables!;
    if (kind === "missing") variables.pop();
    if (kind === "unknown") variables[1]!.variableId = "unknown";
    if (kind === "foreign")
      variables[1] = { variableId: "next-local", value: { booleanValue: false } };
    if (kind === "duplicate") variables[1] = structuredClone(variables[0]!);
    if (kind === "wrong-type") variables[1]!.value = { stringValue: "1" };
    if (kind === "missing-value") delete variables[1]!.value;
    if (kind === "unsorted") variables.reverse();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("resync-required");
  });
  it.each(["unknown", "foreign", "wrong-type", "missing-state", "missing-value", "not-finite"])(
    "rejects %s VariableChanged",
    (kind) => {
      const { store, snapshot, event } = variableSetup();
      store.applyControl({ connectionSnapshot: snapshot });
      const change: { state?: { variableId: string; value?: object } } = {
        state: { variableId: "local", value: { numberValue: 2 } },
      };
      if (kind === "unknown") change.state!.variableId = "unknown";
      if (kind === "foreign")
        change.state = { variableId: "next-local", value: { booleanValue: true } };
      if (kind === "wrong-type") change.state!.value = { booleanValue: false };
      if (kind === "missing-state") delete change.state;
      if (kind === "missing-value") delete change.state!.value;
      if (kind === "not-finite") change.state!.value = { numberValue: Infinity };
      event(1, { variableChanged: change });
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
  it("drops Group variables on exit, initializes the next Group and reinitializes on reentry", () => {
    const { store, snapshot, event } = variableSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    event(1, {
      variableChanged: { state: { variableId: "global", value: { stringValue: "preserved" } } },
    });
    event(2, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
    event(3, {
      groupEntered: {
        groupId: "next",
        groupEntryEpoch: "2",
        initialization: {
          variables: [{ variableId: "next-local", value: { booleanValue: false } }],
        },
      },
    });
    event(4, {
      stepEntered: {
        groupId: "next",
        groupEntryEpoch: "2",
        stepId: "next-step",
        stepEntryEpoch: "2",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    expect(store.getSnapshot().view!.variables).toEqual({
      global: "preserved",
      "next-local": false,
      nullable: null,
    });
    event(5, { groupExited: { groupId: "next", groupEntryEpoch: "2" } });
    event(6, {
      groupEntered: {
        groupId: "intro",
        groupEntryEpoch: "3",
        initialization: { variables: [{ variableId: "local", value: { numberValue: 100 } }] },
      },
    });
    event(7, {
      stepEntered: {
        groupId: "intro",
        groupEntryEpoch: "3",
        stepId: "start",
        stepEntryEpoch: "3",
        enteredAtRuntimeTimeMs: "10",
      },
    });
    expect(store.getSnapshot().view!.variables).toEqual({
      global: "preserved",
      local: 100,
      nullable: null,
    });
  });
  it.each(["missing", "presentation", "foreign", "duplicate", "wrong-type"])(
    "rejects %s Group initialization variables",
    (kind) => {
      const { store, snapshot, event } = variableSetup();
      store.applyControl({ connectionSnapshot: snapshot });
      event(1, { groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
      let variables: object[] = [{ variableId: "next-local", value: { booleanValue: true } }];
      if (kind === "missing") variables = [];
      if (kind === "presentation")
        variables = [{ variableId: "global", value: { stringValue: "overwritten" } }];
      if (kind === "foreign") variables = [{ variableId: "local", value: { numberValue: 1 } }];
      if (kind === "duplicate") variables.push(variables[0]!);
      if (kind === "wrong-type")
        variables = [{ variableId: "next-local", value: { numberValue: 1 } }];
      event(2, {
        groupEntered: { groupId: "next", groupEntryEpoch: "2", initialization: { variables } },
      });
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
});

describe("Audience Viewer boundary", () => {
  it("rejects Presenter, unspecified and unknown projection roles", () => {
    const { delivery } = setup();
    for (const role of [0, 1, 3]) {
      delivery.projectionProfile!.key!.role = role;
      expect(() => createRuntimeStore(delivery)).toThrow();
    }
    delete delivery.projectionProfile!.key!.role;
    expect(() => createRuntimeStore(delivery)).toThrow();
  });
  it("rejects a Viewer snapshot that advertises progress inputs", () => {
    const { store, snapshot } = setup();
    snapshot.snapshot!.runtimeView!.enabledLogicalInputs = ["next"];
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot()).toMatchObject({ phase: "resync-required", view: null });
  });
});

function mediaSetup() {
  const base = setup();
  const catalog = base.delivery.projectionProfile!.runtimeCatalog!;
  catalog.surfaces![0]!.hasVideo = true;
  const owner = catalog.nodes![0]!.owner!;
  catalog.nodes!.push({
    nodeId: "model",
    parent: { stage: {} },
    owner,
    model: { modelAssetId: "model-asset" },
  });
  catalog.modelClips = [
    {
      modelNodeId: "model",
      modelAssetId: "model-asset",
      clipId: "a",
      sourceAnimationIndex: 0,
      durationMs: "1000",
      owner,
    },
    {
      modelNodeId: "model",
      modelAssetId: "model-asset",
      clipId: "b",
      sourceAnimationIndex: 1,
      durationMs: "2000",
      owner,
    },
  ];
  catalog.nodes!.sort((a, b) => (a.nodeId! < b.nodeId! ? -1 : 1));
  const view = base.snapshot.snapshot!.runtimeView!;
  view.nodeStates!.push({
    nodeId: "model",
    active: true,
    visible: true,
    opacity: 1,
    transform: base.transform,
  });
  view.nodeStates!.sort((a, b) => (a.nodeId! < b.nodeId! ? -1 : 1));
  view.mediaStates = [{ surfaceId: base.surfaceId, stopped: { heldPositionMs: 0 } }];
  view.modelClipStates = [{ modelNodeId: "model", defaultPose: {} }];
  const store = createRuntimeStore(base.delivery);
  let sequence = 0;
  const send = (payload: object, time: number) =>
    store.applyControl({
      reliableEvent: {
        fence: base.fence,
        sequence: String(++sequence),
        eventId: `event-${sequence}`,
        occurredAtRuntimeTimeMs: String(time),
        ...payload,
      },
    } as ControlServerItemWire);
  const run = (sequence: number, time: number): RuntimeRunSnapshotWire =>
    ({
      runId: { assignmentEpoch: "1", runSequence: String(sequence) },
      owner,
      cause: {
        cueId: "cue",
        causeEventId: "event",
        groupId: "intro",
        groupEntryEpoch: "1",
        stepId: "start",
        stepEntryEpoch: "1",
      },
      completion: 2,
      startedAtRuntimeTimeMs: String(time),
    }) as RuntimeRunSnapshotWire;
  return { ...base, store, view, send, run };
}

describe("media and model runtime", () => {
  it("applies video play, pause, seek, resume and completion without changing the run identity", () => {
    const { store, snapshot, surfaceId, send, run } = mediaSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    const id = { assignmentEpoch: "1", runSequence: "1" };
    const initial = {
      ...run(1, 100),
      media: { surfaceId, playback: { playing: { referenceRuntimeTimeMs: "100" } } },
    } as RuntimeRunSnapshotWire;
    send(
      { mediaStarted: { runId: id, surfaceId, playback: initial.media!.playback, run: initial } },
      100,
    );
    expect(store.getSnapshot().view!.mediaStates[surfaceId]).toMatchObject({
      kind: "active",
      runId: { runSequence: 1 },
    });
    const paused = {
      ...initial,
      media: { surfaceId, playback: { paused: { positionMs: 50 } } },
    } as RuntimeRunSnapshotWire;
    send({ mediaPaused: { runId: id, surfaceId, positionMs: 50, run: paused } }, 150);
    expect(store.getSnapshot().view!.mediaStates[surfaceId]).toMatchObject({
      playback: { kind: "paused", positionMilliseconds: 50 },
    });
    const seeked = {
      ...initial,
      media: { surfaceId, playback: { paused: { positionMs: 400 } } },
    } as RuntimeRunSnapshotWire;
    send(
      { mediaSeeked: { runId: id, surfaceId, playback: seeked.media!.playback, run: seeked } },
      160,
    );
    const resumed = {
      ...initial,
      media: {
        surfaceId,
        playback: { playing: { positionAtReferenceMs: 400, referenceRuntimeTimeMs: "200" } },
      },
    } as RuntimeRunSnapshotWire;
    send(
      {
        mediaResumed: {
          runId: id,
          surfaceId,
          playback: resumed.media!.playback!.playing,
          run: resumed,
        },
      },
      200,
    );
    send({ mediaCompleted: { runId: id, surfaceId, heldPositionMs: 1000 } }, 800);
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.mediaStates[surfaceId]).toEqual({
      kind: "stopped",
      heldPositionMilliseconds: 0,
    });
    expect(store.getSnapshot().view!.activeRuns).toEqual([]);
    send({ mediaStoppedSeeked: { surfaceId, heldPositionMs: 200 } }, 810);
    expect(store.getSnapshot().view!.mediaStates[surfaceId]).toEqual({
      kind: "stopped",
      heldPositionMilliseconds: 200,
    });
  });
  it("accepts a late-join snapshot with playing video and paused model clip", () => {
    const { store, snapshot, view, surfaceId, run } = mediaSetup();
    const media = {
      ...run(1, 0),
      media: {
        surfaceId,
        playback: { playing: { referenceRuntimeTimeMs: "20", positionAtReferenceMs: 30 } },
      },
    } as RuntimeRunSnapshotWire;
    const model = {
      ...run(2, 0),
      modelClip: {
        modelNodeId: "model",
        single: { clipId: "a", speed: 2, playback: { paused: { positionMs: 400 } } },
      },
    } as RuntimeRunSnapshotWire;
    view.clock!.runtimeTimeMs = "500";
    view.activeRuns = [media, model];
    view.mediaStates = [
      { surfaceId, active: { runId: media.runId!, playback: media.media!.playback! } },
    ];
    view.modelClipStates = [{ modelNodeId: "model", active: { runId: model.runId! } }];
    store.applyControl({ connectionSnapshot: snapshot });
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.activeRuns[1]).toMatchObject({
      kind: "modelClip",
      phase: {
        kind: "single",
        clip: { speed: 2, playback: { kind: "paused", positionMilliseconds: 400 } },
      },
    });
  });
  it("applies model play, pause/resume, crossfade, held pose and cancellation", () => {
    const { store, snapshot, send, run } = mediaSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    const modelNodeId = "model";
    const initial = {
      ...run(1, 100),
      modelClip: {
        modelNodeId,
        single: { clipId: "a", speed: 1, playback: { playing: { referenceRuntimeTimeMs: "100" } } },
      },
    } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipStarted: {
          runId: initial.runId,
          modelNodeId,
          playback: initial.modelClip!.single,
          run: initial,
        },
      },
      100,
    );
    const paused = {
      ...initial,
      modelClip: {
        modelNodeId,
        single: { clipId: "a", speed: 1, playback: { paused: { positionMs: 50 } } },
      },
    } as RuntimeRunSnapshotWire;
    send({ modelClipPaused: { runId: initial.runId, modelNodeId, run: paused } }, 150);
    const resumed = {
      ...initial,
      modelClip: {
        modelNodeId,
        single: {
          clipId: "a",
          speed: 1,
          playback: { playing: { referenceRuntimeTimeMs: "200", positionAtReferenceMs: 50 } },
        },
      },
    } as RuntimeRunSnapshotWire;
    send({ modelClipResumed: { runId: initial.runId, modelNodeId, run: resumed } }, 200);
    const fade = {
      ...run(2, 300),
      modelClip: {
        modelNodeId,
        crossfade: {
          from: resumed.modelClip!.single!,
          to: { clipId: "b", speed: 1, playback: { playing: { referenceRuntimeTimeMs: "300" } } },
          transitionClock: { playing: { referenceRuntimeTimeMs: "300" } },
          durationMs: "200",
          easing: 1,
        },
      },
    } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipCrossfadeStarted: {
          runId: fade.runId,
          modelNodeId,
          crossfade: fade.modelClip!.crossfade,
          run: fade,
        },
      },
      300,
    );
    expect(store.getSnapshot().view!.activeRuns[0]).toMatchObject({
      kind: "modelClip",
      phase: { kind: "crossfade" },
    });
    const single = {
      ...fade,
      modelClip: { modelNodeId, single: fade.modelClip!.crossfade!.to! },
    } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipCrossfadeCompleted: {
          runId: fade.runId,
          modelNodeId,
          playback: single.modelClip!.single,
          run: single,
        },
      },
      500,
    );
    send(
      {
        modelClipStopped: {
          runId: fade.runId,
          modelNodeId,
          clip: { clipId: "b", positionMs: 300 },
        },
      },
      600,
    );
    expect(store.getSnapshot().view!.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "b", positionMilliseconds: 300 },
    });
    const next = { ...run(3, 700), modelClip: initial.modelClip } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipStarted: {
          runId: next.runId,
          modelNodeId,
          playback: next.modelClip!.single,
          run: next,
        },
      },
      700,
    );
    send({ modelClipCanceled: { runId: next.runId, modelNodeId, reason: 2 } }, 800);
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.modelClipStates.model).toEqual({ kind: "defaultPose" });
  });
  it("retains a held blend on stop and a final clip on completion", () => {
    const { store, snapshot, send, run } = mediaSetup();
    store.applyControl({ connectionSnapshot: snapshot });
    const initial = {
      ...run(1, 0),
      modelClip: {
        modelNodeId: "model",
        single: { clipId: "a", speed: 1, playback: { playing: {} } },
      },
    } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipStarted: {
          runId: initial.runId,
          modelNodeId: "model",
          playback: initial.modelClip!.single,
          run: initial,
        },
      },
      0,
    );
    send(
      {
        modelClipStopped: {
          runId: initial.runId,
          modelNodeId: "model",
          blend: {
            from: { clipId: "a", positionMs: 100 },
            to: { clipId: "b", positionMs: 200 },
            toWeight: 0.3,
          },
        },
      },
      200,
    );
    expect(store.getSnapshot().view!.modelClipStates.model).toMatchObject({
      kind: "heldBlend",
      toWeight: 0.3,
    });
    const next = {
      ...run(2, 300),
      modelClip: {
        modelNodeId: "model",
        single: { clipId: "b", speed: 2, playback: { playing: { referenceRuntimeTimeMs: "300" } } },
      },
    } as RuntimeRunSnapshotWire;
    send(
      {
        modelClipStarted: {
          runId: next.runId,
          modelNodeId: "model",
          playback: next.modelClip!.single,
          run: next,
        },
      },
      300,
    );
    send(
      {
        modelClipCompleted: {
          runId: next.runId,
          modelNodeId: "model",
          heldPose: { clipId: "b", positionMs: 2000 },
        },
      },
      1300,
    );
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().view!.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "b", positionMilliseconds: 2000 },
    });
  });
  it.each(["identity", "paused", "reference"])(
    "rejects a malformed %s media update without rendering it",
    (kind) => {
      const { store, snapshot, send, run, surfaceId } = mediaSetup();
      store.applyControl({ connectionSnapshot: snapshot });
      const initial = {
        ...run(1, 0),
        media: { surfaceId, playback: { playing: {} } },
      } as RuntimeRunSnapshotWire;
      send(
        {
          mediaStarted: {
            runId: initial.runId,
            surfaceId,
            playback: initial.media!.playback,
            run: initial,
          },
        },
        0,
      );
      const next = {
        ...initial,
        completion: kind === "identity" ? 1 : 2,
        media: {
          surfaceId,
          playback: kind === "paused" ? { playing: {} } : { paused: { positionMs: 50 } },
        },
      } as RuntimeRunSnapshotWire;
      if (kind === "reference") {
        const future = {
          ...initial,
          media: { surfaceId, playback: { playing: { referenceRuntimeTimeMs: "500" } } },
        } as RuntimeRunSnapshotWire;
        send(
          {
            mediaSeeked: {
              runId: initial.runId,
              surfaceId,
              playback: future.media!.playback,
              run: future,
            },
          },
          100,
        );
      } else
        send({ mediaPaused: { runId: initial.runId, surfaceId, positionMs: 50, run: next } }, 100);
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
  it.each(["missing", "foreign", "clock", "run", "unknown-clip"])(
    "rejects an inconsistent %s media/model snapshot",
    (kind) => {
      const { store, snapshot, view, surfaceId, run } = mediaSetup();
      if (kind === "missing") view.mediaStates = [];
      if (kind === "foreign") view.modelClipStates = [{ modelNodeId: "foreign", defaultPose: {} }];
      if (kind === "clock" || kind === "run") {
        const media = {
          ...run(1, 0),
          media: {
            surfaceId,
            playback: { playing: { referenceRuntimeTimeMs: kind === "clock" ? "100" : "0" } },
          },
        } as RuntimeRunSnapshotWire;
        view.activeRuns = kind === "run" ? [] : [media];
        view.mediaStates = [
          { surfaceId, active: { runId: media.runId!, playback: media.media!.playback! } },
        ];
      }
      if (kind === "unknown-clip")
        view.modelClipStates = [
          { modelNodeId: "model", heldClip: { clipId: "unknown", positionMs: 0 } },
        ];
      store.applyControl({ connectionSnapshot: snapshot });
      expect(store.getSnapshot().phase).toBe("resync-required");
    },
  );
});

it("restores stopped video and a held model pose from a replacement view", () => {
  const { store, snapshot, view, surfaceId, send } = mediaSetup();
  store.applyControl({ connectionSnapshot: snapshot });
  const replacement = structuredClone(view);
  replacement.baseReliableSequence = "1";
  replacement.clock!.runtimeTimeMs = "100";
  replacement.mediaStates = [{ surfaceId, stopped: { heldPositionMs: 250 } }];
  replacement.modelClipStates = [
    { modelNodeId: "model", heldClip: { clipId: "a", positionMs: 400 } },
  ];
  send({ runtimeViewReplaced: { runtimeView: replacement } }, 100);
  expect(store.getSnapshot().phase).toBe("ready");
  expect(store.getSnapshot().view!.mediaStates[surfaceId]).toEqual({
    kind: "stopped",
    heldPositionMilliseconds: 250,
  });
  expect(store.getSnapshot().view!.modelClipStates.model).toEqual({
    kind: "heldClip",
    clip: { clipId: "a", positionMilliseconds: 400 },
  });
});
