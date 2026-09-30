import { describe, expect, it } from "vitest";

import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";
import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

type Cue = PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  definition.flow.timelines.reveal = {
    durationMilliseconds: 1000,
    id: "reveal",
    owner: { groupId: "intro", kind: "group" },
    tracks: [
      {
        keyframes: [
          { easingToNext: "linear", timeMilliseconds: 0, value: 0 },
          { timeMilliseconds: 1000, value: 1 },
        ],
        target: { nodeId: "node-baked", property: "opacity" },
      },
    ],
  };
  const cue: Cue = {
    actions: [
      { completion: "blocking", conflict: "reject", kind: "timeline.play", timelineId: "reveal" },
    ],
    firePolicy: { kind: "oncePerStepEntry" },
    id: "cue",
    next: { kind: "stay" },
    order: 0,
    priority: 1,
    trigger: { action: "next", actor: { kind: "presenter" }, kind: "logicalInput" },
  };
  definition.flow.groups.intro!.steps.start!.cues = [cue];
  return { cue, definition };
};

const codes = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
};

describe("M3D Timeline Cue semantics", () => {
  it("accepts accessible Timeline play and stop actions", () => {
    const { cue, definition } = fixture();
    expect(codes(definition)).toEqual([]);
    cue.actions = [{ kind: "timeline.stop", timelineId: "reveal" }];
    expect(codes(definition)).toEqual([]);
  });

  it("accepts completion from an accessible Timeline as an implicit System event", () => {
    const { cue, definition } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "reveal" };
    cue.actions = [];
    expect(codes(definition)).toEqual([]);
  });

  it("rejects a client-supplied actor or source on Timeline completion", () => {
    const { cue, definition } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "reveal" };
    cue.actions = [];
    (cue.trigger as unknown as Record<string, unknown>).actor = { kind: "presenter" };
    expect(codes(definition)).toContain("invalid-definition");
    delete (cue.trigger as unknown as Record<string, unknown>).actor;
    (cue.trigger as unknown as Record<string, unknown>).source = "media";
    expect(codes(definition)).toContain("invalid-definition");
  });

  it("rejects missing or inaccessible Timeline action targets", () => {
    const { cue, definition } = fixture();
    cue.actions = [{ kind: "timeline.stop", timelineId: "missing" }];
    expect(codes(definition)).toContain("reference.invalid");
    cue.actions = [
      {
        completion: "nonBlocking",
        conflict: "reject",
        kind: "timeline.play",
        timelineId: "reveal",
      },
    ];
    definition.flow.timelines.reveal!.owner = { groupId: "other", kind: "group" };
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
    };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("rejects missing or inaccessible completion Timeline references", () => {
    const { cue, definition } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "missing" };
    cue.actions = [];
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger.timelineId = "reveal";
    definition.flow.timelines.reveal!.owner = { groupId: "other", kind: "group" };
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
    };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("rejects play and Node patch claims on the same property in either order", () => {
    const { cue, definition } = fixture();
    const patch: Cue["actions"][number] = {
      kind: "node.patch",
      nodeId: "node-baked",
      patch: { opacity: { kind: "literal", value: 0.5 } },
    };
    const play = cue.actions[0]!;
    cue.actions = [patch, play];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [play, patch];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("allows a Node patch on a different property", () => {
    const { cue, definition } = fixture();
    cue.actions.push({
      kind: "node.patch",
      nodeId: "node-baked",
      patch: { visible: { kind: "literal", value: true } },
    });
    expect(codes(definition)).toEqual([]);
  });

  it("rejects play/stop, repeated play and stop/patch claims in one batch", () => {
    const { cue, definition } = fixture();
    const play = cue.actions[0]!;
    cue.actions = [play, { kind: "timeline.stop", timelineId: "reveal" }];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [play, structuredClone(play)];
    expect(codes(definition)).toContain("behavior.invalid");
    cue.actions = [
      { kind: "timeline.stop", timelineId: "reveal" },
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { opacity: { kind: "literal", value: 0.5 } },
      },
    ];
    expect(codes(definition)).toContain("behavior.invalid");
  });

  it("rejects claims from distinct Timelines targeting the same Node property", () => {
    const { cue, definition } = fixture();
    definition.flow.timelines.other = {
      ...structuredClone(definition.flow.timelines.reveal!),
      id: "other",
    };
    cue.actions.push({
      completion: "nonBlocking",
      conflict: "reject",
      kind: "timeline.play",
      timelineId: "other",
    });
    expect(codes(definition)).toContain("behavior.invalid");
  });
});
