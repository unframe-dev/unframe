import { describe, expect, it } from "vitest";

import type { PresentationDefinition } from "@unframe/contracts/presentation";
import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

type Timeline = PresentationDefinition["flow"]["timelines"][string];

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  const timeline: Timeline = {
    id: "reveal",
    owner: { kind: "presentation" },
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
  definition.flow.timelines.reveal = timeline;
  return { definition, timeline };
};

const issues = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics;
};

describe("M3D Timeline catalog invariants", () => {
  it("accepts valid number, Vector3 and normalized Quaternion tracks", () => {
    const { definition, timeline } = fixture();
    timeline.tracks.push(
      {
        target: { nodeId: "node-baked", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0, 0], easingToNext: "cubicIn" },
          { timeMilliseconds: 500, value: [1, 2, 3], easingToNext: "cubicOut" },
          { timeMilliseconds: 1000, value: [2, 3, 4] },
        ],
      },
      {
        target: { nodeId: "node-baked", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "linear" },
          { timeMilliseconds: 1000, value: [2, 2, 2] },
        ],
      },
      {
        target: { nodeId: "node-baked", property: "transform.rotation" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0, 0, 1], easingToNext: "linear" },
          { timeMilliseconds: 1000, value: [0, 0, 0, 1] },
        ],
      },
    );
    expect(issues(definition)).toEqual([]);
  });

  it("checks Timeline identity and owner Group reference", () => {
    const { definition, timeline } = fixture();
    timeline.id = "wrong";
    timeline.owner = { kind: "group", groupId: "missing" };
    expect(issues(definition).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["record-key-id-mismatch", "missing-owner-group"]),
    );
  });

  it("requires an existing all-audience target with a compatible owner", () => {
    const { definition, timeline } = fixture();
    timeline.tracks[0]!.target.nodeId = "missing";
    expect(issues(definition).map((issue) => issue.code)).toContain("reference.invalid");

    timeline.tracks[0]!.target.nodeId = "node-baked";
    definition.scene.nodes["node-baked"]!.audience = { kind: "role", role: "presenter" };
    expect(issues(definition).map((issue) => issue.code)).toContain("graph.invalid");

    definition.scene.nodes["node-baked"]!.audience = { kind: "all" };
    definition.scene.nodes["node-baked"]!.owner = { kind: "group", groupId: "intro" };
    expect(issues(definition).map((issue) => issue.code)).toContain("graph.invalid");

    timeline.owner = { kind: "group", groupId: "intro" };
    expect(issues(definition)).toEqual([]);
  });

  it("rejects a Group Timeline targeting a different Group", () => {
    const { definition, timeline } = fixture();
    timeline.owner = { kind: "group", groupId: "intro" };
    definition.flow.groups.other = {
      ...structuredClone(definition.flow.groups.intro!),
      id: "other",
    };
    definition.scene.nodes["node-baked"]!.owner = { kind: "group", groupId: "other" };
    expect(issues(definition).map((issue) => issue.code)).toContain("graph.invalid");
  });

  it.each([
    ["opacity", -0.1],
    ["opacity", 1.1],
    ["opacity", [0, 0, 0]],
    ["transform.position", 1],
    ["transform.scale", [0, 1, 1]],
    ["transform.rotation", [0, 0, 0, 0]],
    ["transform.rotation", [0, 0, 0, 2]],
  ] as const)("rejects invalid %s value %#", (property, value) => {
    const { definition, timeline } = fixture();
    timeline.tracks[0]!.target.property = property;
    timeline.tracks[0]!.keyframes[0]!.value =
      value as Timeline["tracks"][number]["keyframes"][number]["value"];
    expect(issues(definition).map((issue) => issue.code)).toContain("behavior.invalid");
  });

  it.each([{ value: [0, 0, 0, -1] }, { value: [-1, 0, 0, 0] }, { value: [-0, 0, 0, 1] }])(
    "rejects noncanonical Timeline Quaternion $value",
    ({ value }) => {
      const { definition, timeline } = fixture();
      timeline.tracks[0]!.target.property = "transform.rotation";
      timeline.tracks[0]!.keyframes[1]!.value = [0, 0, 0, 1];
      timeline.tracks[0]!.keyframes[0]!.value = value as [number, number, number, number];
      expect(issues(definition)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "behavior.invalid",
            path: ["flow", "timelines", "reveal", "tracks", "0", "keyframes", "0", "value"],
          }),
        ]),
      );
    },
  );

  it("requires exact endpoints and strictly increasing keyframe times", () => {
    const { definition, timeline } = fixture();
    timeline.tracks[0]!.keyframes = [
      { timeMilliseconds: 1, value: 0, easingToNext: "linear" },
      { timeMilliseconds: 1, value: 0.5, easingToNext: "linear" },
      { timeMilliseconds: 999, value: 1 },
    ];
    expect(issues(definition).map((issue) => issue.code)).toContain("behavior.invalid");
  });

  it("requires easing on each nonfinal keyframe and forbids it on the final one", () => {
    const { definition, timeline } = fixture();
    delete timeline.tracks[0]!.keyframes[0]!.easingToNext;
    timeline.tracks[0]!.keyframes[1]!.easingToNext = "linear";
    expect(issues(definition).filter((issue) => issue.code === "behavior.invalid")).toHaveLength(2);
  });

  it("rejects duplicate target/property claims within one Timeline", () => {
    const { definition, timeline } = fixture();
    timeline.tracks.push(structuredClone(timeline.tracks[0]!));
    expect(issues(definition).map((issue) => issue.code)).toContain("identity.invalid");
  });
});
