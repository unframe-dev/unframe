import { describe, expect, it } from "vitest";

import { advanceCueClock, createCueState, executeCueEvent } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const setup = () => {
  const { definition } = makeM3AArtifacts();
  definition.scene.surfaces.baked!.states.shown = {
    contentOverrides: {},
    enabledInteractionIds: [],
    id: "shown",
    semanticOverrides: [],
  };
  definition.flow.variables.count = {
    id: "count",
    initialValue: 0,
    owner: { kind: "presentation" },
    type: "number",
  };
  return definition;
};

const input = {
  action: "next",
  actor: { kind: "participant" as const, role: "presenter" as const },
  causeEventId: "input-1",
  kind: "logicalInput" as const,
  payload: {},
};

describe("pure Cue executor", () => {
  it("uses priority order, applies one atomic batch, and consumes a Cue", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          { kind: "variable.set", value: { kind: "literal", value: 1 }, variableId: "count" },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "low",
        next: { kind: "stay" },
        order: 0,
        priority: 1,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
      {
        actions: [
          { kind: "variable.set", value: { kind: "literal", value: 2 }, variableId: "count" },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "high",
        next: { kind: "stay" },
        order: 0,
        priority: 2,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const first = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(first.outcome).toEqual({ cueId: "high", kind: "accepted" });
    expect(first.state.variables.count).toBe(2);
    expect(first.state.consumedCueIds).toEqual(["high"]);
    const second = executeCueEvent(definition, first.state, input);
    expect(second.outcome).toEqual({ cueId: "low", kind: "accepted" });
  });

  it("does not fall back when the selected batch fails", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          {
            kind: "variable.set",
            value: { kind: "eventPayload", field: "missing" },
            variableId: "count",
          },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "high",
        next: { kind: "stay" },
        order: 0,
        priority: 2,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
      {
        actions: [
          { kind: "variable.set", value: { kind: "literal", value: 3 }, variableId: "count" },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "low",
        next: { kind: "stay" },
        order: 0,
        priority: 1,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const state = createCueState(definition, 1);
    const result = executeCueEvent(definition, state, input);
    expect(result.outcome).toEqual({
      cueId: "high",
      kind: "rejected",
      reason: "invalidActionValue",
    });
    expect(result.state).toEqual(state);
  });

  it("enters a Step with an empty batch and resets consumption", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.next = { cues: [], id: "next" };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "advance",
        next: { kind: "step", stepId: "next" },
        order: 0,
        priority: 0,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(result.outcome).toEqual({ cueId: "advance", kind: "accepted" });
    expect(result.state.currentStepId).toBe("next");
    expect(result.state.stepEntryEpoch).toBe(2);
    expect(result.state.consumedCueIds).toEqual([]);
  });

  it("accepts stay with no Action", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "ack",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const state = createCueState(definition, 1);
    const result = executeCueEvent(definition, state, input);
    expect(result.outcome).toEqual({ cueId: "ack", kind: "accepted" });
    expect(result.state.currentStepId).toBe("start");
    expect(result.state.stepEntryEpoch).toBe(state.stepEntryEpoch);
    expect(result.state.consumedCueIds).toEqual(["ack"]);
  });

  it("fires a Step timer once without retrying after its Guard fails", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [],
        firePolicy: { kind: "oncePerStepEntry" },
        guard: {
          kind: "compare",
          left: { kind: "variable", variableId: "count" },
          operator: "eq",
          right: 1,
        },
        id: "timer",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { afterMilliseconds: 10, kind: "timer" },
      },
    ];
    const first = advanceCueClock(definition, createCueState(definition, 1), 10);
    expect(first.state.timerStates.timer).toEqual({ kind: "fired" });
    expect(first.outcomes).toEqual([]);
    const again = advanceCueClock(definition, first.state, 20);
    expect(again.outcomes).toEqual([]);
    expect(
      executeCueEvent(definition, first.state, {
        actor: { kind: "system", source: "timer" },
        causeEventId: "timer-1",
        cueId: "timer",
        kind: "timer",
        payload: {},
      }).outcome,
    ).toEqual({ kind: "none" });
  });

  it("uses fixed payload in Guard and Action, then enforces cooldown", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          {
            kind: "variable.set",
            value: { kind: "eventPayload", field: "value" },
            variableId: "count",
          },
        ],
        firePolicy: { cooldownMilliseconds: 10, kind: "repeatable" },
        fixedPayload: { value: 4 },
        guard: {
          kind: "compare",
          left: { field: "value", kind: "eventPayload" },
          operator: "eq",
          right: 4,
        },
        id: "payload",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const first = executeCueEvent(definition, createCueState(definition, 1), {
      ...input,
      payload: { value: 9 },
    });
    expect(first.state.variables.count).toBe(4);
    expect(executeCueEvent(definition, first.state, input).outcome).toEqual({ kind: "none" });
    const advanced = advanceCueClock(definition, first.state, 10);
    expect(executeCueEvent(definition, advanced.state, input).outcome).toEqual({
      cueId: "payload",
      kind: "accepted",
    });
  });

  it("preserves presentation resources and resets group resources on Group entry", () => {
    const definition = setup();
    definition.flow.variables.local = {
      id: "local",
      initialValue: 1,
      owner: { groupId: "intro", kind: "group" },
      type: "number",
    };
    definition.flow.groups.other = {
      id: "other",
      initialStepId: "start",
      steps: { start: { cues: [], id: "start" } },
    };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          { kind: "variable.set", value: { kind: "literal", value: 5 }, variableId: "count" },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "switch",
        next: { groupId: "other", kind: "group" },
        order: 0,
        priority: 0,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(result.state).toMatchObject({
      currentGroupId: "other",
      groupEntryEpoch: 2,
      variables: { count: 5 },
    });
    expect(result.state.variables).not.toHaveProperty("local");
  });

  it("patches a Node and cuts a Surface State in one batch", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          {
            kind: "node.patch",
            nodeId: "node-baked",
            patch: { visible: { kind: "literal", value: false } },
          },
          {
            kind: "surface.setState",
            stateId: "shown",
            surfaceId: "baked",
            transition: { kind: "cut" },
          },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "change",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
      },
    ];
    const result = executeCueEvent(definition, createCueState(definition, 1), input);
    expect(result.state.nodes["node-baked"]?.visible).toBe(false);
    expect(result.state.surfaces.baked).toBe("shown");
  });

  it("matches tracking actor and presenter subject for a Zone edge", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        actions: [
          { kind: "variable.set", value: { kind: "literal", value: 1 }, variableId: "count" },
        ],
        firePolicy: { kind: "oncePerStepEntry" },
        id: "entered",
        next: { kind: "stay" },
        order: 0,
        priority: 0,
        trigger: {
          actor: { kind: "system", source: "tracking" },
          edge: "enter",
          kind: "zoneEdge",
          subject: { kind: "anchor", owner: { kind: "presenter" }, target: "head" },
          zoneId: "front",
        },
      },
    ];
    const state = createCueState(definition, 1);
    const event = {
      actor: { kind: "system" as const, source: "tracking" as const },
      causeEventId: "zone-1",
      edge: "enter" as const,
      kind: "zoneEdge" as const,
      payload: {},
      subject: {
        kind: "anchor" as const,
        owner: { kind: "presenter" as const },
        target: "head" as const,
      },
      zoneId: "front",
    };
    expect(
      executeCueEvent(definition, state, { ...event, actor: { kind: "system", source: "runtime" } })
        .outcome,
    ).toEqual({ kind: "none" });
    expect(
      executeCueEvent(definition, state, {
        ...event,
        subject: { ...event.subject, target: "leftHand" },
      }).outcome,
    ).toEqual({ kind: "none" });
    expect(executeCueEvent(definition, state, event).state.variables.count).toBe(1);
  });
});
