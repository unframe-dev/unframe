import { describe, expect, it } from "vitest";

import { advanceCueClock, createCueState, executeCueEvent } from "../src/index.js";
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
};

describe("pure Cue executor", () => {
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
    const first = executeCueEvent(definition, createCueState(definition), input);
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
    const state = createCueState(definition);
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
    const result = executeCueEvent(definition, createCueState(definition), input);
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
    const state = createCueState(definition);
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
    const first = advanceCueClock(definition, createCueState(definition), 10);
    expect(first.state.timerStates.timer).toEqual({ kind: "fired" });
    expect(first.outcomes).toEqual([]);
    const again = advanceCueClock(definition, first.state, 20);
    expect(again.outcomes).toEqual([]);
    expect(
      executeCueEvent(definition, first.state, {
        kind: "timer",
        cueId: "timer",
        actor: { kind: "system", source: "timer" },
        payload: {},
      }).outcome,
    ).toEqual({ kind: "none" });
  });

  it("uses fixed payload in Guard and Action, then enforces cooldown", () => {
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
        firePolicy: { kind: "repeatable", cooldownMilliseconds: 10 },
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
    const first = executeCueEvent(definition, createCueState(definition), {
      ...input,
      payload: { value: 9 },
    });
    expect(first.state.variables.count).toBe(4);
    expect(executeCueEvent(definition, first.state, input).outcome).toEqual({ kind: "none" });
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
    const result = executeCueEvent(definition, createCueState(definition), input);
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
    const result = executeCueEvent(definition, createCueState(definition), input);
    expect(result.state.nodes["node-baked"]?.visible).toBe(false);
    expect(result.state.surfaces.baked).toBe("shown");
  });

  it("matches tracking actor and presenter subject for a Zone edge", () => {
    const definition = setup();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "entered",
        priority: 0,
        order: 0,
        trigger: {
          kind: "zoneEdge",
          actor: { kind: "system", source: "tracking" },
          subject: { kind: "anchor", owner: { kind: "presenter" }, target: "head" },
          zoneId: "front",
          edge: "enter",
        },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          { kind: "variable.set", variableId: "count", value: { kind: "literal", value: 1 } },
        ],
        next: { kind: "stay" },
      },
    ];
    const state = createCueState(definition);
    const event = {
      kind: "zoneEdge" as const,
      zoneId: "front",
      edge: "enter" as const,
      subject: {
        kind: "anchor" as const,
        owner: { kind: "presenter" as const },
        target: "head" as const,
      },
      actor: { kind: "system" as const, source: "tracking" as const },
      payload: {},
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
