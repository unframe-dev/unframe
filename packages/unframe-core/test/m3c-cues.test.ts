import { describe, expect, it } from "vitest";

import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";
import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  const cue = {
    id: "cue",
    priority: 1,
    order: 0,
    trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
    firePolicy: { kind: "oncePerStepEntry" },
    actions: [
      {
        kind: "surface.setState",
        surfaceId: "baked",
        stateId: "default",
        transition: { kind: "cut" },
      },
    ],
    next: { kind: "stay" },
  } as PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];
  definition.flow.groups.intro!.steps.start!.cues = [structuredClone(cue)];
  return { definition, cue: definition.flow.groups.intro!.steps.start!.cues[0]! };
};
const codes = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("M3C Cue invariants", () => {
  it("accepts supported actions, fixed payload and empty stay", () => {
    const { definition, cue } = fixture();
    definition.flow.variables.count = {
      id: "count",
      owner: { kind: "presentation" },
      type: "number",
      initialValue: 0,
    };
    cue.fixedPayload = { amount: 2 };
    cue.guard = {
      kind: "compare",
      left: { kind: "eventPayload", field: "amount" },
      operator: "gt",
      right: 1,
    };
    cue.actions = [
      {
        kind: "variable.set",
        variableId: "count",
        value: { kind: "eventPayload", field: "amount" },
      },
    ];
    expect(codes(definition)).toEqual([]);
    cue.actions = [];
    expect(codes(definition)).toEqual([]);
  });

  it("rejects missing references, wrong owner and duplicate claims", () => {
    const { definition, cue } = fixture();
    cue.actions.push({ kind: "surface.setState", surfaceId: "baked", stateId: "default" });
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [
      {
        kind: "node.patch",
        nodeId: "missing",
        patch: { active: { kind: "literal", value: true } },
      },
    ];
    expect(codes(definition)).toContain("reference.invalid");
    cue.actions = [{ kind: "surface.setState", surfaceId: "baked", stateId: "missing" }];
    expect(codes(definition)).toContain("reference.invalid");
    definition.scene.nodes["node-baked"]!.owner = { kind: "group", groupId: "other" };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("checks payload and variable types", () => {
    const { definition, cue } = fixture();
    cue.guard = {
      kind: "compare",
      left: { kind: "eventPayload", field: "value" },
      operator: "eq",
      right: 1,
    };
    expect(codes(definition)).toContain("reference.invalid");
    cue.fixedPayload = { value: "text" };
    expect(codes(definition)).toContain("behavior.invalid");
    delete cue.guard;
    definition.flow.variables.flag = {
      id: "flag",
      owner: { kind: "presentation" },
      type: "boolean",
      initialValue: true,
    };
    cue.actions = [
      { kind: "variable.set", variableId: "flag", value: { kind: "literal", value: 3 } },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("validates trigger producer, semantic event and node field claims", () => {
    const { definition, cue } = fixture();
    cue.trigger = {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "system", source: "runtime" },
    };
    expect(codes(definition)).toContain("behavior.invalid");
    cue.trigger = { kind: "semanticEvent", event: "missing", actor: { kind: "presenter" } };
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger = { kind: "timer", afterMilliseconds: 100 };
    cue.actions = [
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { active: { kind: "literal", value: true } },
      },
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { active: { kind: "literal", value: false } },
      },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("requires Presenter for Interaction-derived semantic events", () => {
    const { definition, cue } = fixture();
    const surface = definition.scene.surfaces.baked!;
    surface.interactions.click = { id: "click", kind: "click", event: "activate", hitPriority: 1 };
    surface.states.default!.enabledInteractionIds = ["click"];
    surface.renderIntent.interaction = { kind: "regions", events: ["activate"] };
    cue.trigger = {
      kind: "semanticEvent",
      event: "activate",
      actor: { kind: "system", source: "runtime" },
    };
    const systemResult = validatePresentationDefinition(definition);
    expect(systemResult.valid).toBe(false);
    if (systemResult.valid) throw new Error("Expected a producer diagnostic.");
    expect(
      systemResult.diagnostics.some((item) => item.path.join("/").endsWith("trigger/actor")),
    ).toBe(true);
    cue.trigger = { kind: "semanticEvent", event: "activate", actor: { kind: "presenter" } };
    const presenterResult = validatePresentationDefinition(definition);
    expect(
      presenterResult.diagnostics.some((item) => item.path.join("/").endsWith("trigger/actor")),
    ).toBe(false);
  });

  it("rejects opacity values outside 0..1 and empty Node patches", () => {
    const { definition, cue } = fixture();
    cue.actions = [
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { opacity: { kind: "literal", value: 1.25 } },
      },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.fixedPayload = { opacity: -0.1 };
    cue.actions = [
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { opacity: { kind: "eventPayload", field: "opacity" } },
      },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [{ kind: "node.patch", nodeId: "node-baked", patch: {} }];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("accepts Presenter tracking selectors and validates Zone ownership", () => {
    const { definition, cue } = fixture();
    definition.stage.zones.near = {
      id: "near",
      owner: { kind: "presentation" },
      center: [0, 0, 0],
      size: [1, 1, 1],
    };
    cue.trigger = {
      kind: "zoneEdge",
      actor: { kind: "system", source: "tracking" },
      subject: { kind: "participant", owner: { kind: "presenter" } },
      zoneId: "near",
      edge: "enter",
    };
    expect(codes(definition)).toEqual([]);
    definition.stage.zones.near.owner = { kind: "group", groupId: "other" };
    expect(codes(definition)).toContain("reference.invalid");
    definition.stage.zones.near.owner = { kind: "presentation" };
    cue.trigger.zoneId = "missing";
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger = {
      kind: "motion",
      actor: { kind: "system", source: "tracking" },
      subject: { kind: "anchor", owner: { kind: "presenter" }, target: "head" },
      minimumDistanceMeters: 0.1,
      windowMilliseconds: 100,
    };
    expect(codes(definition)).toEqual([]);
  });

  it("rejects unsupported producers and actions explicitly", () => {
    const { definition, cue } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "missing" };
    cue.actions = [{ kind: "timeline.stop", timelineId: "missing" }];
    expect(codes(definition)).toContain("feature.unsupported");
  });
});
