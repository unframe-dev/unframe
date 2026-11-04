import { describe, expect, it } from "vite-plus/test";

import {
  advanceCueClock,
  createCueState,
  executeCueEvent,
  effectRuntimeDuration,
} from "@unframe-dev/playback";
import { makeM3AArtifacts } from "./fixtures.js";

const setup = () => {
  const { definition } = makeM3AArtifacts();
  definition.scene.surfaces.baked!.states.shown = {
    id: "shown",
    contentOverrides: {},
    semanticOverrides: [],
    enabledInteractionIds: [],
  };
  definition.flow.variables.count = {
    id: "count",
    owner: { kind: "presentation" },
    type: "number",
    initialValue: 0,
  };
  return definition;
};

const input = {
  kind: "logicalInput" as const,
  action: "next",
  actor: { kind: "participant" as const, role: "presenter" as const },
  payload: {},
  causeEventId: "input-1",
};

describe("pure Cue executor", () => {
  it("rejects unrepresentable effective durations and rounds deadlines up", () => {
    expect(effectRuntimeDuration({ durationMilliseconds: 101, speed: 2 })).toBe(51);
    expect(() =>
      effectRuntimeDuration({ durationMilliseconds: 100, speed: Number.MIN_VALUE }),
    ).toThrow(RangeError);
    expect(() =>
      effectRuntimeDuration({ durationMilliseconds: Number.MAX_SAFE_INTEGER, speed: 0.5 }),
    ).toThrow(RangeError);
  });

  it.each([0.5, 1, 2])(
    "settles Wave and Dissolve at their speed-adjusted deadline (%s)",
    (speed) => {
      const duration = Math.ceil(100 / speed);
      const definition = setup();
      const nodeId = Object.keys(definition.scene.nodes)[0]!;
      const effect = {
        kind: "wave" as const,
        size: 1,
        speed,
        waveCycles: 2,
        color: { red: 1, green: 1, blue: 1, alpha: 1 },
        durationMilliseconds: 100,
      };
      const cue = {
        id: "effect",
        priority: 0,
        order: 0,
        trigger: {
          kind: "logicalInput" as const,
          action: "next",
          actor: { kind: "presenter" as const },
        },
        firePolicy: { kind: "repeatable" as const },
        next: { kind: "stay" as const },
        actions: [
          {
            kind: "effect.start" as const,
            effectId: "wave",
            nodeId,
            owner: { kind: "presentation" as const },
            effect,
            seed: 9,
          },
        ],
      };
      const startAction = cue.actions[0]!;
      definition.flow.groups.intro!.steps.start!.cues = [cue];
      const first = executeCueEvent(definition, createCueState(definition, 1), input);
      expect(first.outcome.kind).toBe("accepted");
      expect(first.state.effectRuns[0]).toMatchObject({
        effectId: "wave",
        seed: 9,
        status: "active",
      });
      expect(
        advanceCueClock(definition, first.state, duration - 1).state.effectRuns[0]!.status,
      ).toBe("active");
      const full = structuredClone(first.state);
      full.effectRuns = Array.from({ length: 32 }, (_, index) => ({
        ...structuredClone(first.state.effectRuns[0]!),
        effectId: `effect-${index}`,
      }));
      expect(
        executeCueEvent(definition, full, { ...input, causeEventId: "capacity" }).outcome,
      ).toMatchObject({ kind: "rejected", reason: "conflict" });
      const elapsed = advanceCueClock(definition, first.state, duration).state;
      expect(elapsed.effectRuns[0]!.status).toBe("retained");
      definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
        { kind: "effect.stop", effectId: "wave" },
      ];
      const stopped = executeCueEvent(definition, elapsed, {
        ...input,
        causeEventId: "stop",
      }).state;
      expect(stopped.effectRuns).toEqual([]);
      definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
        {
          ...startAction,
          effectId: "dissolve",
          effect: {
            kind: "dissolve",
            size: 1,
            speed,
            color: effect.color,
            durationMilliseconds: 100,
          },
        },
      ];
      const dissolving = executeCueEvent(definition, stopped, {
        ...input,
        causeEventId: "dissolve",
      }).state;
      expect(
        advanceCueClock(definition, dissolving, 2 * duration - 1).state.nodes[nodeId]!.visible,
      ).toBe(true);
      definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
        {
          ...startAction,
          effect: dissolving.effectRuns[0]!.effect,
          effectId: "second-dissolve",
        },
      ];
      expect(
        executeCueEvent(definition, dissolving, { ...input, causeEventId: "duplicate-dissolve" })
          .outcome,
      ).toMatchObject({ kind: "rejected", reason: "conflict" });
      const done = advanceCueClock(definition, dissolving, 2 * duration).state;
      expect(done.nodes[nodeId]!.visible).toBe(false);
      expect(done.effectRuns).toEqual([]);
    },
  );

  it("uses priority order, applies one atomic batch, and consumes a Cue", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "low",
        priority: 1,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 1 } },
        ],
        next: { kind: "stay" },
      },
      {
        id: "high",
        priority: 2,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 2 } },
        ],
        next: { kind: "stay" },
      },
    ];
    const first = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(first.outcome).toEqual({ kind: "accepted", cueId: "high" });
    expect(first.state.variables.count).toBe(2);
    expect(first.state.consumedCueIds).toEqual(["high"]);
    const second = executeCueEvent(definition, first.state, input);
    expect(second.outcome).toEqual({ kind: "accepted", cueId: "low" });
  });

  it("does not fall back when the selected batch fails", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "high",
        priority: 2,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "variable.set",
            variableId: "count",
            value: { kind: "eventPayload", field: "missing" },
          },
        ],
        next: { kind: "stay" },
      },
      {
        id: "low",
        priority: 1,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 3 } },
        ],
        next: { kind: "stay" },
      },
    ];
    const state = createCueState(definition, 1);
    const result = executeCueEvent(definition, state, input);
    expect(result.outcome).toEqual({
      kind: "rejected",
      cueId: "high",
      reason: "invalidActionValue",
    });
    expect(result.state).toEqual(state);
  });

  it("enters a Step with an empty batch and resets consumption", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.next = { id: "next", cues: [] };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "advance",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "step", stepId: "next" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(result.outcome).toEqual({ kind: "accepted", cueId: "advance" });
    expect(result.state.currentStepId).toBe("next");
    expect(result.state.stepEntryEpoch).toBe(2);
    expect(result.state.consumedCueIds).toEqual([]);
  });

  it("accepts stay with no Action", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "ack",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
    const state = createCueState(definition, 1);
    const result = executeCueEvent(definition, state, input);
    expect(result.outcome).toEqual({ kind: "accepted", cueId: "ack" });
    expect(result.state.currentStepId).toBe("start");
    expect(result.state.stepEntryEpoch).toBe(state.stepEntryEpoch);
    expect(result.state.consumedCueIds).toEqual(["ack"]);
  });

  it("fires a Step timer once without retrying after its Guard fails", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "timer",
        priority: 0,
        order: 0,
        trigger: { kind: "timer", afterMilliseconds: 10 },
        guard: {
          kind: "compare",
          left: { kind: "variable", variableId: "count" },
          operator: "eq",
          right: 1,
        },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
    const first = advanceCueClock(definition, createCueState(definition, 1), 10);
    expect(first.state.timerStates.timer).toEqual({ kind: "fired" });
    expect(first.outcomes).toEqual([]);
    expect(first.captures).toEqual([]);
    const again = advanceCueClock(definition, first.state, 20);
    expect(again.outcomes).toEqual([]);
    expect(
      executeCueEvent(definition, first.state, {
        kind: "timer",
        cueId: "timer",
        actor: { kind: "system", source: "timer" },
        payload: {},
        causeEventId: "timer-1",
      }).outcome,
    ).toEqual({ kind: "none" });
  });

  it("uses fixed payload in Guard and Action and immediately repeats the Cue", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "payload",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        fixedPayload: { value: 4 },
        guard: {
          kind: "compare",
          left: { kind: "eventPayload", field: "value" },
          operator: "eq",
          right: 4,
        },
        firePolicy: { kind: "repeatable" },
        actions: [
          {
            kind: "variable.set",
            variableId: "count",
            value: { kind: "eventPayload", field: "value" },
          },
        ],
        next: { kind: "stay" },
      },
    ];
    const first = executeCueEvent(definition, createCueState(definition, 1), {
      ...input,
      payload: { value: 9 },
    });
    expect(first.state.variables.count).toBe(4);
    expect(executeCueEvent(definition, first.state, input).outcome).toEqual({
      kind: "accepted",
      cueId: "payload",
    });
    const advanced = advanceCueClock(definition, first.state, 10);
    expect(executeCueEvent(definition, advanced.state, input).outcome).toEqual({
      kind: "accepted",
      cueId: "payload",
    });
  });

  it("preserves presentation resources and resets group resources on Group entry", () => {
    const definition = setup();
    definition.flow.variables.local = {
      id: "local",
      owner: { kind: "group", groupId: "intro" },
      type: "number",
      initialValue: 1,
    };
    definition.flow.groups.other = {
      id: "other",
      initialStepId: "start",
      steps: { start: { id: "start", cues: [] } },
    };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "switch",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 5 } },
        ],
        next: { kind: "group", groupId: "other" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input, {
      capture: true,
    });
    expect(result.state).toMatchObject({
      currentGroupId: "other",
      groupEntryEpoch: 2,
      variables: { count: 5 },
    });
    expect(result.state.variables).not.toHaveProperty("local");
    expect(result.capture?.state.currentGroupId).toBe("intro");
    expect(result.capture?.state.variables.local).toBe(1);
    expect(result.capture?.state.variables.count).toBe(5);
  });

  it("patches a Node and cuts a Surface State in one batch", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "change",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "node.patch",
            nodeId: "node-baked",
            patch: { visible: { kind: "literal", value: false } },
          },
          {
            kind: "surface.setState",
            surfaceId: "baked",
            stateId: "shown",
            transition: { kind: "cut" },
          },
        ],
        next: { kind: "stay" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(result.state.nodes["node-baked"]?.visible).toBe(false);
    expect(result.state.surfaces.baked).toBe("shown");
  });

  it.each(["gesture", "zoneEdge"] as const)(
    "accepts %s only from the Presenter and consumes once-per-entry Cues",
    (kind) => {
      const definition = setup();
      const trigger =
        kind === "gesture"
          ? { kind, actor: { kind: "presenter" as const }, gesture: "swipeUp" as const }
          : {
              kind,
              actor: { kind: "presenter" as const },
              zoneId: "front",
              edge: "enter" as const,
            };
      definition.flow.groups.intro!.steps.start!.cues = [
        {
          id: "recognized",
          priority: 0,
          order: 0,
          trigger,
          firePolicy: { kind: "oncePerStepEntry" },
          actions: [
            { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 1 } },
          ],
          next: { kind: "stay" },
        },
      ];
      const event = {
        ...trigger,
        actor: { kind: "participant" as const, role: "presenter" as const },
        payload: {},
        causeEventId: "recognized-1",
      };
      const state = createCueState(definition, 1);
      expect(
        executeCueEvent(definition, state, {
          ...event,
          actor: { kind: "participant", role: "viewer" },
        }).outcome,
      ).toEqual({ kind: "none" });
      expect(
        executeCueEvent(definition, state, {
          ...event,
          actor: { kind: "system", source: "runtime" },
        }).outcome,
      ).toEqual({ kind: "none" });
      const accepted = executeCueEvent(definition, state, event);
      expect(accepted.state.variables.count).toBe(1);
      expect(executeCueEvent(definition, accepted.state, event).outcome).toEqual({ kind: "none" });
    },
  );
});

it("captures accepted actions before presentation exit without capturing rejected candidates", () => {
  const definition = setup();
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      id: "exit",
      priority: 0,
      order: 0,
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 7 } },
      ],
      next: { kind: "end" },
    },
  ];
  const result = executeCueEvent(definition, createCueState(definition, 1), input, {
    capture: true,
  });
  expect(result.capture?.cueId).toBe("exit");
  expect(result.capture?.state.ended).toBe(false);
  expect(result.capture?.state.variables.count).toBe(7);
  expect(result.state.ended).toBe(true);
  expect(executeCueEvent(definition, result.state, input).capture).toBeUndefined();
});

it("captures checkpoints only when explicitly requested", () => {
  const definition = setup();
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      id: "ack",
      priority: 0,
      order: 0,
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "stay" },
    },
  ];
  const state = createCueState(definition, 1);
  expect(executeCueEvent(definition, state, input).capture).toBeUndefined();
  expect(executeCueEvent(definition, state, input, { capture: true }).capture?.cueId).toBe("ack");
});
