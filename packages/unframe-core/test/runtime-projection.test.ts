import { describe, expect, it } from "vitest";
import {
  m3dCueRuntimeSnapshotSchema,
  type CanonicalRuntimeSnapshot,
  type PresentationDefinition,
} from "@unframe/contracts/presentation";

import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import snapshotFixture from "../../contracts/presentation/fixtures/m3d-cue-runtime-snapshot.json";
import invalidSnapshotFixture from "../../contracts/presentation/fixtures/m3d-cue-runtime-snapshot.invalid.json";
import renderBundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import visibilityFixture from "../../contracts/presentation/fixtures/runtime-visibility-selection.json";
import {
  createM3dCueRuntimeSnapshot,
  createRuntimeVisibilitySelection,
  projectM3dCueParticipantRuntimeView,
  validateM3dCueRuntimeSnapshot,
  validateCanonicalRuntimeSnapshot,
  validateRuntimeVisibilitySelection,
} from "../src/runtime/projection.js";
import { createCueState } from "../src/runtime/cue-executor.js";

const definition = structuredClone(definitionFixture) as unknown as PresentationDefinition;
const snapshot = m3dCueRuntimeSnapshotSchema.parse(snapshotFixture);

describe("M3D Runtime projection and canonical snapshot", () => {
  it.each([false, true])("uses current State loop %s for an over-duration playback", (loop) => {
    const currentDefinition = structuredClone(definition);
    const surface = currentDefinition.scene.surfaces.video!;
    surface.states.repeat = {
      ...surface.states.default!,
      id: "repeat",
      contentOverrides: { video: { kind: "video", loop: true } },
    };
    const bundle = structuredClone(renderBundleFixture);
    const render = bundle.surfaces.video.renderSurfaces["render-video"];
    const base = render.artifacts["artifact-video"];
    Object.assign(render.artifacts, {
      "artifact-loop": { ...base, id: "artifact-loop", loop: true },
    });
    Object.assign(render.stateBindings, {
      repeat: { kind: "artifacts", artifactIds: ["artifact-loop"] },
    });
    Object.assign(bundle.surfaces.video.semanticsByState, {
      repeat: structuredClone(bundle.surfaces.video.semanticsByState.default),
    });
    Object.assign(bundle.surfaces.video.interactionsByState, { repeat: [] });
    const full = structuredClone(snapshot) as CanonicalRuntimeSnapshot;
    full.surfaceStates.video = { stateId: loop ? "repeat" : "default" };
    full.mediaStates = {
      video: {
        kind: "active",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        playback: { kind: "paused", positionMilliseconds: 1001 },
      },
    };
    full.modelClipStates = { model: { kind: "defaultPose" } };
    full.lastAllocatedRunSequence = 1;
    full.activeRuns = [
      {
        kind: "media",
        surfaceId: "video",
        completion: "nonBlocking",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        playback: { kind: "paused", positionMilliseconds: 1001 },
        owner: { kind: "presentation" },
        startedAtRuntimeTimeMilliseconds: 0,
        cause: {
          cueId: "wave",
          causeEventId: "event-1",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "start",
          stepEntryEpoch: 1,
        },
      },
    ];

    expect(validateCanonicalRuntimeSnapshot(currentDefinition, bundle as never, full, 1)).toEqual(
      loop ? [] : ["mediaStates.video position exceeds duration."],
    );
  });

  it.each([1500, 2001])(
    "bounds stopped Video position %i by admitted artifact duration",
    (heldPositionMilliseconds) => {
      const bundle = structuredClone(renderBundleFixture);
      bundle.surfaces.video.renderSurfaces["render-video"].artifacts[
        "artifact-video"
      ].durationMilliseconds = 2000;
      const full = structuredClone(snapshot) as CanonicalRuntimeSnapshot;
      full.mediaStates = { video: { kind: "stopped", heldPositionMilliseconds } };
      full.modelClipStates = { model: { kind: "defaultPose" } };

      expect(validateCanonicalRuntimeSnapshot(definition, bundle as never, full, 1)).toEqual(
        heldPositionMilliseconds <= 2000 ? [] : ["mediaStates.video position exceeds duration."],
      );
    },
  );

  it("requires all active Media and Model resources in a full snapshot", () => {
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, snapshot, 1),
    ).toEqual([
      "mediaStates differs from the active resource set.",
      "modelClipStates differs from the active resource set.",
    ]);
    const full = structuredClone(snapshot) as CanonicalRuntimeSnapshot;
    full.mediaStates = { video: { kind: "stopped", heldPositionMilliseconds: 0 } };
    full.modelClipStates = { model: { kind: "defaultPose" } };
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toEqual([]);
    full.mediaStates.video = { kind: "stopped", heldPositionMilliseconds: 1001 };
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("mediaStates.video position exceeds duration.");
    full.mediaStates.video = { kind: "stopped", heldPositionMilliseconds: 0 };
    full.variables.counter = "wrong";
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("Variable counter has the wrong scalar type.");
    full.variables.counter = 0;
    full.stepExecution.consumedCueIds = ["missing"];
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("Consumed Cue references a Cue outside the current Step.");
    full.stepExecution.consumedCueIds = [];
    full.presentationOrigin.pose.rotation = [0, 0, 0, -1];
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("Presentation origin rotation must be a canonical unit Quaternion.");
  });
  it("rejects accessor-backed canonical inputs without invoking accessors", () => {
    let accessed = false;
    const unsafe = Object.defineProperty(structuredClone(snapshot), "clock", {
      enumerable: true,
      get() {
        accessed = true;
        throw new Error("accessor executed");
      },
    });
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, unsafe, 1),
    ).toEqual(["Canonical snapshot inputs must be plain JSON data properties."]);
    expect(accessed).toBe(false);
  });

  it("rejects computed Model positions that overflow while allowing finite loop positions", () => {
    const full = structuredClone(snapshot) as CanonicalRuntimeSnapshot;
    full.clock.runtimeTimeMilliseconds = 2;
    full.lastAllocatedRunSequence = 1;
    full.mediaStates = { video: { kind: "stopped", heldPositionMilliseconds: 0 } };
    full.modelClipStates = {
      model: { kind: "active", runId: { assignmentEpoch: 1, runSequence: 1 } },
    };
    full.activeRuns = [
      {
        kind: "modelClip",
        modelNodeId: "model",
        completion: "nonBlocking",
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
        phase: {
          kind: "single",
          clip: {
            clipId: "wave",
            speed: 1000,
            loop: true,
            playback: {
              kind: "playing",
              positionAtReferenceMilliseconds: 0,
              referenceRuntimeTimeMilliseconds: 0,
            },
          },
        },
      },
    ];
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toEqual([]);
    const run = full.activeRuns[0]!;
    if (run.kind !== "modelClip" || run.phase.kind !== "single")
      throw new TypeError("Expected a single Model Run.");
    run.phase.clip.speed = 1e308;
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("Model Run model computed position must be finite.");
    run.phase.clip.speed = 1;
    run.phase.clip.loop = false;
    if (run.phase.clip.playback.kind !== "playing")
      throw new TypeError("Expected a playing Model clip.");
    run.phase.clip.playback.positionAtReferenceMilliseconds = 998;
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toContain("Model Run model deadline has passed.");
    run.phase = {
      kind: "crossfade",
      transition: {
        from: {
          clipId: "wave",
          speed: 1,
          loop: false,
          playback: { kind: "paused", positionMilliseconds: 1000 },
        },
        to: {
          clipId: "wave",
          speed: 1,
          loop: false,
          playback: {
            kind: "playing",
            positionAtReferenceMilliseconds: 1000,
            referenceRuntimeTimeMilliseconds: 0,
          },
        },
        transitionClock: {
          kind: "playing",
          positionAtReferenceMilliseconds: 0,
          referenceRuntimeTimeMilliseconds: 0,
        },
        durationMilliseconds: 100,
        easing: "linear",
        fromIsHeld: true,
      },
    };
    expect(
      validateCanonicalRuntimeSnapshot(definition, renderBundleFixture as never, full, 1),
    ).toEqual([]);
  });
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
    state.activeRuns = structuredClone(running.activeRuns).filter(
      (run): run is Extract<typeof run, { kind: "timeline" | "surfaceTransition" }> =>
        run.kind === "timeline" || run.kind === "surfaceTransition",
    );
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
    timelineDefinition.flow.timelines.reveal!.owner = { kind: "group", groupId: "intro" };
    running.activeRuns[0]!.owner = { kind: "group", groupId: "intro", groupEntryEpoch: 1 };
    const fullGroupRun = structuredClone(running) as CanonicalRuntimeSnapshot;
    fullGroupRun.mediaStates = { video: { kind: "stopped", heldPositionMilliseconds: 0 } };
    fullGroupRun.modelClipStates = { model: { kind: "defaultPose" } };
    expect(
      validateCanonicalRuntimeSnapshot(
        timelineDefinition,
        renderBundleFixture as never,
        fullGroupRun,
        1,
      ),
    ).toEqual([]);
    timelineDefinition.flow.timelines.reveal!.owner = { kind: "presentation" };
    running.activeRuns[0]!.owner = { kind: "presentation" };
    timelineDefinition.flow.groups.later = {
      ...structuredClone(timelineDefinition.flow.groups.intro!),
      id: "later",
    };
    timelineDefinition.scene.nodes["node-baked"]!.owner = { kind: "group", groupId: "later" };
    delete running.nodeStates["node-baked"];
    delete running.surfaceStates.baked;
    expect(validateM3dCueRuntimeSnapshot(timelineDefinition, running, 1)).toContain(
      "Timeline Run targets an inactive Node.",
    );
    timelineDefinition.scene.nodes["node-baked"]!.owner = { kind: "presentation" };
    running.nodeStates["node-baked"] = structuredClone(snapshot.nodeStates["node-baked"]!);
    running.surfaceStates.baked = structuredClone(snapshot.surfaceStates.baked!);
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
