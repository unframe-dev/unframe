import { describe, expect, it } from "vitest";
import { presentationDefinitionSchema, renderBundleSchema } from "@unframe/contracts/presentation";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import {
  createCueState,
  executeCueEvent,
  advanceCueClock,
  createM3dCueRuntimeSnapshot,
  validateCanonicalRuntimeSnapshot,
} from "@unframe/playback";

const setup = () => {
  const definition = presentationDefinitionSchema.parse(structuredClone(definitionFixture));
  const bundle = renderBundleSchema.parse(structuredClone(bundleFixture));
  definition.flow.groups.intro!.steps.start!.cues = [];
  const state = createCueState(definition, 9, bundle);
  const fire = (
    current: typeof state,
    actions: (typeof definition.flow.groups)[string]["steps"][string]["cues"][number]["actions"],
  ) => {
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "playback",
        order: 0,
        priority: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "repeatable" },
        actions,
        next: { kind: "stay" },
      },
    ];
    return executeCueEvent(definition, current, {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "input",
    });
  };
  return { definition, bundle, state, fire };
};
const play = {
  kind: "modelClip.play",
  nodeId: "model",
  clipId: "wave",
  speed: 2,
  loop: false,
  completion: "nonBlocking",
  transition: { kind: "immediate" },
  conflict: "reject",
} as const;

describe("canonical media and model playback", () => {
  it("requires an artifact catalog when model or video resources exist", () => {
    const { definition } = setup();
    expect(() => createCueState(definition, 1)).toThrow(/RenderBundle/);
  });
  it.each([1e-300, Number.MIN_VALUE])(
    "rejects an unrepresentable model deadline at speed %s atomically",
    (speed) => {
      const { state, fire } = setup();
      const result = fire(state, [
        { kind: "media.play", surfaceId: "video" },
        { ...play, speed },
      ]);
      expect(result.outcome).toEqual({
        kind: "rejected",
        cueId: "playback",
        reason: "invalidActionValue",
      });
      expect(result.state).toBe(state);
      expect(state.lastRunSequence).toBe(0);
      expect(state.activeRuns).toEqual([]);
    },
  );
  it("rejects a crossfade whose target clip deadline overflows before replacing its source", () => {
    const { state, fire } = setup();
    const started = fire(state, [play]).state;
    const result = fire(started, [
      {
        ...play,
        speed: 1e-300,
        transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" },
      },
    ]);
    expect(result.outcome).toEqual({
      kind: "rejected",
      cueId: "playback",
      reason: "invalidActionValue",
    });
    expect(result.state).toBe(started);
    expect(started.lastRunSequence).toBe(1);
    expect(started.activeRuns[0]).toMatchObject({ phase: { kind: "single" } });
  });
  it("accounts for elapsed runtime when checking the model deadline", () => {
    const { definition, state, fire } = setup();
    const current = advanceCueClock(definition, state, Number.MAX_SAFE_INTEGER - 999).state;
    const result = fire(current, [{ ...play, speed: 1 }]);
    expect(result.outcome).toMatchObject({ kind: "rejected", reason: "invalidActionValue" });
    expect(result.state).toBe(current);
    const accepted = fire(current, [{ ...play, speed: 2 }]);
    expect(accepted.outcome.kind).toBe("accepted");
  });
  it("rejects an overflowing media start without allocating a Run", () => {
    const { definition, state, fire } = setup();
    const current = advanceCueClock(definition, state, Number.MAX_SAFE_INTEGER - 999).state;
    const before = structuredClone(current);
    const result = fire(current, [{ kind: "media.play", surfaceId: "video" }]);
    expect(result.outcome).toMatchObject({ kind: "rejected", reason: "invalidActionValue" });
    expect(result.state).toBe(current);
    expect(current).toEqual(before);
  });
  it("rejects an overflowing media resume without changing its paused Run", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 250).state;
    current = fire(current, [{ kind: "media.pause", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, Number.MAX_SAFE_INTEGER - 749).state;
    const before = structuredClone(current);
    const result = fire(current, [{ kind: "media.play", surfaceId: "video" }]);
    expect(result.outcome).toMatchObject({ kind: "rejected", reason: "invalidActionValue" });
    expect(result.state).toBe(current);
    expect(current).toEqual(before);
  });
  it("starts media whose deadline is exactly the safe integer limit", () => {
    const { definition, state, fire } = setup();
    const current = advanceCueClock(definition, state, Number.MAX_SAFE_INTEGER - 1000).state;
    const result = fire(current, [{ kind: "media.play", surfaceId: "video" }]);
    expect(result.outcome.kind).toBe("accepted");
    expect(result.state.activeRuns[0]?.runId).toEqual({ assignmentEpoch: 9, runSequence: 1 });
    const completed = advanceCueClock(definition, result.state, Number.MAX_SAFE_INTEGER).state;
    expect(completed.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("resumes media whose remaining deadline is exactly the safe integer limit", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 250).state;
    current = fire(current, [{ kind: "media.pause", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, Number.MAX_SAFE_INTEGER - 750).state;
    const result = fire(current, [{ kind: "media.play", surfaceId: "video" }]);
    expect(result.outcome.kind).toBe("accepted");
    expect(result.state.activeRuns[0]?.runId).toEqual({ assignmentEpoch: 9, runSequence: 1 });
    const completed = advanceCueClock(definition, result.state, Number.MAX_SAFE_INTEGER).state;
    expect(completed.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("rejects resuming a model when its rebased deadline overflows", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ ...play, speed: 1 }]).state;
    current = fire(current, [{ kind: "modelClip.pause", nodeId: "model" }]).state;
    current = advanceCueClock(definition, current, Number.MAX_SAFE_INTEGER - 999).state;
    const result = fire(current, [{ kind: "modelClip.resume", nodeId: "model" }]);
    expect(result.outcome).toMatchObject({ kind: "rejected", reason: "invalidActionValue" });
    expect(result.state).toBe(current);
    expect(current.activeRuns[0]).toMatchObject({
      phase: { clip: { playback: { kind: "paused" } } },
    });
  });
  it("rejects resuming a crossfade when its rebased fade deadline overflows", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ ...play, loop: true }]).state;
    current = fire(current, [
      {
        ...play,
        loop: true,
        transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" },
      },
    ]).state;
    current = fire(current, [{ kind: "modelClip.pause", nodeId: "model" }]).state;
    current = advanceCueClock(definition, current, Number.MAX_SAFE_INTEGER - 99).state;
    const result = fire(current, [{ kind: "modelClip.resume", nodeId: "model" }]);
    expect(result.outcome).toMatchObject({ kind: "rejected", reason: "invalidActionValue" });
    expect(result.state).toBe(current);
  });
  it("pauses and resumes a speed-adjusted model without changing its Run ID", () => {
    const { definition, state, fire } = setup();
    const started = fire(state, [play]);
    expect(started.outcome.kind).toBe("accepted");
    let current = advanceCueClock(definition, started.state, 100).state;
    current = fire(current, [{ kind: "modelClip.pause", nodeId: "model" }]).state;
    current = advanceCueClock(definition, current, 700).state;
    expect(current.activeRuns[0]).toMatchObject({
      kind: "modelClip",
      phase: { clip: { playback: { kind: "paused", positionMilliseconds: 200 } } },
    });
    current = fire(current, [{ kind: "modelClip.resume", nodeId: "model" }]).state;
    expect(current.activeRuns[0]?.runId).toEqual({ assignmentEpoch: 9, runSequence: 1 });
    current = advanceCueClock(definition, current, 1100).state;
    expect(current.modelClipStates["model"]).toEqual({
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 1000 },
    });
    expect(current.activeRuns).toEqual([]);
  });
  it("completes media on the logical clock and resets its canonical held position", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 250).state;
    current = fire(current, [{ kind: "media.pause", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 1500).state;
    expect(current.mediaStates.video).toMatchObject({
      kind: "active",
      playback: { kind: "paused", positionMilliseconds: 250 },
    });
    current = fire(current, [
      { kind: "media.seek", surfaceId: "video", positionSeconds: { kind: "literal", value: 0.9 } },
      { kind: "modelClip.stop", nodeId: "model" },
    ]).state;
    current = fire(current, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 1600).state;
    expect(current.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("rejects a batch atomically when a later playback command has an invalid target", () => {
    const { state, fire } = setup();
    const result = fire(state, [play, { kind: "media.play", surfaceId: "missing" }]);
    expect(result.outcome.kind).toBe("rejected");
    expect(result.state).toBe(state);
    expect(result.state.lastRunSequence).toBe(0);
  });
});

describe("model crossfades and Run fences", () => {
  it("holds the eased blend when stopped and rejects a blend as a new crossfade source", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [play]).state;
    current = advanceCueClock(definition, current, 100).state;
    current = fire(current, [
      {
        ...play,
        speed: 1,
        transition: { kind: "crossfade", durationMilliseconds: 400, easing: "cubicIn" },
      },
    ]).state;
    current = advanceCueClock(definition, current, 300).state;
    current = fire(current, [{ kind: "modelClip.stop", nodeId: "model" }]).state;
    expect(current.modelClipStates.model).toEqual({
      kind: "heldBlend",
      from: { clipId: "wave", positionMilliseconds: 600 },
      to: { clipId: "wave", positionMilliseconds: 200 },
      toWeight: 0.125,
    });
    expect(
      fire(current, [
        { ...play, transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" } },
      ]).outcome,
    ).toMatchObject({ kind: "rejected", reason: "conflict" });
  });
  it("freezes both the clip and fade clock during pause and completes a short target at the fade boundary", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [play]).state;
    current = fire(current, [
      {
        ...play,
        speed: 10,
        transition: { kind: "crossfade", durationMilliseconds: 400, easing: "linear" },
      },
    ]).state;
    current = advanceCueClock(definition, current, 200).state;
    current = fire(current, [{ kind: "modelClip.pause", nodeId: "model" }]).state;
    current = advanceCueClock(definition, current, 1200).state;
    expect(current.activeRuns[0]).toMatchObject({
      phase: { transition: { transitionClock: { kind: "paused", positionMilliseconds: 200 } } },
    });
    current = fire(current, [{ kind: "modelClip.resume", nodeId: "model" }]).state;
    current = advanceCueClock(definition, current, 1400).state;
    expect(current.activeRuns).toEqual([]);
    expect(current.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 1000 },
    });
    expect(current.runtimeTimeMilliseconds).toBe(1400);
  });
  it("holds progression through crossfade settlement until the target clip ends", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [play]).state;
    fire(current, [
      {
        ...play,
        speed: 1,
        completion: "blocking",
        transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" },
      },
    ]);
    definition.flow.groups.intro!.steps.done = { id: "done", cues: [] };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "step", stepId: "done" };
    current = executeCueEvent(definition, current, {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "blocking",
    }).state;
    current = advanceCueClock(definition, current, 100).state;
    expect(current.currentStepId).toBe("start");
    expect(current.phase.kind).toBe("transitioning");
    current = advanceCueClock(definition, current, 1000).state;
    expect(current.currentStepId).toBe("done");
  });
  it("allocates new media and model Run IDs by canonical target order", () => {
    const { state, fire } = setup();
    const first = fire(state, [play, { kind: "media.play", surfaceId: "video" }]).state;
    const second = fire(state, [{ kind: "media.play", surfaceId: "video" }, play]).state;
    expect(first.mediaStates).toEqual(second.mediaStates);
    expect(first.modelClipStates).toEqual(second.modelClipStates);
  });
});

describe("clock authority and resource lifecycle", () => {
  it("keeps an active high-speed loop snapshot valid after position multiplication overflows", () => {
    const { definition, bundle, state, fire } = setup();
    const started = fire(state, [{ ...play, speed: Number.MAX_VALUE, loop: true }]);
    const advanced = advanceCueClock(definition, started.state, 2).state;
    const snapshot = createM3dCueRuntimeSnapshot(definition, advanced, {
      reliableSequence: 0,
      lastIngressSequence: 0,
      lifecycle: { kind: "running" },
      presentationOrigin: { version: 0, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    });
    expect(validateCanonicalRuntimeSnapshot(definition, bundle, snapshot, 9)).toEqual([]);
  });
  it("holds a finite loop position when speed times elapsed time overflows", () => {
    const { definition, state, fire } = setup();
    const started = fire(state, [{ ...play, speed: Number.MAX_VALUE, loop: true }]);
    expect(started.outcome.kind).toBe("accepted");
    const advanced = advanceCueClock(definition, started.state, 2).state;
    const stopped = fire(advanced, [{ kind: "modelClip.stop", nodeId: "model" }]);
    expect(stopped.outcome.kind).toBe("accepted");
    expect(stopped.state.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 736 },
    });
  });
  it("pauses and resumes a finite loop position after playback multiplication overflows", () => {
    const { definition, state, fire } = setup();
    const started = fire(state, [{ ...play, speed: Number.MAX_VALUE, loop: true }]);
    const advanced = advanceCueClock(definition, started.state, 2).state;
    const paused = fire(advanced, [{ kind: "modelClip.pause", nodeId: "model" }]);
    expect(paused.outcome.kind).toBe("accepted");
    expect(paused.state.activeRuns[0]).toMatchObject({
      phase: { clip: { playback: { kind: "paused", positionMilliseconds: 736 } } },
    });
    const waiting = advanceCueClock(definition, paused.state, 100).state;
    const resumed = fire(waiting, [{ kind: "modelClip.resume", nodeId: "model" }]);
    const later = advanceCueClock(definition, resumed.state, 102).state;
    const stopped = fire(later, [{ kind: "modelClip.stop", nodeId: "model" }]);
    expect(stopped.state.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 472 },
    });
  });
  it("ignores decoder completion input and emits completion from the logical deadline", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ kind: "media.play", surfaceId: "video" }]).state;
    definition.flow.groups.intro!.steps.done = { id: "done", cues: [] };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "completed",
        priority: 0,
        order: 0,
        trigger: { kind: "mediaCompleted", surfaceId: "video" },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "step", stepId: "done" },
      },
    ];
    expect(
      executeCueEvent(definition, current, {
        kind: "mediaCompleted",
        surfaceId: "video",
        actor: { kind: "system", source: "media" },
        payload: {},
        causeEventId: "decoder",
      }).outcome.kind,
    ).toBe("none");
    current = advanceCueClock(definition, current, 1000).state;
    expect(current.currentStepId).toBe("done");
  });
  it("cancels media when its Surface changes State but leaves it running for the same State", () => {
    const { definition, state, fire } = setup();
    definition.scene.surfaces.video!.states.second = {
      ...definition.scene.surfaces.video!.states.default!,
      id: "second",
    };
    let current = fire(state, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 250).state;
    current = fire(current, [
      { kind: "surface.setState", surfaceId: "video", stateId: "default" },
    ]).state;
    expect(current.activeRuns).toHaveLength(1);
    current = fire(current, [
      { kind: "surface.setState", surfaceId: "video", stateId: "second" },
    ]).state;
    expect(current.activeRuns).toEqual([]);
    expect(current.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 250 });
  });
  it("keeps looping clips active until stopped and holds the wrapped pose", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [{ ...play, loop: true }]).state;
    current = advanceCueClock(definition, current, 1250).state;
    expect(current.activeRuns).toHaveLength(1);
    current = fire(current, [{ kind: "modelClip.stop", nodeId: "model" }]).state;
    expect(current.modelClipStates.model).toEqual({
      kind: "heldClip",
      clip: { clipId: "wave", positionMilliseconds: 500 },
    });
  });
});

describe("playback scope cleanup", () => {
  it("removes group-owned playback and recreates default state upon reentry", () => {
    const { definition, bundle, fire } = setup();
    definition.scene.nodes.model!.owner = { kind: "group", groupId: "intro" };
    definition.scene.nodes["node-video"]!.owner = { kind: "group", groupId: "intro" };
    definition.flow.groups.second = {
      id: "second",
      initialStepId: "idle",
      steps: { idle: { id: "idle", cues: [] } },
    };
    let current = fire(createCueState(definition, 9, bundle), [
      play,
      { kind: "media.play", surfaceId: "video" },
    ]).state;
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "leave",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "group", groupId: "second" },
      },
    ];
    const event = {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "group",
    } as const;
    current = executeCueEvent(definition, current, event).state;
    expect(current.activeRuns).toEqual([]);
    expect(current.modelClipStates).toEqual({});
    expect(current.mediaStates).toEqual({});
    definition.flow.groups.second!.steps.idle!.cues = [
      {
        ...definition.flow.groups.intro!.steps.start!.cues[0]!,
        id: "return",
        next: { kind: "group", groupId: "intro" },
      },
    ];
    current = executeCueEvent(definition, current, event).state;
    expect(current.modelClipStates.model).toEqual({ kind: "defaultPose" });
    expect(current.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("resets all playback state when the Presentation ends", () => {
    const { definition, state, fire } = setup();
    let current = fire(state, [play, { kind: "media.play", surfaceId: "video" }]).state;
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "end" };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [];
    current = executeCueEvent(definition, current, {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "end",
    }).state;
    expect(current.ended).toBe(true);
    expect(current.activeRuns).toEqual([]);
    expect(current.modelClipStates.model).toEqual({ kind: "defaultPose" });
    expect(current.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
});

describe("Media State catalogs", () => {
  it("does not initialize playback from a Video renderer preference without Video content", () => {
    const { definition, bundle, fire } = setup();
    definition.scene.surfaces.baked!.renderIntent.rendererPreference = "video";
    const state = createCueState(definition, 9, bundle);
    expect(state.mediaStates.baked).toBeUndefined();
    expect(fire(state, [{ kind: "media.play", surfaceId: "baked" }]).outcome).toMatchObject({
      kind: "rejected",
      reason: "invalidTarget",
    });
    const snapshot = createM3dCueRuntimeSnapshot(definition, state, {
      reliableSequence: 0,
      lastIngressSequence: 0,
      lifecycle: { kind: "running" },
      presentationOrigin: { version: 0, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    });
    expect(validateCanonicalRuntimeSnapshot(definition, bundle, snapshot, 9)).toEqual([]);
  });
  it("initializes precomputed Video playback without a structured Video node", () => {
    const { definition, bundle, fire } = setup();
    definition.scene.surfaces.video!.content = structuredClone(
      definition.scene.surfaces.baked!.content,
    );
    const state = createCueState(definition, 9, bundle);
    expect(fire(state, [{ kind: "media.play", surfaceId: "video" }]).outcome.kind).toBe("accepted");
    expect(state.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("initializes structured Video playback without precomputed animation", () => {
    const { definition, bundle, fire } = setup();
    definition.scene.surfaces.video!.renderIntent.internalAnimation = { kind: "none" };
    const state = createCueState(definition, 9, bundle);
    expect(fire(state, [{ kind: "media.play", surfaceId: "video" }]).outcome.kind).toBe("accepted");
    expect(state.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
  it("uses the current State loop policy and preserves stopped position across switching", () => {
    const { definition, bundle, fire } = setup();
    const surface = definition.scene.surfaces.video!;
    surface.states.looping = {
      ...surface.states.default!,
      id: "looping",
      contentOverrides: { video: { kind: "video", loop: true } },
    };
    const render = bundle.surfaces.video!.renderSurfaces["render-video"]!;
    const artifact = render.artifacts["artifact-video"]!;
    if (artifact.kind !== "video") throw new Error("Expected Video fixture.");
    render.artifacts.looping = { ...artifact, id: "looping", loop: true };
    render.stateBindings.looping = { kind: "artifacts", artifactIds: ["looping"] };
    let current = fire(createCueState(definition, 9, bundle), [
      { kind: "media.play", surfaceId: "video" },
    ]).state;
    current = advanceCueClock(definition, current, 250).state;
    current = fire(current, [
      { kind: "surface.setState", surfaceId: "video", stateId: "looping" },
    ]).state;
    expect(current.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 250 });
    current = fire(current, [{ kind: "media.play", surfaceId: "video" }]).state;
    current = advanceCueClock(definition, current, 2000).state;
    expect(current.activeRuns).toHaveLength(1);
    current = fire(current, [{ kind: "media.pause", surfaceId: "video" }]).state;
    expect(current.mediaStates.video).toMatchObject({
      kind: "active",
      playback: { kind: "paused", positionMilliseconds: 0 },
    });
  });
  it("rejects playback in an empty State without a bound Video artifact", () => {
    const { definition, bundle, fire } = setup();
    const surface = definition.scene.surfaces.video!;
    surface.states.empty = { ...surface.states.default!, id: "empty" };
    surface.initialStateId = "empty";
    bundle.surfaces.video!.renderSurfaces["render-video"]!.stateBindings.empty = { kind: "empty" };
    const state = createCueState(definition, 9, bundle);
    expect(fire(state, [{ kind: "media.play", surfaceId: "video" }]).outcome).toMatchObject({
      kind: "rejected",
      reason: "invalidTarget",
    });
    expect(state.mediaStates.video).toEqual({ kind: "stopped", heldPositionMilliseconds: 0 });
  });
});

it("allows a blocking finite target to fade out a looping source", () => {
  const { definition, bundle, state, fire } = setup();
  let current = fire(state, [{ ...play, loop: true }]).state;
  current = fire(current, [
    {
      ...play,
      speed: 1,
      completion: "blocking",
      transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" },
    },
  ]).state;
  current = advanceCueClock(definition, current, 50).state;
  const snapshot = createM3dCueRuntimeSnapshot(definition, current, {
    reliableSequence: 0,
    lastIngressSequence: 0,
    lifecycle: { kind: "running" },
    presentationOrigin: { version: 0, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
  });
  expect(validateCanonicalRuntimeSnapshot(definition, bundle, snapshot, 9)).toEqual([]);
  current = advanceCueClock(definition, current, 1000).state;
  expect(current.phase.kind).toBe("stable");
  expect(current.activeRuns).toEqual([]);
});
