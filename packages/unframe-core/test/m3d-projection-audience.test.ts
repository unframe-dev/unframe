import { describe, expect, it } from "vitest";

import { validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const fixture = () => {
  const { definition } = makeM3AArtifacts();
  const surfaceNode = definition.scene.nodes["node-baked"]!;
  if (surfaceNode.kind !== "surface") throw new TypeError("Expected a SurfaceNode.");
  const { surfaceId: _surfaceId, ...container } = surfaceNode;
  definition.scene.nodes.ancestor = {
    ...structuredClone(container),
    id: "ancestor",
    kind: "container",
    order: 0,
  };
  surfaceNode.parent = { kind: "node", nodeId: "ancestor" };
  surfaceNode.order = 0;
  return { definition, surfaceNode, ancestor: definition.scene.nodes.ancestor! };
};

const issues = (definition: unknown) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics;
};

describe("M3D ProjectionAudience reference closure", () => {
  it("accepts all-to-all, role-to-all and same-role Spatial parent references", () => {
    const { definition, surfaceNode, ancestor } = fixture();
    expect(issues(definition)).toEqual([]);
    surfaceNode.audience = { kind: "role", role: "presenter" };
    expect(issues(definition)).toEqual([]);
    ancestor.audience = { kind: "role", role: "presenter" };
    expect(issues(definition)).toEqual([]);
  });

  it("rejects an all-audience child beneath a role-limited ancestor", () => {
    const { definition, ancestor } = fixture();
    ancestor.audience = { kind: "role", role: "presenter" };
    expect(issues(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.invalid",
          path: ["scene", "nodes", "node-baked", "parent", "nodeId"],
        }),
      ]),
    );
  });

  it("rejects a Spatial reference across Presenter and Viewer roles", () => {
    const { definition, surfaceNode, ancestor } = fixture();
    surfaceNode.audience = { kind: "role", role: "presenter" };
    ancestor.audience = { kind: "role", role: "viewer" };
    expect(issues(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "graph.invalid",
          path: ["scene", "nodes", "node-baked", "parent", "nodeId"],
        }),
      ]),
    );
  });

  it("allows a role-limited Surface host and inherits its audience", () => {
    const { definition, surfaceNode } = fixture();
    surfaceNode.audience = { kind: "role", role: "viewer" };
    expect(issues(definition)).toEqual([]);
  });

  it("keeps Timeline targets restricted to all-audience Nodes", () => {
    const { definition, surfaceNode } = fixture();
    surfaceNode.audience = { kind: "role", role: "presenter" };
    definition.flow.timelines.reveal = {
      id: "reveal",
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
    expect(issues(definition)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "graph.invalid" })]),
    );
  });
});
