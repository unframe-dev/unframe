import { describe, expect, it } from "vitest";
import {
  m3dCueRuntimeSnapshotV2Schema,
  type PresentationDefinitionV2,
} from "@unframe/contracts/presentation/v2";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import snapshotFixture from "../../contracts/presentation/v2/fixtures/m3d-cue-runtime-snapshot.json";
import invalidSnapshotFixture from "../../contracts/presentation/v2/fixtures/m3d-cue-runtime-snapshot.invalid.json";
import visibilityFixture from "../../contracts/presentation/v2/fixtures/runtime-visibility-selection.json";
import {
  createM3dCueRuntimeSnapshot,
  createRuntimeVisibilitySelection,
  projectM3dCueParticipantRuntimeView,
  validateM3dCueRuntimeSnapshot,
  validateRuntimeVisibilitySelection,
} from "../src/runtime/projection.js";
import { createCueState } from "../src/runtime/cue-executor.js";

const definition = structuredClone(definitionFixture) as unknown as PresentationDefinitionV2;
const snapshot = m3dCueRuntimeSnapshotV2Schema.parse(snapshotFixture);

describe("M3D Runtime projection and canonical snapshot", () => {
  it("creates a validated portable snapshot from CueState", () => {
    const state = createCueState(definition, 1);
    const generated = createM3dCueRuntimeSnapshot(definition, state, {
      reliableSequence: 0,
      lastIngressSequence: 0,
      lifecycle: { kind: "running" },
      presentationOrigin: snapshot.presentationOrigin,
      recentEventIds: [],
    });
    expect(generated).toEqual(snapshot);
  });

  it("accepts the portable snapshot and rejects inactive or unknown resources", () => {
    expect(validateM3dCueRuntimeSnapshot(definition, snapshot, 1)).toEqual([]);
    expect(validateRuntimeVisibilitySelection(definition, visibilityFixture)).toEqual([]);
    expect(validateM3dCueRuntimeSnapshot(definition, invalidSnapshotFixture, 1)).toContain(
      "nodeStates differs from the active resource set.",
    );
  });

  it("rejects expired timers", () => {
    const invalid = structuredClone(snapshot);
    invalid.stepExecution.timerStates = {
      delayed: { kind: "armed", dueAtRuntimeTimeMilliseconds: 0 },
    } as typeof invalid.stepExecution.timerStates;
    expect(validateM3dCueRuntimeSnapshot(definition, invalid, 1)).toContain(
      "Snapshot contains an expired armed Timer.",
    );
  });

  it("requires Surface transition state to reference its active Run", () => {
    const secondStateDefinition = structuredClone(definition);
    secondStateDefinition.scene.surfaces.baked!.states.next = {
      ...structuredClone(secondStateDefinition.scene.surfaces.baked!.states.default!),
      id: "next",
    };
    const running = structuredClone(snapshot);
    running.lastAllocatedRunSequence = 1;
    running.activeRuns = [
      {
        kind: "surfaceTransition",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        owner: { kind: "presentation" },
        cause: {
          cueId: "wave",
          causeEventId: "event-1",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "start",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 0,
        completion: "blocking",
        surfaceId: "baked",
        fromStateId: "default",
        toStateId: "next",
        durationMilliseconds: 100,
        easing: "linear",
      },
    ];
    running.surfaceStates.baked!.stateId = "next";
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "surfaceStates.baked is missing its transition Run ID.",
    );
    running.surfaceStates.baked!.transitionRunId = { assignmentEpoch: 1, runSequence: 1 };
    running.progression.phase = {
      kind: "transitioning",
      cueId: "wave",
      causeEventId: "event-1",
      stepEntryEpoch: 1,
      blockingRunIds: [{ assignmentEpoch: 1, runSequence: 1 }],
      pendingNext: { kind: "stay" },
    };
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toEqual([]);
    const active = running.activeRuns[0]!;
    if (active.kind !== "surfaceTransition") throw new TypeError("Expected a Surface Run.");
    active.toStateId = "default";
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "surfaceStates.baked differs from its transition target State.",
    );
    active.toStateId = "next";
    active.fromStateId = "missing";
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "Surface Runtime Run references an unknown State.",
    );
    active.fromStateId = "default";
    active.toStateId = "default";
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "Surface Runtime Run must change State.",
    );
    active.toStateId = "next";
    running.clock.runtimeTimeMilliseconds = 100;
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "Runtime Run deadline has passed.",
    );
    running.clock.runtimeTimeMilliseconds = 0;
    const state = createCueState(secondStateDefinition, 1);
    state.lastRunSequence = 1;
    state.activeRuns = structuredClone(running.activeRuns);
    state.phase = structuredClone(running.progression.phase);
    state.surfaces.baked = "next";
    const generated = createM3dCueRuntimeSnapshot(secondStateDefinition, state, {
      reliableSequence: 0,
      lastIngressSequence: 0,
      lifecycle: { kind: "running" },
      presentationOrigin: snapshot.presentationOrigin,
      recentEventIds: [],
    });
    expect(generated.surfaceStates.baked?.transitionRunId).toEqual({
      assignmentEpoch: 1,
      runSequence: 1,
    });
    running.activeRuns[0]!.owner = { kind: "group", groupId: "intro", groupEntryEpoch: 2 };
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "Group Runtime Run owner epoch differs from progression.",
    );
    running.activeRuns[0]!.owner = { kind: "presentation" };
    running.progression.phase = { kind: "stable" };
    expect(validateM3dCueRuntimeSnapshot(secondStateDefinition, running, 1)).toContain(
      "Progression blocking Run IDs differ from active blocking Runs.",
    );
  });

  it("keeps Timeline Runs limited to all-audience targets and unexpired deadlines", () => {
    const timelineDefinition = structuredClone(definition);
    timelineDefinition.flow.timelines.reveal = {
      id: "reveal",
      owner: { kind: "presentation" },
      durationMilliseconds: 100,
      tracks: [
        {
          target: { nodeId: "node-baked", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 100, value: 1 },
          ],
        },
      ],
    };
    const running = structuredClone(snapshot);
    running.lastAllocatedRunSequence = 1;
    running.activeRuns = [
      {
        kind: "timeline",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        owner: { kind: "presentation" },
        cause: {
          cueId: "wave",
          causeEventId: "event-1",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "start",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 0,
        timelineId: "reveal",
        completion: "nonBlocking",
      },
    ];
    expect(validateM3dCueRuntimeSnapshot(timelineDefinition, running, 1)).toEqual([]);
    timelineDefinition.scene.nodes["node-baked"]!.audience = { kind: "role", role: "presenter" };
    expect(validateM3dCueRuntimeSnapshot(timelineDefinition, running, 1)).toContain(
      "Timeline Run targets a role-limited Node.",
    );
    timelineDefinition.scene.nodes["node-baked"]!.audience = { kind: "all" };
    running.clock.runtimeTimeMilliseconds = 100;
    expect(validateM3dCueRuntimeSnapshot(timelineDefinition, running, 1)).toContain(
      "Runtime Run deadline has passed.",
    );
  });

  it("creates role-specific profiles and filters participant Runtime View", () => {
    const roleDefinition = structuredClone(definition);
    roleDefinition.scene.nodes["node-native"]!.audience = { kind: "role", role: "presenter" };
    const presenter = createRuntimeVisibilitySelection(
      roleDefinition,
      "presenter-profile",
      "presenter",
      ["counter"],
    );
    const viewer = createRuntimeVisibilitySelection(roleDefinition, "viewer-profile", "viewer", []);
    expect(presenter.visibleNodeIds).toContain("node-native");
    expect(viewer.visibleNodeIds).not.toContain("node-native");
    expect(viewer.visibleSurfaceIds).not.toContain("native");
    expect(validateRuntimeVisibilitySelection(roleDefinition, viewer)).toEqual([]);
    const malformed = { ...viewer, visibleNodeIds: [...viewer.visibleNodeIds, "node-native"] };
    expect(validateRuntimeVisibilitySelection(roleDefinition, malformed)).not.toEqual([]);
    const extraVariableDefinition = structuredClone(roleDefinition);
    extraVariableDefinition.flow.variables.unused = {
      ...structuredClone(extraVariableDefinition.flow.variables.counter!),
      id: "unused",
    };
    expect(
      validateRuntimeVisibilitySelection(extraVariableDefinition, {
        ...viewer,
        visibleVariableIds: ["unused"],
      }),
    ).toContain("Variable unused is not used by a visible Native UI Surface.");
    expect(() =>
      createRuntimeVisibilitySelection(roleDefinition, "duplicate", "viewer", [
        "counter",
        "counter",
      ]),
    ).toThrow("visibleVariableIds must be sorted and unique.");
    const view = projectM3dCueParticipantRuntimeView(roleDefinition, snapshot, viewer, 1);
    expect(view.nodeStates["node-native"]).toBeUndefined();
    expect(view.surfaceStates.native).toBeUndefined();
    expect(view.baseReliableSequence).toBe(snapshot.reliableSequence);
    const presenterView = projectM3dCueParticipantRuntimeView(
      roleDefinition,
      snapshot,
      presenter,
      1,
    );
    expect(presenterView.enabledLogicalInputs).toEqual(["next"]);
    const consumed = structuredClone(snapshot);
    consumed.stepExecution.consumedCueIds = ["wave"];
    expect(
      projectM3dCueParticipantRuntimeView(roleDefinition, consumed, presenter, 1)
        .enabledLogicalInputs,
    ).toEqual([]);
    consumed.stepExecution.consumedCueIds = [];
    consumed.stepExecution.cooldownUntilRuntimeTimeMilliseconds.wave = 1;
    expect(
      projectM3dCueParticipantRuntimeView(roleDefinition, consumed, presenter, 1)
        .enabledLogicalInputs,
    ).toEqual([]);
  });

  it("omits hidden Surface Run IDs from a Viewer snapshot", () => {
    const roleDefinition = structuredClone(definition);
    roleDefinition.scene.nodes["node-native"]!.audience = { kind: "role", role: "presenter" };
    roleDefinition.scene.surfaces.native!.states.next = {
      ...structuredClone(roleDefinition.scene.surfaces.native!.states.default!),
      id: "next",
    };
    const viewer = createRuntimeVisibilitySelection(roleDefinition, "viewer-profile", "viewer", []);
    const running = structuredClone(snapshot);
    const runId = { assignmentEpoch: 1, runSequence: 1 };
    running.lastAllocatedRunSequence = 1;
    running.activeRuns = [
      {
        kind: "surfaceTransition",
        runId,
        owner: { kind: "presentation" },
        cause: {
          cueId: "wave",
          causeEventId: "event-1",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "start",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 0,
        completion: "blocking",
        surfaceId: "native",
        fromStateId: "default",
        toStateId: "next",
        durationMilliseconds: 100,
        easing: "linear",
      },
    ];
    running.surfaceStates.native!.transitionRunId = runId;
    running.surfaceStates.native!.stateId = "next";
    running.progression.phase = {
      kind: "transitioning",
      cueId: "wave",
      causeEventId: "event-1",
      stepEntryEpoch: 1,
      blockingRunIds: [runId],
      pendingNext: { kind: "stay" },
    };
    const view = projectM3dCueParticipantRuntimeView(roleDefinition, running, viewer, 1);
    expect(view.activeRuns).toEqual([]);
    expect(view.progression.phase).toMatchObject({ kind: "transitioning", blockingRunIds: [] });
    expect(view.progression.phase).not.toHaveProperty("cueId");
    expect(view.progression.phase).not.toHaveProperty("causeEventId");
    expect(view.surfaceStates.native).toBeUndefined();
    expect(view.enabledLogicalInputs).toEqual([]);
  });
});
