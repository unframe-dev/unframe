import { describe, expect, it } from "vitest";

import type { PresentationDefinition } from "@unframe/contracts/presentation";
import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

type Cue = PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number];

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  definition.flow.timelines.reveal = {
    id: "reveal",
    owner: { kind: "group", groupId: "intro" },
    durationMilliseconds: 1000,
    tracks: [
      {
        target: { nodeId: "node-baked", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1000, value: 1 },
        ],
      },
    ],
  };
  const cue: Cue = {
    id: "cue",
    priority: 1,
    order: 0,
    trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
    firePolicy: { kind: "oncePerStepEntry" },
    actions: [
      { kind: "timeline.play", timelineId: "reveal", completion: "blocking", conflict: "reject" },
    ],
    next: { kind: "stay" },
  };
  definition.flow.groups.intro!.steps.start!.cues = [cue];
  return { definition, cue };
};

const codes = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
};

describe("M3D Timeline Cue semantics", () => {
  it("accepts accessible Timeline play and stop actions", () => {
    const { definition, cue } = fixture();
    expect(codes(definition)).toEqual([]);
    cue.actions = [{ kind: "timeline.stop", timelineId: "reveal" }];
    expect(codes(definition)).toEqual([]);
  });

  it("accepts completion from an accessible Timeline as an implicit System event", () => {
    const { definition, cue } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "reveal" };
    cue.actions = [];
    expect(codes(definition)).toEqual([]);
  });

  it("rejects a client-supplied actor or source on Timeline completion", () => {
    const { definition, cue } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "reveal" };
    cue.actions = [];
    (cue.trigger as unknown as Record<string, unknown>).actor = { kind: "presenter" };
    expect(codes(definition)).toContain("invalid-definition");
    delete (cue.trigger as unknown as Record<string, unknown>).actor;
    (cue.trigger as unknown as Record<string, unknown>).source = "media";
    expect(codes(definition)).toContain("invalid-definition");
  });

  it("rejects missing or inaccessible Timeline action targets", () => {
    const { definition, cue } = fixture();
    cue.actions = [{ kind: "timeline.stop", timelineId: "missing" }];
    expect(codes(definition)).toContain("reference.invalid");
    cue.actions = [
      {
        kind: "timeline.play",
        timelineId: "reveal",
        completion: "nonBlocking",
        conflict: "reject",
      },
    ];
    definition.flow.timelines.reveal!.owner = { kind: "group", groupId: "other" };
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
    };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("rejects missing or inaccessible completion Timeline references", () => {
    const { definition, cue } = fixture();
    cue.trigger = { kind: "timelineCompleted", timelineId: "missing" };
    cue.actions = [];
    expect(codes(definition)).toContain("reference.invalid");
    cue.trigger.timelineId = "reveal";
    definition.flow.timelines.reveal!.owner = { kind: "group", groupId: "other" };
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
    };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("rejects play and Node patch claims on the same property in either order", () => {
    const { definition, cue } = fixture();
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
    const { definition, cue } = fixture();
    cue.actions.push({
      kind: "node.patch",
      nodeId: "node-baked",
      patch: { visible: { kind: "literal", value: true } },
    });
    expect(codes(definition)).toEqual([]);
  });

  it("rejects play/stop, repeated play and stop/patch claims in one batch", () => {
    const { definition, cue } = fixture();
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
    const { definition, cue } = fixture();
    definition.flow.timelines.other = {
      ...structuredClone(definition.flow.timelines.reveal!),
      id: "other",
    };
    cue.actions.push({
      kind: "timeline.play",
      timelineId: "other",
      completion: "nonBlocking",
      conflict: "reject",
    });
    expect(codes(definition)).toContain("behavior.invalid");
  });
});
