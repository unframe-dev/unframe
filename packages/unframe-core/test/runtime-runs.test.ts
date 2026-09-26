import { describe, expect, it } from "vitest";

import {
  advanceCueClock,
  completeRuntimeRun,
  createCueState,
  executeCueEvent,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const setup = () => {
  const { definition } = makeM3AArtifacts();
  definition.flow.timelines.fade = {
    id: "fade",
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
  definition.flow.groups.intro!.steps.next = { id: "next", cues: [] };
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      id: "play",
      priority: 0,
      order: 0,
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "timeline.play", timelineId: "fade", completion: "blocking", conflict: "reject" },
      ],
      next: { kind: "step", stepId: "next" },
    },
  ];
  return definition;
};

const input = {
  kind: "logicalInput" as const,
  action: "next",
  actor: { kind: "participant" as const, role: "presenter" as const },
  payload: {},
  causeEventId: "event-1",
};

describe("canonical Timeline Run", () => {
  it("starts with assignment-scoped ID and delays progression until logical deadline", () => {
    const definition = setup();
    const started = executeCueEvent(definition, createCueState(definition, 7), input);
    expect(started.outcome).toEqual({ kind: "accepted", cueId: "play" });
    expect(started.state.activeRuns).toMatchObject([
      {
        runId: { assignmentEpoch: 7, runSequence: 1 },
        timelineId: "fade",
        completion: "blocking",
        startedAtRuntimeTimeMilliseconds: 0,
        cause: { cueId: "play", causeEventId: "event-1" },
      },
    ]);
    expect(started.state.phase).toMatchObject({
      kind: "transitioning",
      blockingRunIds: [{ assignmentEpoch: 7, runSequence: 1 }],
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
    expect(result.outcome).toEqual({ kind: "rejected", cueId: "play", reason: "conflict" });
    expect(result.state).toEqual(state);
  });

  it("stops at current interpolated value and treats inactive stop as a no-op", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      kind: "timeline.play",
      timelineId: "fade",
      completion: "nonBlocking",
      conflict: "reject",
    };
    definition.flow.groups.intro!.steps.next!.cues = [
      {
        id: "stop",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "stop", actor: { kind: "presenter" } },
        firePolicy: { kind: "repeatable", cooldownMilliseconds: 0 },
        actions: [{ kind: "timeline.stop", timelineId: "fade" }],
        next: { kind: "stay" },
      },
    ];
    const started = executeCueEvent(definition, createCueState(definition, 7), input);
    const halfway = advanceCueClock(definition, started.state, 50).state;
    const stopInput = { ...input, action: "stop", causeEventId: "event-2" };
    const stopped = executeCueEvent(definition, halfway, stopInput);
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
      state: started,
      completed: false,
    });
    expect(completeRuntimeRun(definition, started, { assignmentEpoch: 8, runSequence: 1 })).toEqual(
      { state: started, completed: false },
    );
    const done = advanceCueClock(definition, started, 100).state;
    expect(completeRuntimeRun(definition, done, runId)).toEqual({ state: done, completed: false });
  });

  it("evaluates a timer after the last blocking completion at the same deadline", () => {
    const definition = setup();
    definition.flow.variables.timerFired = {
      id: "timerFired",
      owner: { kind: "presentation" },
      type: "boolean",
      initialValue: false,
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      id: "timer",
      priority: 0,
      order: 1,
      trigger: { kind: "timer", afterMilliseconds: 100 },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "variable.set", variableId: "timerFired", value: { kind: "literal", value: true } },
      ],
      next: { kind: "stay" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const done = advanceCueClock(definition, started, 100);
    expect(done.state.currentStepId).toBe("start");
    expect(done.state.variables.timerFired).toBe(true);
    expect(done.outcomes).toEqual([{ kind: "accepted", cueId: "timer" }]);
  });

  it("cancels a group-owned non-blocking Timeline on Group exit after committing its value", () => {
    const definition = setup();
    definition.flow.timelines.fade!.owner = { kind: "group", groupId: "intro" };
    definition.flow.groups.other = {
      id: "other",
      initialStepId: "start",
      steps: { start: { id: "start", cues: [] } },
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      kind: "timeline.play",
      timelineId: "fade",
      completion: "nonBlocking",
      conflict: "reject",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      id: "exit",
      priority: 0,
      order: 1,
      trigger: { kind: "logicalInput", action: "exit", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "group", groupId: "other" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const halfway = advanceCueClock(definition, started, 50).state;
    const exited = executeCueEvent(definition, halfway, {
      ...input,
      action: "exit",
      causeEventId: "exit-1",
    }).state;
    expect(exited.activeRuns).toEqual([]);
    expect(exited.nodes["node-baked"]?.opacity).toBe(0.5);
    expect(exited.currentGroupId).toBe("other");
  });

  it("waits for all blocking Runs", () => {
    const definition = setup();
    definition.scene.surfaces.baked!.states.shown = {
      id: "shown",
      contentOverrides: {},
      semanticOverrides: [],
      enabledInteractionIds: [],
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "surface.setState",
      surfaceId: "baked",
      stateId: "shown",
      transition: {
        kind: "crossfade",
        durationMilliseconds: 200,
        easing: "linear",
        completion: "blocking",
      },
    });
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
      id: "shown",
      contentOverrides: {},
      semanticOverrides: [],
      enabledInteractionIds: [],
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "surface.setState",
      surfaceId: "baked",
      stateId: "shown",
      transition: {
        kind: "crossfade",
        durationMilliseconds: 200,
        easing: "linear",
        completion: "blocking",
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
          id: "shown",
          contentOverrides: {},
          semanticOverrides: [],
          enabledInteractionIds: [],
        };
        definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
          {
            kind: "surface.setState",
            surfaceId: "baked",
            stateId: "shown",
            transition: {
              kind: "crossfade",
              durationMilliseconds: 100,
              easing: "linear",
              completion: "blocking",
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
        id: "timer",
        priority: 0,
        order: 0,
        trigger: { kind: "timer", afterMilliseconds: 100 },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [];
    const state = createCueState(definition, 7);
    state.runtimeTimeMilliseconds = Number.MAX_SAFE_INTEGER - 99;
    expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
    expect(state.currentStepId).toBe("start");

    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues[0]!.firePolicy = {
      kind: "repeatable",
      cooldownMilliseconds: 100,
    };
    expect(() => executeCueEvent(definition, state, input)).toThrow(RangeError);
    expect(state.cooldownUntilRuntimeTimeMilliseconds).toEqual({});
  });

  it("suppresses all completion Cues when a deadline batch began transitioning", () => {
    const definition = setup();
    definition.flow.timelines.move = {
      id: "move",
      owner: { kind: "presentation" },
      durationMilliseconds: 100,
      tracks: [
        {
          target: { nodeId: "node-baked", property: "transform.position" },
          keyframes: [
            { timeMilliseconds: 0, value: [0, 0, 0], easingToNext: "linear" },
            { timeMilliseconds: 100, value: [1, 0, 0] },
          ],
        },
      ],
    };
    definition.flow.variables.finished = {
      id: "finished",
      owner: { kind: "presentation" },
      type: "boolean",
      initialValue: false,
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions.push({
      kind: "timeline.play",
      timelineId: "move",
      completion: "nonBlocking",
      conflict: "reject",
    });
    definition.flow.groups.intro!.steps.start!.cues.push({
      id: "moveCompleted",
      priority: 0,
      order: 1,
      trigger: { kind: "timelineCompleted", timelineId: "move" },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "variable.set", variableId: "finished", value: { kind: "literal", value: true } },
      ],
      next: { kind: "stay" },
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
      kind: "timeline.play",
      timelineId: "fade",
      completion: "nonBlocking",
      conflict: "reject",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      id: "end",
      priority: 0,
      order: 1,
      trigger: { kind: "logicalInput", action: "end", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "end" },
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
      owner: { kind: "presentation" },
      type: "boolean",
      initialValue: false,
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0] = {
      kind: "timeline.play",
      timelineId: "fade",
      completion: "nonBlocking",
      conflict: "reject",
    };
    definition.flow.groups.intro!.steps.start!.cues[0]!.next = { kind: "stay" };
    definition.flow.groups.intro!.steps.start!.cues.push({
      id: "completed",
      priority: 0,
      order: 1,
      trigger: { kind: "timelineCompleted", timelineId: "fade" },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "variable.set", variableId: "finished", value: { kind: "literal", value: true } },
      ],
      next: { kind: "stay" },
    });
    const started = executeCueEvent(definition, createCueState(definition, 7), input).state;
    const completed = advanceCueClock(definition, started, 100);
    expect(completed.state.variables.finished).toBe(true);
    expect(completed.outcomes).toEqual([{ kind: "accepted", cueId: "completed" }]);
  });
});
