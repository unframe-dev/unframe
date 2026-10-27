import { describe, expect, it } from "vitest";
import {
  decodeWireMessage,
  encodeWireMessage,
  type ParticipantRuntimeViewWire,
} from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { toParticipantView } from "../wire-view";

function wireFixture(): ParticipantRuntimeViewWire {
  return {
    projectionProfileId: fixture.projectionProfileId,
    assignmentEpoch: "1",
    progression: {
      currentGroupId: "intro",
      groupEntryEpoch: "1",
      currentStepId: "start",
      stepEntryEpoch: "1",
      stable: {},
    },
    nodeStates: Object.entries(fixture.nodeStates).map(([nodeId, state]) => ({
      nodeId,
      ...state,
      transform: { position: {}, rotation: { w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    })),
    surfaceStates: Object.entries(fixture.surfaceStates).map(([surfaceId, state]) => ({
      surfaceId,
      ...state,
    })),
    variables: [{ variableId: "counter", value: { numberValue: 0 } }],
    clock: { running: {} },
    presentationOrigin: { pose: { position: {}, rotation: { w: 1 } } },
    enabledLogicalInputs: ["next"],
  };
}

describe("participant wire view adapter", () => {
  it("converts a protobuf round-trip with omitted zero defaults to the existing runtime schema", () => {
    const type = "unframe.realtime.ParticipantRuntimeView";
    const value = decodeWireMessage(
      type,
      encodeWireMessage(type, wireFixture()),
    ) as ParticipantRuntimeViewWire;
    expect(toParticipantView(value)).toEqual(fixture);
  });
  it("preserves transforms, scalar primitives and disabled node flags", () => {
    const value = wireFixture();
    value.nodeStates![0] = {
      nodeId: "model",
      transform: {
        position: { x: 2, y: -1 },
        rotation: { z: 0.6, w: 0.8 },
        scale: { x: 2, y: 3, z: 4 },
      },
    };
    value.variables = [
      { variableId: "n", value: { nullValue: {} } },
      { variableId: "b", value: { booleanValue: false } },
      { variableId: "s", value: { stringValue: "" } },
    ];
    const view = toParticipantView(value);
    expect(view.nodeStates["model"]).toEqual({
      active: false,
      visible: false,
      opacity: 0,
      transform: { position: [2, -1, 0], rotation: [0, 0, 0.6, 0.8], scale: [2, 3, 4] },
    });
    expect(view.variables).toEqual({ n: null, b: false, s: "" });
  });
  it("validates safe unsigned integer strings before conversion", () => {
    for (const invalid of ["9007199254740992", "-1", "01", "1.1", "NaN"]) {
      expect(() =>
        toParticipantView({ ...wireFixture(), baseReliableSequence: invalid }),
      ).toThrow();
    }
    expect(
      toParticipantView({ ...wireFixture(), baseReliableSequence: "9007199254740991" })
        .baseReliableSequence,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects duplicate resources and malformed poses", () => {
    const value = wireFixture();
    for (const field of ["nodeStates", "surfaceStates", "variables"] as const) {
      const duplicate = structuredClone(value);
      (duplicate[field] as unknown[]).push(duplicate[field]![0]);
      expect(() => toParticipantView(duplicate)).toThrow(/duplicate/);
    }
    for (const rotation of [{ w: 2 }, { w: -1 }, {}, { x: -1 }]) {
      expect(() =>
        toParticipantView({ ...value, presentationOrigin: { pose: { position: {}, rotation } } }),
      ).toThrow();
    }
    value.nodeStates![0]!.transform!.scale = {};
    expect(() => toParticipantView(value)).toThrow();
  });
  it("converts animation runs, transition references and projected progression", () => {
    const value = wireFixture();
    const runId = { assignmentEpoch: "1", runSequence: "2" };
    value.activeRuns = [
      {
        runId,
        owner: { group: { groupId: "intro", groupEntryEpoch: "1" } },
        cause: {
          cueId: "cue",
          causeEventId: "event",
          groupId: "intro",
          groupEntryEpoch: "1",
          stepId: "start",
          stepEntryEpoch: "1",
        },
        completion: 1,
        startedAtRuntimeTimeMs: "100",
        timeline: { timelineId: "move" },
      },
    ];
    value.progression = {
      currentGroupId: "intro",
      groupEntryEpoch: "1",
      currentStepId: "start",
      stepEntryEpoch: "1",
      transitioning: { blockingRunIds: [runId], pendingNext: { step: { stepId: "finish" } } },
    };
    value.surfaceStates![0]!.transitionRunId = runId;
    const converted = toParticipantView(value);
    expect(converted.activeRuns[0]).toMatchObject({
      kind: "timeline",
      timelineId: "move",
      completion: "blocking",
      startedAtRuntimeTimeMilliseconds: 100,
      runId: { assignmentEpoch: 1, runSequence: 2 },
      owner: { kind: "group", groupId: "intro", groupEntryEpoch: 1 },
    });
    expect(converted.progression.phase).toEqual({
      kind: "transitioning",
      blockingRunIds: [{ assignmentEpoch: 1, runSequence: 2 }],
      pendingNext: { kind: "step", stepId: "finish" },
    });
    expect(Object.values(converted.surfaceStates)[0]!.transitionRunId).toEqual({
      assignmentEpoch: 1,
      runSequence: 2,
    });
    const original = value.activeRuns![0]!;
    const runBase = {
      runId: original.runId!,
      owner: original.owner!,
      cause: original.cause!,
      completion: original.completion!,
      startedAtRuntimeTimeMs: original.startedAtRuntimeTimeMs!,
    };
    value.activeRuns![0] = {
      ...runBase,
      surfaceTransition: {
        surfaceId: "surface",
        fromStateId: "a",
        toStateId: "b",
        durationMs: "500",
        easing: 4,
      },
    };
    expect(toParticipantView(value).activeRuns[0]).toMatchObject({
      kind: "surfaceTransition",
      easing: "cubicInOut",
      durationMilliseconds: 500,
    });
  });
  it("converts media clocks and model single/crossfade snapshots without losing held poses", () => {
    const value = wireFixture();
    const runId = { assignmentEpoch: "1", runSequence: "1" };
    const playback = { playing: { positionAtReferenceMs: 20, referenceRuntimeTimeMs: "100" } };
    value.mediaStates = [
      { surfaceId: "video", active: { runId, playback } },
      { surfaceId: "stop", stopped: {} },
    ];
    value.modelClipStates = [
      {
        modelNodeId: "model",
        heldBlend: {
          from: { clipId: "a", positionMs: 10 },
          to: { clipId: "b", positionMs: 30 },
          toWeight: 0.4,
        },
      },
    ];
    value.activeRuns = [
      {
        runId,
        owner: { presentation: {} },
        cause: {
          cueId: "cue",
          causeEventId: "event",
          groupId: "intro",
          groupEntryEpoch: "1",
          stepId: "start",
          stepEntryEpoch: "1",
        },
        completion: 2,
        media: { surfaceId: "video", playback },
      },
    ];
    const result = toParticipantView(value);
    expect(result.mediaStates.video).toMatchObject({
      kind: "active",
      playback: {
        kind: "playing",
        positionAtReferenceMilliseconds: 20,
        referenceRuntimeTimeMilliseconds: 100,
      },
    });
    expect(result.mediaStates.stop).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
    expect(result.modelClipStates.model).toMatchObject({
      kind: "heldBlend",
      toWeight: 0.4,
      from: { clipId: "a", positionMilliseconds: 10 },
    });
    expect(result.activeRuns[0]).toMatchObject({ kind: "media", surfaceId: "video" });
  });
  it("rejects unsupported media and malformed animation variants", () => {
    const value = wireFixture();
    for (const field of ["activeRuns", "mediaStates", "modelClipStates"] as const) {
      expect(() =>
        toParticipantView({ ...value, [field]: [{}] } as ParticipantRuntimeViewWire),
      ).toThrow();
    }
    value.progression = {
      currentGroupId: "intro",
      groupEntryEpoch: "1",
      currentStepId: "start",
      stepEntryEpoch: "1",
      transitioning: {},
    };
    expect(() => toParticipantView(value)).toThrow();
  });
  it("accepts known lifecycle reasons and rejects unknown or absent reasons", () => {
    for (let reason = 1; reason <= 9; reason++) {
      expect(
        toParticipantView({ ...wireFixture(), clock: { paused: { reason } } }).clock.lifecycle.kind,
      ).toBe("paused");
    }
    for (let reason = 1; reason <= 3; reason++) {
      expect(
        toParticipantView({ ...wireFixture(), clock: { terminating: { reason } } }).clock.lifecycle
          .kind,
      ).toBe("terminating");
    }
    for (const clock of [
      { paused: {} },
      { paused: { reason: 10 } },
      { terminating: { reason: 4 } },
    ]) {
      expect(() => toParticipantView({ ...wireFixture(), clock })).toThrow();
    }
  });
});
