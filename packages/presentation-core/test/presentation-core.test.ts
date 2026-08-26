import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/fixtures/minimal.presentation-definition.v1.json";
import bundleFixture from "../../contracts/presentation/fixtures/minimal.render-bundle.v1.json";
import {
  canonicalizePresentationDefinition,
  hashPresentationDefinition,
  materializeCompletedSemanticTree,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";

describe("presentation-core", () => {
  it("materializes a state and rejects unknown or hostile surfaces", () => {
    const surface = definitionFixture.scene.surfaces["surface-title"] as never;
    expect(materializeCompletedSemanticTree(surface, "state-default").valid).toBe(true);
    expect(materializeCompletedSemanticTree(surface, "missing").valid).toBe(false);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    );
    expect(materializeCompletedSemanticTree(hostile as never, "state-default").valid).toBe(false);
  });
  it("applies semantic inclusion and null text overrides", () => {
    const surface = structuredClone(definitionFixture.scene.surfaces["surface-title"]) as never as {
      states: Record<string, { semanticOverrides: unknown[] }>;
      baseSemanticTree: { nodes: Record<string, { text?: string }> };
    };
    surface.states["state-default"]!.semanticOverrides = [
      { nodes: { "semantic-title": { included: false } } },
    ];
    surface.baseSemanticTree.nodes["semantic-title"] = {
      ...surface.baseSemanticTree.nodes["semantic-title"],
      text: "Hello",
    };
    const result = materializeCompletedSemanticTree(surface as never, "state-default");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.nodes["semantic-title"]).toBeUndefined();
    const textSurface = structuredClone(
      definitionFixture.scene.surfaces["surface-title"],
    ) as never as typeof surface;
    textSurface.states["state-default"]!.semanticOverrides = [
      { nodes: { "semantic-title": { text: null } } },
    ];
    textSurface.baseSemanticTree.nodes["semantic-title"] = {
      ...textSurface.baseSemanticTree.nodes["semantic-title"],
      text: "Hello",
    };
    const textResult = materializeCompletedSemanticTree(textSurface as never, "state-default");
    expect(textResult.valid).toBe(true);
    if (textResult.valid) expect(textResult.value.nodes["semantic-title"]?.text).toBeUndefined();
  });
  it("rejects prototype states, malformed trees, and unknown semantic overrides", () => {
    const surface = structuredClone(
      definitionFixture.scene.surfaces["surface-title"],
    ) as never as Record<string, unknown>;
    expect(
      materializeCompletedSemanticTree(
        { ...surface, states: Object.create({ __proto__: {} }) } as never,
        "__proto__",
      ).valid,
    ).toBe(false);
    expect(
      materializeCompletedSemanticTree(
        { ...surface, baseSemanticTree: {} } as never,
        "state-default",
      ).valid,
    ).toBe(false);
    const overridden = structuredClone(surface) as {
      states: Record<string, { semanticOverrides: unknown[] }>;
    };
    overridden.states["state-default"]!.semanticOverrides = [{ nodes: { missing: { text: "x" } } }];
    const result = materializeCompletedSemanticTree(overridden as never, "state-default");
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("missing-semantic-node");
  });
  it("fails closed for malformed semantic materialization inputs", () => {
    const makeSurface = () =>
      structuredClone(definitionFixture.scene.surfaces["surface-title"]) as {
        baseSemanticTree: {
          rootNodeIds: unknown[];
          nodes: Record<string, Record<string, unknown>>;
        };
        states: Record<string, { semanticOverrides: unknown[] }>;
      };
    const malformedTrees = [
      (surface: ReturnType<typeof makeSurface>) => {
        delete surface.baseSemanticTree.nodes["semantic-title"];
      },
      (surface: ReturnType<typeof makeSurface>) => {
        surface.baseSemanticTree.nodes["semantic-title"]!.id = "other-id";
      },
      (surface: ReturnType<typeof makeSurface>) => {
        surface.baseSemanticTree.rootNodeIds = ["missing-root"];
      },
    ];
    for (const mutate of malformedTrees) {
      const surface = makeSurface();
      mutate(surface);
      expect(materializeCompletedSemanticTree(surface as never, "state-default").valid).toBe(false);
    }

    const malformedOverrides = [
      (surface: ReturnType<typeof makeSurface>) => {
        const overrides: unknown[] = [{ nodes: {} }];
        overrides.length = 2;
        surface.states["state-default"]!.semanticOverrides = overrides;
      },
      (surface: ReturnType<typeof makeSurface>) => {
        surface.states["state-default"]!.semanticOverrides = [{}];
      },
      (surface: ReturnType<typeof makeSurface>) => {
        surface.states["state-default"]!.semanticOverrides = [
          { nodes: { "semantic-title": { text: 1 } } },
        ];
      },
      (surface: ReturnType<typeof makeSurface>) => {
        surface.states["state-default"]!.semanticOverrides = [
          { nodes: { "semantic-title": { included: "false", language: 1, alt: false } } },
        ];
      },
    ];
    for (const mutate of malformedOverrides) {
      const surface = makeSurface();
      mutate(surface);
      expect(materializeCompletedSemanticTree(surface as never, "state-default").valid).toBe(false);
    }

    const definition = structuredClone(definitionFixture) as {
      scene: {
        surfaces: Record<string, { states: Record<string, { semanticOverrides: unknown[] }> }>;
      };
    };
    const overrides: unknown[] = [{ nodes: {} }];
    overrides.length = 2;
    definition.scene.surfaces["surface-title"]!.states["state-default"]!.semanticOverrides =
      overrides;
    expect(() => validatePresentationDefinition(definition)).not.toThrow();
    expect(validatePresentationDefinition(definition).valid).toBe(false);
  });
  it("rejects prototype-key semantic overrides without mutating Object.prototype", () => {
    const surface = structuredClone(definitionFixture.scene.surfaces["surface-title"]) as {
      states: Record<string, { semanticOverrides: unknown[] }>;
    };
    const nodes: Record<string, unknown> = {};
    Object.defineProperty(nodes, "__proto__", {
      value: { text: "polluted" },
      enumerable: true,
    });
    surface.states["state-default"]!.semanticOverrides = [{ nodes }];

    const before = (Object.prototype as { text?: unknown }).text;
    const result = materializeCompletedSemanticTree(surface as never, "state-default");

    expect(result.valid).toBe(false);
    expect((Object.prototype as { text?: unknown }).text).toBe(before);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("missing-semantic-node");
  });
  it("reports a stable diagnostic for a structurally invalid definition", () => {
    const result = validatePresentationDefinition({});
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-definition" }),
      );
  });

  it("rejects unknown SurfaceNode fields", () => {
    const definition = structuredClone(definitionFixture) as typeof definitionFixture & {
      scene: { nodes: Record<string, Record<string, unknown>> };
    };
    (definition.scene.nodes["surface-node-title"] as Record<string, unknown>).source = {
      leaked: true,
    };
    const result = validatePresentationDefinition(definition);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "unknown-surface-node-property" }),
      );
  });

  it("rejects malformed asset descriptors", () => {
    const definition = structuredClone(definitionFixture) as typeof definitionFixture & {
      assets: Record<string, unknown>;
    };
    definition.assets["asset-invalid"] = {
      id: "asset-invalid",
      mediaType: 123,
      checksum: null,
    };

    const result = validatePresentationDefinition(definition);

    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("invalid-asset");
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
