import { describe, expect, it } from "vitest";

import {
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const fixture = () => {
  const { definition, renderBundle } = makeM3AArtifacts();
  const surface = definition.scene.surfaces.baked!;
  const text = surface.contentNodes.text!;
  text.semanticNodeId = "button";
  surface.baseSemanticTree = {
    rootNodeIds: ["button"],
    nodes: {
      button: {
        id: "button",
        parentId: null,
        order: 0,
        role: "button",
        interactionId: "click",
        text: "Click",
      },
    },
  };
  surface.interactions.click = { id: "click", kind: "click", event: "click", hitPriority: 7 };
  surface.states.default!.enabledInteractionIds = ["click"];
  surface.renderIntent.interaction = { kind: "regions", events: ["click"] };
  renderBundle.surfaces.baked!.semanticsByState.default = {
    rootNodeIds: ["button"],
    nodes: {
      button: {
        id: "button",
        parentId: null,
        order: 0,
        role: "button",
        interactionId: "click",
        text: "Click",
        stateEnabled: true,
      },
    },
  };
  renderBundle.surfaces.baked!.interactionsByState.default = [
    {
      interactionId: "click",
      semanticNodeId: "button",
      bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
      coordinateSpace: "normalized",
      priority: 7,
    },
  ];
  return { definition, renderBundle, surface };
};

describe("M3B semantic and interaction invariants", () => {
  it("accepts a button enabled by a State with a matching region", () => {
    const { definition, renderBundle } = fixture();
    expect(validatePresentationDefinition(definition).valid).toBe(true);
    expect(validateRenderBundle(renderBundle).valid).toBe(true);
  });

  it("rejects unknown enabled interactions and invalid override targets", () => {
    const { definition, surface } = fixture();
    surface.states.default!.enabledInteractionIds = ["missing"];
    surface.states.default!.semanticOverrides = [{ nodes: { button: { alt: "no" } } }];
    expect(validatePresentationDefinition(definition).valid).toBe(false);
  });

  it("rejects out-of-bounds and duplicate regions", () => {
    const { renderBundle } = fixture();
    const regions = renderBundle.surfaces.baked!.interactionsByState.default!;
    regions[0]!.bounds.x = 0.75;
    expect(validateRenderBundle(renderBundle).valid).toBe(false);
    regions[0]!.bounds.x = 0;
    regions.push({ ...regions[0]!, priority: 8 });
    expect(validateRenderBundle(renderBundle).valid).toBe(false);
  });

  it("rejects region references that disagree with completed buttons", () => {
    const { renderBundle } = fixture();
    renderBundle.surfaces.baked!.interactionsByState.default![0]!.semanticNodeId = "missing";
    expect(validateRenderBundle(renderBundle).valid).toBe(false);
  });

  it("requires canonical Hit Region order", () => {
    const { renderBundle } = fixture();
    const regions = renderBundle.surfaces.baked!.interactionsByState.default!;
    regions.push({
      ...regions[0]!,
      bounds: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      priority: 8,
    });
    expect(validateRenderBundle(renderBundle).valid).toBe(false);
  });

  it("rejects mismatched Definition interaction priority across artifacts", () => {
    const { definition, renderBundle, surface } = fixture();
    surface.interactions.click!.hitPriority = 8;
    renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
    expect(validatePresentationArtifacts(definition, renderBundle).valid).toBe(false);
  });

  it("rejects incomplete list structure and malformed language tags", () => {
    const { definition, surface } = fixture();
    surface.baseSemanticTree.nodes.button = {
      id: "button",
      parentId: null,
      order: 0,
      role: "list",
      ordered: false,
    };
    expect(validatePresentationDefinition(definition).valid).toBe(false);
    surface.baseSemanticTree.nodes.button = {
      id: "button",
      parentId: null,
      order: 0,
      role: "button",
      interactionId: "click",
      text: "Click",
      language: "not_a_tag",
    };
    expect(validatePresentationDefinition(definition).valid).toBe(false);
    surface.baseSemanticTree.nodes.button = {
      id: "button",
      parentId: null,
      order: 0,
      role: "button",
      interactionId: "click",
      text: "\uD800",
    };
    expect(validatePresentationDefinition(definition).valid).toBe(false);
  });

  it("applies the current texture policy State and pixel limits", () => {
    const { renderBundle } = fixture();
    const policy = renderBundle.buildContext.textureBuildPolicy;
    policy.maxStatesPerRenderSurface = 1;
    policy.maxRenderedPixels = 1;
    const { policyHash: _hash, ...payload } = policy;
    policy.policyHash = hashCanonicalJsonPayload(payload);
    const result = validateRenderBundle(renderBundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((item) => item.code)).toContain("budget.exceeded");
  });

  it("accepts ordered multi-partition bindings for the same State", () => {
    const { renderBundle } = fixture();
    const surface = renderBundle.surfaces.baked!;
    const first = surface.renderSurfaces["render-baked"]!;
    const second = structuredClone(first);
    second.id = "render-second";
    second.layer = 1;
    const artifact = second.artifacts["artifact-baked"]!;
    delete second.artifacts["artifact-baked"];
    artifact.id = "artifact-second";
    second.artifacts["artifact-second"] = artifact;
    second.stateBindings.default = { kind: "artifacts", artifactIds: ["artifact-second"] };
    surface.renderSurfaceIds.push("render-second");
    surface.renderSurfaces["render-second"] = second;
    expect(validateRenderBundle(renderBundle).valid).toBe(true);
    surface.renderSurfaceIds.reverse();
    expect(validateRenderBundle(renderBundle).valid).toBe(false);
  });
});
