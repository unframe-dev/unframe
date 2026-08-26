import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/fixtures/minimal.presentation-definition.v1.json";
import bundleFixture from "../../contracts/presentation/fixtures/minimal.render-bundle.v1.json";
import {
  canonicalizePresentationDefinition,
  hashPresentationDefinition,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";

describe("presentation-core", () => {
  it("reports a stable diagnostic for a structurally invalid definition", () => {
    const result = validatePresentationDefinition({});
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-definition" }),
      );
  });

  it("accepts the first-milestone definition and RenderBundle fixtures", () => {
    expect(validatePresentationDefinition(definitionFixture).valid).toBe(true);
    expect(validateRenderBundle(bundleFixture).valid).toBe(true);
  });

  it("rejects semantic record, tree, quaternion, variable, and artifact references", () => {
    const definition = structuredClone(definitionFixture);
    definition.scene.nodes["surface-node-title"].id = "wrong-id";
    definition.scene.nodes["surface-node-title"].transform.rotation = [0, 0, 0, 2];
    definition.scene.surfaces["surface-title"].contentNodes["text-title"].parentId =
      "missing-frame";
    (definition as unknown as { flow: { variables: Record<string, unknown> } }).flow.variables = {
      count: {
        id: "count",
        owner: { kind: "presentation" },
        type: "number",
        initialValue: "one",
      },
    };
    const definitionResult = validatePresentationDefinition(definition);
    expect(definitionResult.valid).toBe(false);
    if (!definitionResult.valid)
      expect(definitionResult.diagnostics.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          "record-key-id-mismatch",
          "unnormalized-quaternion",
          "missing-parent",
          "variable-type-mismatch",
        ]),
      );

    const bundle = structuredClone(bundleFixture);
    bundle.surfaces["surface-title"].renderSurfaces["render-surface-title"].stateBindings[
      "state-default"
    ] = {
      kind: "artifacts",
      artifactIds: ["missing"],
    };
    const bundleResult = validateRenderBundle(bundle);
    expect(bundleResult.valid).toBe(false);
    if (!bundleResult.valid)
      expect(bundleResult.diagnostics.map((item) => item.code)).toContain("missing-artifact");
  });

  it("canonicalizes without mutating input and hashes the exact canonical Definition", () => {
    const definition = structuredClone(definitionFixture);
    const before = structuredClone(definition);
    const canonicalResult = canonicalizePresentationDefinition(definition);
    expect(canonicalResult.valid).toBe(true);
    if (!canonicalResult.valid) return;
    const canonical = canonicalResult.value;
    expect(definition).toEqual(before);
    const reparsed = canonicalizePresentationDefinition(JSON.parse(canonical));
    expect(reparsed).toEqual({ valid: true, value: canonical, diagnostics: [] });
    const hash = hashPresentationDefinition(definition);
    expect(hash.valid && hash.value).toMatch(/^sha256:[0-9a-f]{64}$/);

    const bundle = structuredClone(bundleFixture);
    if (!hash.valid) return;
    bundle.definitionHash = hash.value;
    expect(validatePresentationArtifacts(definition, bundle).valid).toBe(true);
    bundle.definitionHash = "sha256:wrong";
    const result = validatePresentationArtifacts(definition, bundle);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((item) => item.code)).toContain("definition-hash-mismatch");
  });
});
