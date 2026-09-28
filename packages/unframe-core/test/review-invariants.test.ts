import { describe, expect, it } from "vitest";

import {
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const codes = (result: ReturnType<typeof validatePresentationDefinition>) =>
  result.valid ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);

describe("PresentationDefinition v2 semantic invariants", () => {
  it("rejects mismatched record keys and missing references", () => {
    const { definition } = makeM3AArtifacts();
    definition.scene.nodes["wrong-key"] = definition.scene.nodes["node-baked"]!;
    delete definition.scene.nodes["node-baked"];

    expect(codes(validatePresentationDefinition(definition))).toEqual(
      expect.arrayContaining(["record-key-id-mismatch", "reference.invalid"]),
    );
  });

  it("rejects spatial cycles", () => {
    const { definition } = makeM3AArtifacts();
    const original = definition.scene.nodes["node-baked"]!;
    if (original.kind !== "surface") throw new TypeError("Expected SurfaceNode fixture.");
    const { surfaceId: _surfaceId, ...containerBase } = original;
    definition.scene.nodes.container = {
      ...structuredClone(containerBase),
      id: "container",
      kind: "container",
      parent: { kind: "node", nodeId: "node-baked" },
    };
    original.parent = { kind: "node", nodeId: "container" };

    expect(codes(validatePresentationDefinition(definition))).toEqual(
      expect.arrayContaining(["graph.invalid"]),
    );
  });

  it("rejects non-unit and non-canonical spatial quaternions", () => {
    const { definition } = makeM3AArtifacts();
    definition.scene.nodes["node-baked"]!.transform.rotation = [0, 0, 0, -2];

    expect(codes(validatePresentationDefinition(definition))).toContain("graph.invalid");
  });

  it("rejects broken content trees and incompatible semantic roles", () => {
    const { definition } = makeM3AArtifacts();
    const surface = definition.scene.surfaces.baked!;
    const root = surface.contentNodes.root;
    if (root?.kind !== "frame") throw new TypeError("Expected baked Frame root.");
    root.children = ["text", "missing"];
    surface.baseSemanticTree.nodes.label = {
      id: "label",
      parentId: null,
      order: 0,
      role: "image",
      alt: "label",
    };

    expect(codes(validatePresentationDefinition(definition))).toEqual(
      expect.arrayContaining(["missing-child", "graph.invalid"]),
    );
  });

  it("accepts a valid State visual override", () => {
    const { definition } = makeM3AArtifacts();
    definition.scene.surfaces.baked!.states.default!.contentOverrides.text = {
      kind: "text",
      value: { kind: "literal", value: "changed" },
    };

    expect(validatePresentationDefinition(definition).valid).toBe(true);
  });
});

describe("RenderBundle v2 semantic invariants", () => {
  it("rejects a stale texture build policy hash", () => {
    const { renderBundle } = makeM3AArtifacts();
    renderBundle.buildContext.textureBuildPolicy.longEdgePixels += 1;

    const result = validateRenderBundle(renderBundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("hash.invalid");
  });

  it("requires one texture whose descriptor and feature set agree", () => {
    const { renderBundle } = makeM3AArtifacts();
    const artifact =
      renderBundle.surfaces.baked!.renderSurfaces["render-baked"]!.artifacts["artifact-baked"];
    if (artifact?.kind !== "baked-web") throw new TypeError("Expected baked fixture.");
    artifact.states.default!.texture.gpuBytes = 1;
    artifact.requiredFeatures = ["png"];

    const result = validateRenderBundle(renderBundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(["artifact.invalid"]),
      );
  });

  it("requires exact surface State sets and artifact bindings", () => {
    const { renderBundle } = makeM3AArtifacts();
    delete renderBundle.surfaces.baked!.renderSurfaces["render-baked"]!.stateBindings.default;

    const result = validateRenderBundle(renderBundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("artifact.invalid");
  });

  it("rejects non-baked artifacts without presenting them as implemented", () => {
    const full = structuredClone(makeM3AArtifacts().renderBundle);
    const renderSurface = full.surfaces.baked!.renderSurfaces["render-baked"]!;
    const artifact = renderSurface.artifacts["artifact-baked"]!;
    if (artifact.kind !== "baked-web") throw new TypeError("Expected baked fixture.");
    renderSurface.artifacts["artifact-baked"] = {
      id: artifact.id,
      kind: "video",
      contractVersion: 1,
      requiredFeatures: ["h264"],
      assetId: "video",
      checksum: `sha256:${"0".repeat(64)}`,
      encodedSizeBytes: 1,
      mediaType: "video/mp4",
      codec: "h264",
      durationMilliseconds: 1,
      loop: false,
      alpha: false,
      audio: false,
      pixelSize: [1, 1],
    };

    const result = validateRenderBundle(full);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "feature.unsupported",
      );
  });

  it("detects definition hash drift across artifacts", () => {
    const { definition, renderBundle } = makeM3AArtifacts();
    definition.metadata.title = "Changed";
    expect(renderBundle.definitionHash).not.toBe(hashCanonicalJsonPayload(definition));

    const result = validatePresentationArtifacts(definition, renderBundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("hash.invalid");
  });
});
