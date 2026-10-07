import { describe, expect, it } from "vitest";
import { presentationDefinitionSchema } from "@unframe/contracts/presentation";
import fixture from "../../contracts/presentation/fixtures/initial-runtime-state.json";
import { createInitialRuntimeState } from "../src/index.js";

const definition = () => presentationDefinitionSchema.parse(fixture.definition);

describe("declarative initial Runtime state", () => {
  it("matches the Go conformance subset without advancing progression or adding fences", () => {
    expect(createInitialRuntimeState(definition())).toEqual(fixture.expected);
  });
  it("keeps declarative flags when timer Cues would later change them", () => {
    const input = definition();
    input.flow.groups.intro!.steps.start!.cues = [
      {
        id: "hide",
        priority: 0,
        order: 0,
        trigger: { kind: "timer", afterMilliseconds: 10 },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "node.patch",
            nodeId: "node-baked",
            patch: { opacity: { kind: "literal", value: 0 } },
          },
        ],
        next: { kind: "stay" },
      },
    ];
    expect(createInitialRuntimeState(input)).toEqual(fixture.expected);
  });

  it("does not mutate or retain the Definition transforms", () => {
    const input = definition();
    const result = createInitialRuntimeState(input);
    input.scene.nodes["node-baked"]!.transform.position[0] = 99;
    expect(result).toEqual(fixture.expected);
  });

  it("rejects undeclared initial Group and Surface State references", () => {
    const group = definition();
    group.flow.initialGroupId = "unknown";
    expect(() => createInitialRuntimeState(group)).toThrow("initialGroupId");
    const surface = definition();
    surface.scene.surfaces.baked!.initialStateId = "unknown";
    expect(() => createInitialRuntimeState(surface)).toThrow("Initial State does not exist");
  });
});
