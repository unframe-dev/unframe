import { describe, expect, it } from "vitest";

import {
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  validatePresentationDefinition,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const opaqueFixture = () => {
  const { definition } = makeM3AArtifacts();
  const surface = definition.scene.surfaces.baked!;
  surface.content = { bindings: { label: "label" }, kind: "opaque" };
  return { definition, surface };
};

const codes = (definition: ReturnType<typeof opaqueFixture>["definition"]) => {
  const result = validatePresentationDefinition(definition);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("opaque Surface content", () => {
  it("accepts a complete binding without a structured content tree", () => {
    const { definition } = opaqueFixture();
    expect(codes(definition)).toEqual([]);
  });

  it("keeps aggregate Definition and RenderBundle validation available", () => {
    const { definition, renderBundle } = makeM3AArtifacts();
    definition.scene.surfaces.baked!.content = { bindings: { label: "label" }, kind: "opaque" };
    renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
    expect(validatePresentationArtifacts(definition, renderBundle).valid).toBe(true);
  });

  it("requires every base semantic node to have exactly one binding", () => {
    const { definition, surface } = opaqueFixture();
    if (surface.content.kind !== "opaque") {
      throw new TypeError("Expected opaque content.");
    }
    surface.content.bindings = {};
    expect(codes(definition)).toContain("graph.invalid");
    surface.content.bindings = { duplicate: "label", label: "label" };
    expect(codes(definition)).toContain("identity.invalid");
    surface.content.bindings = { label: "missing" };
    expect(codes(definition)).toContain("reference.invalid");
  });

  it("rejects content overrides while preserving semantic State validation", () => {
    const { definition, surface } = opaqueFixture();
    surface.states.default!.contentOverrides = { label: { kind: "text" } };
    expect(codes(definition)).toContain("behavior.invalid");
    surface.states.default!.contentOverrides = {};
    surface.states.default!.semanticOverrides = [{ nodes: { missing: { text: "invalid" } } }];
    expect(codes(definition)).toContain("reference.invalid");
  });
});
