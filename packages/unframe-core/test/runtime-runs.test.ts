import { describe, expect, it } from "vitest";

import {
  advanceCueClock,
  completeRuntimeRun,
  createCueState,
  executeCueEvent,
  validatePresentationDefinition,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const setup = () => {
  const { definition } = makeM3AArtifacts();
  definition.flow.timelines.fade = {
    durationMilliseconds: 100,
    id: "fade",
    owner: { kind: "presentation" },
    tracks: [
      {
        keyframes: [
          { easingToNext: "linear", timeMilliseconds: 0, value: 0 },
          { timeMilliseconds: 100, value: 1 },
        ],
        target: { nodeId: "node-baked", property: "opacity" },
      },
    ],
  };
  definition.flow.groups.intro!.steps.next = { cues: [], id: "next" };
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      actions: [
        { completion: "blocking", conflict: "reject", kind: "timeline.play", timelineId: "fade" },
      ],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "play",
      next: { kind: "step", stepId: "next" },
      order: 0,
      priority: 0,
      trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
    },
  ];
  return definition;
};

const input = {
  action: "next",
  actor: { kind: "participant" as const, role: "presenter" as const },
  causeEventId: "event-1",
  kind: "logicalInput" as const,
  payload: {},
};

describe("canonical Timeline Run", () => {
  it("starts with assignment-scoped ID and delays progression until logical deadline", () => {
    const definition = setup();
    const started = executeCueEvent(definition, createCueState(definition, 7), input);
    expect(started.outcome).toEqual({ cueId: "play", kind: "accepted" });
    expect(started.state.activeRuns).toMatchObject([
      {
        cause: { causeEventId: "event-1", cueId: "play" },
        completion: "blocking",
        runId: { assignmentEpoch: 7, runSequence: 1 },
        startedAtRuntimeTimeMilliseconds: 0,
        timelineId: "fade",
      },
    ]);
    expect(started.state.phase).toMatchObject({
      blockingRunIds: [{ assignmentEpoch: 7, runSequence: 1 }],
      kind: "transitioning",
    });
    expect(started.state.currentStepId).toBe("start");
    const before = advanceCueClock(definition, started.state, 99);
    expect(before.state.currentStepId).toBe("start");
    const completed = advanceCueClock(definition, before.state, 100);
    expect(completed.state.activeRuns).toEqual([]);
    expect(completed.state.nodes["node-baked"]?.opacity).toBe(1);
    expect(completed.state.currentStepId).toBe("next");
    expect(completed.state.phase).toEqual({ kind: "stable" });
  });

  it("rejects an active property conflict atomically", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "node.patch",
      nodeId: "node-baked",
      patch: { opacity: { kind: "literal", value: 0.5 } },
    });
    const state = createCueState(definition, 7);
    const result = executeCueEvent(definition, state, input);
    expect(result.outcome).toEqual({ cueId: "play", kind: "rejected", reason: "conflict" });
    expect(result.state).toEqual(state);
  });

  it("stops at current interpolated value and treats inactive stop as a no-op", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "fade",
    };
    definition.flow.groups.intro!.steps.next!.cues = [
      {
        actions: [{ kind: "timeline.stop", timelineId: "fade" }],
        firePolicy: { cooldownMilliseconds: 0, kind: "repeatable" },
        id: "stop",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { action: "stop", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const started = executeCueEvent(definition, createCueState(definition, 7), input);
    const halfway = advanceCueClock(definition, started.state, 50).state;
    const stopInput = { ...input, action: "stop", causeEventId: "event-2" };
    const stopped = executeCueEvent(definition, halfway, stopInput);
    expect(stopped.canceledRuns).toEqual([
      { reason: "explicitStop", runId: started.state.activeRuns[0]!.runId, timelineId: "fade" },
    ]);
    expect(stopped.state.nodes["node-baked"]?.opacity).toBe(0.5);
    expect(stopped.state.activeRuns).toEqual([]);
    expect(
      executeCueEvent(definition, stopped.state, { ...stopInput, causeEventId: "event-3" }).state
        .activeRuns,
    ).toEqual([]);
  });

  it("ignores premature, duplicate, and wrong-assignment completion", () => {
    const definition = setup();
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const runId = started.activeRuns[0]!.runId;
    expect(completeRuntimeRun(definition, started, runId)).toEqual({
      completed: false,
      state: started,
    });
    expect(completeRuntimeRun(definition, started, { assignmentEpoch: 8, runSequence: 1 })).toEqual(
      { completed: false, state: started },
    );
    const done = advanceCueClock(definition, started, 100).state;
    expect(completeRuntimeRun(definition, done, runId)).toEqual({ completed: false, state: done });
  });

  it("evaluates a timer after the last blocking completion at the same deadline", () => {
    const definition = setup();
    definition.flow.variables.timerFired = {
      id: "timerFired",
      initialValue: false,
      owner: { kind: "presentation" },
      type: "boolean",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [
        { kind: "variable.set", value: { kind: "literal", value: true }, variableId: "timerFired" },
      ],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "timer",
      next: { kind: "stay" },
      order: 1,
      priority: 0,
      trigger: { afterMilliseconds: 100, kind: "timer" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const done = advanceCueClock(definition, started, 100);
    expect(done.state.currentStepId).toBe("start");
    expect(done.state.variables.timerFired).toBe(true);
    expect(done.outcomes).toEqual([{ cueId: "timer", kind: "accepted" }]);
  });

  it("cancels a group-owned non-blocking Timeline on Group exit after committing its value", () => {
    const definition = setup();
    definition.flow.timelines.fade!.owner = { groupId: "intro", kind: "group" };
    definition.flow.groups.other = {
      id: "other",
      initialStepId: "start",
      steps: { start: { cues: [], id: "start" } },
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "fade",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "exit",
      next: { groupId: "other", kind: "group" },
      order: 1,
      priority: 0,
      trigger: { action: "exit", actor: { kind: "presenter" }, kind: "logicalInput" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const halfway = advanceCueClock(definition, started, 50).state;
    const exitResult = executeCueEvent(definition, halfway, {
      ...input,
      action: "exit",
      causeEventId: "exit-1",
    });
    expect(exitResult.canceledRuns).toEqual([
      { reason: "groupExit", runId: started.activeRuns[0]!.runId, timelineId: "fade" },
    ]);
    const exited = exitResult.state;
    expect(exited.activeRuns).toEqual([]);
    expect(exited.nodes["node-baked"]?.opacity).toBe(0.5);
    expect(exited.currentGroupId).toBe("other");
  });

  it("cancels active Timelines in Run ID order without committing values when presentation ends", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "fade",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "end",
      next: { kind: "end" },
      order: 1,
      priority: 0,
      trigger: { action: "end", actor: { kind: "presenter" }, kind: "logicalInput" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const halfway = advanceCueClock(definition, started, 50).state;
    const ended = executeCueEvent(definition, halfway, { ...input, action: "end" });
    expect(ended.canceledRuns).toEqual([
      { reason: "presentationEnded", runId: started.activeRuns[0]!.runId, timelineId: "fade" },
    ]);
    expect(ended.state.activeRuns).toEqual([]);
    expect(ended.state.nodes["node-baked"]?.opacity).toBe(1);
    expect(ended.state.ended).toBe(true);
  });

  it("waits for all blocking Runs", () => {
    const definition = setup();
    definition.scene.surfaces.baked!.states.shown = {
      contentOverrides: {},
      enabledInteractionIds: [],
      id: "shown",
      semanticOverrides: [],
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "surface.setState",
      stateId: "shown",
      surfaceId: "baked",
      transition: {
        completion: "blocking",
        durationMilliseconds: 200,
        easing: "linear",
        kind: "crossfade",
      },
    });
    expect(validatePresentationDefinition(definition).valid).toBe(true);
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    expect(started.activeRuns).toHaveLength(2);
    expect(started.surfaces.baked).toBe("shown");
    const at100 = advanceCueClock(definition, started, 100).state;
    expect(at100.currentStepId).toBe("start");
    expect(at100.activeRuns).toMatchObject([{ kind: "surfaceTransition" }]);
    const done = advanceCueClock(definition, at100, 200).state;
    expect(done.activeRuns).toEqual([]);
    expect(done.currentStepId).toBe("next");
  });

  it("allocates Run IDs by stable target order regardless of Action order", () => {
    const definition = setup();
    definition.scene.surfaces.baked!.states.shown = {
      contentOverrides: {},
      enabledInteractionIds: [],
      id: "shown",
      semanticOverrides: [],
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "surface.setState",
      stateId: "shown",
      surfaceId: "baked",
      transition: {
        completion: "blocking",
        durationMilliseconds: 200,
        easing: "linear",
        kind: "crossfade",
      },
    });
    const reverse = structuredClone(definition);
    reverse.flow.groups.intro!.steps.start!.cues[0]!.actions.reverse();
    const ids = (source: typeof definition) =>
      executeCueEvent(source, createCueState(source, 7), input).state.activeRuns.map((run) => [
        run.kind,
        run.runId.runSequence,
      ]);
    expect(ids(definition)).toEqual([
      ["surfaceTransition", 1],
      ["timeline", 2],
    ]);
    expect(ids(reverse)).toEqual(ids(definition));
  });

  it("rejects Run sequence overflow before changing the input state", () => {
    const definition = setup();
    const state = createCueState(definition, 7);
    state.lastRunSequence = Number.MAX_SAFE_INTEGER;
    expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
    expect(state.activeRuns).toEqual([]);
    expect(state.lastRunSequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects an unrepresentable Timeline or Surface deadline before starting a Run", () => {
    for (const kind of ["timeline", "surface"] as const) {
      const definition = setup();
      if (kind === "surface") {
        definition.scene.surfaces.baked!.states.shown = {
          contentOverrides: {},
          enabledInteractionIds: [],
          id: "shown",
          semanticOverrides: [],
        };
        definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
          {
            kind: "surface.setState",
            stateId: "shown",
            surfaceId: "baked",
            transition: {
              completion: "blocking",
              durationMilliseconds: 100,
              easing: "linear",
              kind: "crossfade",
            },
          },
        ];
      }
      const state = createCueState(definition, 7);
      state.runtimeTimeMilliseconds = Number.MAX_SAFE_INTEGER - 99;
      expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
      expect(state.activeRuns).toEqual([]);
      expect(state.lastRunSequence).toBe(0);
    }
  });

  it("checks Step timer and repeatable cooldown deadlines", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.next!.cues = [
      {
        actions: [],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "timer",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { afterMilliseconds: 100, kind: "timer" },
      },
    ];
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [];
    const state = createCueState(definition, 7);
    state.runtimeTimeMilliseconds = Number.MAX_SAFE_INTEGER - 99;
    expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
    expect(state.currentStepId).toBe("start");

    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues[0]!.firePolicy = {
      cooldownMilliseconds: 100,
      kind: "repeatable",
    };
    expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
    expect(state.cooldownUntilRuntimeTimeMilliseconds).toEqual({});
  });

  it("suppresses all completion Cues when a deadline batch began transitioning", () => {
    const definition = setup();
    definition.flow.timelines.move = {
      durationMilliseconds: 100,
      id: "move",
      owner: { kind: "presentation" },
      tracks: [
        {
          keyframes: [
            { easingToNext: "linear", timeMilliseconds: 0, value: [0, 0, 0] },
            { timeMilliseconds: 100, value: [1, 0, 0] },
          ],
          target: { nodeId: "node-baked", property: "transform.position" },
        },
      ],
    };
    definition.flow.variables.finished = {
      id: "finished",
      initialValue: false,
      owner: { kind: "presentation" },
      type: "boolean",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "move",
    });
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [
        { kind: "variable.set", value: { kind: "literal", value: true }, variableId: "finished" },
      ],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "moveCompleted",
      next: { kind: "stay" },
      order: 1,
      priority: 0,
      trigger: { kind: "timelineCompleted", timelineId: "move" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const completed = advanceCueClock(definition, started, 100);
    expect(completed.state.phase).toEqual({ kind: "stable" });
    expect(completed.state.activeRuns).toEqual([]);
    expect(completed.state.variables.finished).toBe(false);
    expect(completed.outcomes).toEqual([]);
  });

  it("does not commit a Timeline value when the Presentation ends", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "fade",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "end",
      next: { kind: "end" },
      order: 1,
      priority: 0,
      trigger: { action: "end", actor: { kind: "presenter" }, kind: "logicalInput" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const halfway = advanceCueClock(definition, started, 50).state;
    const ended = executeCueEvent(definition, halfway, {
      ...input,
      action: "end",
      causeEventId: "end-1",
    }).state;
    expect(ended.ended).toBe(true);
    expect(ended.activeRuns).toEqual([]);
    expect(ended.nodes["node-baked"]?.opacity).toBe(1);
  });

  it("evaluates timelineCompleted only for a stable non-blocking Run", () => {
    const definition = setup();
    definition.flow.variables.finished = {
      id: "finished",
      initialValue: false,
      owner: { kind: "presentation" },
      type: "boolean",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "fade",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      actions: [
        { kind: "variable.set", value: { kind: "literal", value: true }, variableId: "finished" },
      ],
      firePolicy: { kind: "oncePerStepEntry" },
      id: "completed",
      next: { kind: "stay" },
      order: 1,
      priority: 0,
      trigger: { kind: "timelineCompleted", timelineId: "fade" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const completed = advanceCueClock(definition, started, 100);
    expect(completed.state.variables.finished).toBe(true);
    expect(completed.outcomes).toEqual([{ cueId: "completed", kind: "accepted" }]);
  });
});
