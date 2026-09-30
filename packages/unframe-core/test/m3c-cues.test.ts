import { describe, expect, it } from "vitest";

import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";
import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  const cue = {
    actions: [
      {
        kind: "surface.setState",
        stateId: "default",
        surfaceId: "baked",
        transition: { kind: "cut" },
      },
    ],
    firePolicy: { kind: "oncePerStepEntry" },
    id: "cue",
    next: { kind: "stay" },
    order: 0,
    priority: 1,
    trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
  } as PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];
  definition.flow.groups.intro!.steps.start!.cues = [structuredClone(cue)];
  return { cue: definition.flow.groups.intro!.steps.start!.cues[0]!, definition };
};
const codes = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("M3C Cue invariants", () => {
  it("accepts supported actions, fixed payload and empty stay", () => {
    const { cue, definition } = fixture();
    definition.flow.variables.count = {
      id: "count",
      initialValue: 0,
      owner: { kind: "presentation" },
      type: "number",
    };
    cue.fixedPayload = { amount: 2 };
    cue.guard = {
      kind: "compare",
      left: { field: "amount", kind: "eventPayload" },
      operator: "gt",
      right: 1,
    };
    cue.actions = [
      {
        kind: "variable.set",
        value: { field: "amount", kind: "eventPayload" },
        variableId: "count",
      },
    ];
    expect(codes(definition)).toEqual([]);
    cue.actions = [];
    expect(codes(definition)).toEqual([]);
  });

  it("rejects missing references, wrong owner and duplicate claims", () => {
    const { cue, definition } = fixture();
    cue.actions.push({ kind: "surface.setState", stateId: "default", surfaceId: "baked" });
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [
      {
        kind: "node.patch",
        nodeId: "missing",
        patch: { active: { kind: "literal", value: true } },
      },
    ];
    expect(codes(definition)).toContain("reference.invalid");
    cue.actions = [{ kind: "surface.setState", stateId: "missing", surfaceId: "baked" }];
    expect(codes(definition)).toContain("reference.invalid");
    definition.scene.nodes["node-baked"]!.owner = { groupId: "other", kind: "group" };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("checks payload and variable types", () => {
    const { cue, definition } = fixture();
    cue.fixedPayload = { other: 1 };
    cue.guard = {
      kind: "compare",
      left: { field: "value", kind: "eventPayload" },
      operator: "eq",
      right: 1,
    };
    expect(codes(definition)).toContain("reference.invalid");
    cue.fixedPayload = { value: "text" };
    expect(codes(definition)).toContain("behavior.invalid");
    delete cue.guard;
    definition.flow.variables.flag = {
      id: "flag",
      initialValue: true,
      owner: { kind: "presentation" },
      type: "boolean",
    };
    cue.actions = [
      { kind: "variable.set", value: { kind: "literal", value: 3 }, variableId: "flag" },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("accepts an unknown ingress payload field for a Logical Input Cue without fixedPayload", () => {
    const { cue, definition } = fixture();
    definition.flow.variables.count = {
      id: "count",
      initialValue: 0,
      owner: { kind: "presentation" },
      type: "number",
    };
    cue.guard = {
      kind: "compare",
      left: { field: "amount", kind: "eventPayload" },
      operator: "gt",
      right: 1,
    };
    cue.actions = [
      {
        kind: "variable.set",
        value: { field: "amount", kind: "eventPayload" },
        variableId: "count",
      },
    ];
    expect(codes(definition)).toEqual([]);
  });

  it("validates trigger producer, semantic event and node field claims", () => {
    const { cue, definition } = fixture();
    cue.trigger = {
      action: "next",
      actor: { kind: "system", source: "runtime" },
      kind: "logicalInput",
    };
    expect(codes(definition)).toContain("behavior.invalid");
    cue.trigger = { actor: { kind: "presenter" }, event: "missing", kind: "semanticEvent" };
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger = { afterMilliseconds: 100, kind: "timer" };
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
    const { cue, definition } = fixture();
    const surface = definition.scene.surfaces.baked!;
    surface.interactions.click = { event: "activate", hitPriority: 1, id: "click", kind: "click" };
    surface.states.default!.enabledInteractionIds = ["click"];
    surface.renderIntent.interaction = { events: ["activate"], kind: "regions" };
    cue.trigger = {
      actor: { kind: "system", source: "runtime" },
      event: "activate",
      kind: "semanticEvent",
    };
    const systemResult = validatePresentationDefinition(definition);
    expect(systemResult.valid).toBe(false);
    if (systemResult.valid) {
      throw new Error("Expected a producer diagnostic.");
    }
    expect(
      systemResult.diagnostics.some((item) => item.path.join("/").endsWith("trigger/actor")),
    ).toBe(true);
    cue.trigger = { actor: { kind: "presenter" }, event: "activate", kind: "semanticEvent" };
    const presenterResult = validatePresentationDefinition(definition);
    expect(
      presenterResult.diagnostics.some((item) => item.path.join("/").endsWith("trigger/actor")),
    ).toBe(false);
  });

  it("requires semantic events to be declared on a Surface accessible from the Cue Group", () => {
    const { cue, definition } = fixture();
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
      steps: {
        start: { ...structuredClone(definition.flow.groups.intro!.steps.start!), cues: [] },
      },
    };
    const otherNode = structuredClone(definition.scene.nodes["node-baked"]!);
    if (otherNode.kind !== "surface") {
      throw new TypeError("Expected a SurfaceNode.");
    }
    otherNode.id = "node-other";
    otherNode.surfaceId = "other";
    otherNode.owner = { groupId: "other", kind: "group" };
    otherNode.order = 2;
    definition.scene.nodes["node-other"] = otherNode;
    const otherSurface = structuredClone(definition.scene.surfaces.baked!);
    otherSurface.id = "other";
    otherSurface.hostNodeId = "node-other";
    otherSurface.interactions.click = {
      event: "activate",
      hitPriority: 1,
      id: "click",
      kind: "click",
    };
    otherSurface.renderIntent.interaction = { events: ["activate"], kind: "regions" };
    definition.scene.surfaces.other = otherSurface;
    cue.trigger = { actor: { kind: "presenter" }, event: "activate", kind: "semanticEvent" };
    cue.actions = [];

    expect(codes(definition)).toContain("reference.invalid");
    definition.scene.surfaces.baked!.interactions.click = {
      event: "activate",
      hitPriority: 1,
      id: "click",
      kind: "click",
    };
    definition.scene.surfaces.baked!.renderIntent.interaction = {
      events: ["activate"],
      kind: "regions",
    };
    expect(codes(definition)).toEqual([]);
  });

  it("rejects opacity values outside 0..1 and empty Node patches", () => {
    const { cue, definition } = fixture();
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
        patch: { opacity: { field: "opacity", kind: "eventPayload" } },
      },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [{ kind: "node.patch", nodeId: "node-baked", patch: {} }];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("accepts Presenter tracking selectors and validates Zone ownership", () => {
    const { cue, definition } = fixture();
    definition.stage.zones.near = {
      center: [0, 0, 0],
      id: "near",
      owner: { kind: "presentation" },
      size: [1, 1, 1],
    };
    cue.trigger = {
      actor: { kind: "system", source: "tracking" },
      edge: "enter",
      kind: "zoneEdge",
      subject: { kind: "participant", owner: { kind: "presenter" } },
      zoneId: "near",
    };
    expect(codes(definition)).toEqual([]);
    definition.stage.zones.near.owner = { groupId: "other", kind: "group" };
    expect(codes(definition)).toContain("reference.invalid");
    definition.stage.zones.near.owner = { kind: "presentation" };
    cue.trigger.zoneId = "missing";
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger = {
      actor: { kind: "system", source: "tracking" },
      kind: "motion",
      minimumDistanceMeters: 0.1,
      subject: { kind: "anchor", owner: { kind: "presenter" }, target: "head" },
      windowMilliseconds: 100,
    };
    expect(codes(definition)).toEqual([]);
  });

  it("rejects unsupported media producers and actions explicitly", () => {
    const { cue, definition } = fixture();
    cue.trigger = { kind: "mediaCompleted", surfaceId: "baked" };
    cue.actions = [{ kind: "media.play", surfaceId: "baked" }];
    expect(codes(definition)).toContain("feature.unsupported");
  });
});
