import { readFile } from "node:fs/promises";

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

type MutableRecord = Record<string, unknown>;

const recordAt = (value: unknown, ...path: string[]): MutableRecord => {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current))
      throw new TypeError(`Expected object at ${path.join("/")}`);
    current = (current as MutableRecord)[segment];
  }
  if (typeof current !== "object" || current === null || Array.isArray(current))
    throw new TypeError(`Expected object at ${path.join("/")}`);
  return current as MutableRecord;
};

const definitionCodes = (value: unknown) => {
  const result = validatePresentationDefinition(value);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

const pair = () => {
  const definition = structuredClone(definitionFixture);
  const bundle = structuredClone(bundleFixture);
  const hash = hashPresentationDefinition(definition);
  if (!hash.valid) throw new TypeError("The definition fixture must be hashable.");
  recordAt(bundle).definitionHash = hash.value;
  return { definition, bundle };
};

const makeInteractive = () => {
  const artifacts = pair();
  const surface = recordAt(artifacts.definition, "scene", "surfaces", "surface-title");
  surface.interactions = {
    tap: { id: "tap", kind: "click", event: "tap-event" },
  };
  recordAt(surface, "states", "state-default").enabledInteractionIds = ["tap"];
  recordAt(surface, "renderIntent").interaction = {
    kind: "regions",
    events: ["tap-event"],
  };
  recordAt(surface, "baseSemanticTree", "nodes", "semantic-title").interactionId = "tap";
  recordAt(
    artifacts.bundle,
    "surfaces",
    "surface-title",
    "semanticsByState",
    "state-default",
    "nodes",
    "semantic-title",
  ).interactionId = "tap";
  recordAt(artifacts.bundle, "surfaces", "surface-title", "interactionsByState")["state-default"] =
    [
      {
        interactionId: "tap",
        semanticNodeId: "semantic-title",
        event: "tap-event",
        priority: 0,
        coordinateSpace: "normalized",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];
  const hash = hashPresentationDefinition(artifacts.definition);
  if (!hash.valid) throw new TypeError("The interactive definition must be hashable.");
  recordAt(artifacts.bundle).definitionHash = hash.value;
  return artifacts;
};

const artifactCodes = (definition: unknown, bundle: unknown) => {
  const result = validatePresentationArtifacts(definition, bundle);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("definition semantic invariants", () => {
  it("rejects missing group owners and shorter-lifetime Spatial parents", () => {
    const missingOwner = structuredClone(definitionFixture);
    recordAt(missingOwner, "flow", "variables", "optional-subtitle").owner = {
      kind: "group",
      groupId: "missing",
    };
    expect(definitionCodes(missingOwner)).toContain("missing-owner-group");

    const invalidLifetime = structuredClone(definitionFixture);
    const nodes = recordAt(invalidLifetime, "scene", "nodes");
    recordAt(nodes, "surface-node-title").owner = {
      kind: "group",
      groupId: "group-intro",
    };
    nodes["surface-node-child"] = {
      ...structuredClone(recordAt(nodes, "surface-node-title")),
      id: "surface-node-child",
      owner: { kind: "presentation" },
      parent: { kind: "node", nodeId: "surface-node-title" },
      surfaceId: "surface-child",
    };
    const surfaces = recordAt(invalidLifetime, "scene", "surfaces");
    surfaces["surface-child"] = {
      ...structuredClone(recordAt(surfaces, "surface-title")),
      id: "surface-child",
      hostNodeId: "surface-node-child",
    };
    expect(definitionCodes(invalidLifetime)).toContain("invalid-owner-parent-lifetime");
  });

  it("rejects incomplete finite-state models and every Scalar type mismatch", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value, "scene", "surfaces", "surface-title", "renderIntent").updateModel = {
      kind: "finite-state",
      stateIds: ["missing"],
    };
    const variable = recordAt(value, "flow", "variables", "optional-subtitle");
    variable.type = "null";
    variable.initialValue = true;
    expect(definitionCodes(value)).toEqual(
      expect.arrayContaining(["render-intent-state-set-mismatch", "variable-type-mismatch"]),
    );
  });

  it("rejects invalid Frame/Text relationships, sizes, and placement", () => {
    const value = structuredClone(definitionFixture);
    const surface = recordAt(value, "scene", "surfaces", "surface-title");
    surface.rootFrameId = "text-title";
    surface.logicalSize = [Number.POSITIVE_INFINITY, 1080];
    const text = recordAt(surface, "contentNodes", "text-title");
    text.parentId = "text-title";
    recordAt(text, "placement").width = Number.NaN;
    expect(definitionCodes(value)).toEqual(
      expect.arrayContaining([
        "invalid-root-frame",
        "invalid-vector",
        "invalid-text-parent",
        "invalid-text-placement",
      ]),
    );
  });

  it("validates Asset and Zone Record keys", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value).assets = {
      "asset-key": {
        id: "asset-value",
        mediaType: "image/png",
        checksum: "sha256:asset",
      },
    };
    recordAt(value, "stage").zones = {
      "zone-key": {
        id: "zone-value",
        owner: { kind: "presentation" },
        center: [0, 0, 0],
        size: [1, 1, 1],
      },
    };
    const result = validatePresentationDefinition(value);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const mismatchPaths = result.diagnostics
        .filter((item) => item.code === "record-key-id-mismatch")
        .map((item) => item.path);
      expect(mismatchPaths).toEqual(
        expect.arrayContaining([
          ["assets", "asset-key"],
          ["stage", "zones", "zone-key"],
        ]),
      );
    }
  });

  it("validates Stage and Zone vectors", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value, "stage").size = [1, Number.POSITIVE_INFINITY, 1];
    recordAt(value, "stage").zones = {
      zone: {
        id: "zone",
        owner: { kind: "presentation" },
        center: [Number.NaN, 0, 0],
        size: [1, 0, 1],
      },
    };
    const result = validatePresentationDefinition(value);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(
        result.diagnostics
          .filter((item) => item.code === "invalid-vector")
          .map((item) => item.path),
      ).toEqual(
        expect.arrayContaining([
          ["stage", "size"],
          ["stage", "zones", "zone", "center"],
          ["stage", "zones", "zone", "size"],
        ]),
      );
  });

  it("rejects resource IDs reused across resource kinds", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value).assets = {
      "surface-node-title": {
        id: "surface-node-title",
        mediaType: "image/png",
        checksum: "sha256:asset",
      },
    };
    expect(definitionCodes(value)).toContain("duplicate-resource-id");
  });

  it("rejects duplicate override claims and excluded descendant re-inclusion", () => {
    const value = structuredClone(definitionFixture);
    const surface = recordAt(value, "scene", "surfaces", "surface-title");
    recordAt(surface, "baseSemanticTree").rootNodeIds = ["semantic-root"];
    recordAt(surface, "baseSemanticTree").nodes = {
      "semantic-root": {
        id: "semantic-root",
        parentId: null,
        order: 0,
        role: "heading",
      },
      "semantic-title": {
        id: "semantic-title",
        parentId: "semantic-root",
        order: 0,
        role: "paragraph",
        text: "Hello",
      },
    };
    recordAt(surface, "states", "state-default").semanticOverrides = [
      { nodes: { "semantic-root": { included: false } } },
      {
        nodes: {
          "semantic-root": { included: false, text: "hidden" },
          "semantic-title": { included: true },
        },
      },
    ];
    expect(definitionCodes(value)).toEqual(
      expect.arrayContaining([
        "duplicate-semantic-override-property",
        "excluded-semantic-node-property",
        "semantic-node-reincluded",
      ]),
    );
  });
});

describe("Definition and RenderBundle conformance", () => {
  it("validates texture sizes and global RenderSurface/artifact IDs", () => {
    const invalidTexture = structuredClone(bundleFixture);
    recordAt(
      invalidTexture,
      "surfaces",
      "surface-title",
      "renderSurfaces",
      "render-surface-title",
      "artifacts",
      "artifact-title-default",
      "states",
      "state-default",
    ).textures = [
      {
        assetId: "asset-title-default",
        mediaType: "image/png",
        pixelSize: [0, 1152],
        checksum: "sha256:texture",
        colorSpace: "srgb",
        alphaMode: "straight",
      },
    ];
    const textureResult = validateRenderBundle(invalidTexture);
    expect(textureResult.valid).toBe(false);
    if (!textureResult.valid)
      expect(textureResult.diagnostics.map((item) => item.code)).toContain("invalid-vector");

    const duplicateIds = structuredClone(bundleFixture);
    const surfaces = recordAt(duplicateIds, "surfaces");
    surfaces["surface-second"] = {
      ...structuredClone(recordAt(surfaces, "surface-title")),
      semanticSurfaceId: "surface-second",
    };
    const duplicateResult = validateRenderBundle(duplicateIds);
    expect(duplicateResult.valid).toBe(false);
    if (!duplicateResult.valid)
      expect(duplicateResult.diagnostics.map((item) => item.code)).toEqual(
        expect.arrayContaining(["duplicate-render-surface-id", "duplicate-renderer-artifact-id"]),
      );
  });

  it("rejects malformed and non-materialized Bundle semantic trees", () => {
    const { bundle } = pair();
    const semanticNode = recordAt(
      bundle,
      "surfaces",
      "surface-title",
      "semanticsByState",
      "state-default",
      "nodes",
      "semantic-title",
    );
    semanticNode.parentId = "semantic-title";
    const bundleResult = validateRenderBundle(bundle);
    expect(bundleResult.valid).toBe(false);
    if (!bundleResult.valid)
      expect(bundleResult.diagnostics.map((item) => item.code)).toContain("tree-cycle");

    const mismatched = pair();
    recordAt(
      mismatched.bundle,
      "surfaces",
      "surface-title",
      "semanticsByState",
      "state-default",
      "nodes",
      "semantic-title",
    ).text = "different";
    expect(artifactCodes(mismatched.definition, mismatched.bundle)).toContain(
      "materialized-semantic-tree-mismatch",
    );
  });

  it("rejects missing hit regions and mismatched interaction events", () => {
    const missing = makeInteractive();
    recordAt(missing.bundle, "surfaces", "surface-title", "interactionsByState")["state-default"] =
      [];
    expect(artifactCodes(missing.definition, missing.bundle)).toContain(
      "missing-enabled-interaction-region",
    );

    const mismatched = makeInteractive();
    const regions = recordAt(mismatched.bundle, "surfaces", "surface-title", "interactionsByState")[
      "state-default"
    ] as MutableRecord[];
    regions[0]!.event = "wrong-event";
    expect(artifactCodes(mismatched.definition, mismatched.bundle)).toContain(
      "hit-region-event-mismatch",
    );
  });

  it("requires exact surface/state sets and matching compiled sizes", () => {
    const missingSurface = pair();
    delete recordAt(missingSurface.bundle, "surfaces")["surface-title"];
    expect(artifactCodes(missingSurface.definition, missingSurface.bundle)).toContain(
      "missing-bundle-surface",
    );

    const mismatched = pair();
    const compiled = recordAt(mismatched.bundle, "surfaces", "surface-title");
    compiled.logicalSize = [1280, 720];
    delete recordAt(compiled, "semanticsByState")["state-default"];
    expect(artifactCodes(mismatched.definition, mismatched.bundle)).toEqual(
      expect.arrayContaining(["compiled-surface-size-mismatch", "surface-state-set-mismatch"]),
    );
  });
});

describe("canonical JSON and diagnostics", () => {
  it("preserves prototype-shaped IDs in canonical records", () => {
    const value = structuredClone(definitionFixture);
    const variable = structuredClone(recordAt(value, "flow", "variables", "optional-subtitle"));
    variable.id = "__proto__";
    const variables = Object.create(null) as MutableRecord;
    variables["__proto__"] = variable;
    recordAt(value, "flow").variables = variables;
    const result = canonicalizePresentationDefinition(value);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const parsed = JSON.parse(result.value) as {
      flow: { variables: Record<string, unknown> };
    };
    expect(Object.hasOwn(parsed.flow.variables, "__proto__")).toBe(true);
  });

  it("canonicalizes Frame children by sibling order", () => {
    const first = structuredClone(definitionFixture);
    const contentNodes = recordAt(first, "scene", "surfaces", "surface-title", "contentNodes");
    const original = structuredClone(recordAt(contentNodes, "text-title"));
    delete contentNodes["text-title"];
    contentNodes.a = { ...structuredClone(original), id: "a", order: 0 };
    contentNodes.z = { ...structuredClone(original), id: "z", order: 1 };
    recordAt(contentNodes, "frame-root").children = ["z", "a"];
    const second = structuredClone(first);
    recordAt(second, "scene", "surfaces", "surface-title", "contentNodes", "frame-root").children =
      ["a", "z"];
    expect(canonicalizePresentationDefinition(first)).toEqual(
      canonicalizePresentationDefinition(second),
    );
    expect(hashPresentationDefinition(first)).toEqual(hashPresentationDefinition(second));
  });

  it("orders roots by node order, sorts set arrays, and preserves override layers", () => {
    const value = structuredClone(definitionFixture);
    const surface = recordAt(value, "scene", "surfaces", "surface-title");
    recordAt(surface, "baseSemanticTree").rootNodeIds = ["b", "a"];
    recordAt(surface, "baseSemanticTree").nodes = {
      a: { id: "a", parentId: null, order: 0, role: "heading" },
      b: { id: "b", parentId: null, order: 1, role: "paragraph" },
    };
    recordAt(surface, "states", "state-default").semanticOverrides = [
      { nodes: { a: { text: "first" } } },
      { nodes: { b: { text: "second" } } },
    ];
    recordAt(surface, "renderIntent").updateModel = {
      kind: "finite-state",
      stateIds: ["state-z", "state-default"],
    };
    recordAt(surface, "states")["state-z"] = {
      id: "state-z",
      semanticOverrides: [],
      enabledInteractionIds: [],
    };
    const before = structuredClone(value);
    const result = canonicalizePresentationDefinition(value);
    expect(value).toEqual(before);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toContain('"rootNodeIds":["a","b"]');
    expect(result.value).toContain('"stateIds":["state-default","state-z"]');
    expect(result.value.indexOf('"first"')).toBeLessThan(result.value.indexOf('"second"'));
  });

  it("uses ECMAScript/JCS number rendering and a stable SHA-256 golden value", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value, "scene", "nodes", "surface-node-title", "transform").position = [
      -0, 1e-7, 1e21,
    ];
    const canonical = canonicalizePresentationDefinition(value);
    expect(canonical.valid).toBe(true);
    if (!canonical.valid) return;
    expect(canonical.value).toContain('"position":[0,1e-7,1e+21]');
    const hash = hashPresentationDefinition(value);
    expect(hash).toEqual({
      valid: true,
      value: "sha256:16241603b0d2e5c265dbc6999bfb4c416d8bf14b981a5265bff20e83d82ebc85",
      diagnostics: [],
    });
  });

  it("sorts complete diagnostics independently of Record insertion order", () => {
    const first = structuredClone(definitionFixture);
    const second = structuredClone(definitionFixture);
    const variables = {
      z: {
        id: "wrong-z",
        owner: { kind: "group", groupId: "missing-z" },
        type: "null",
        initialValue: true,
      },
      a: {
        id: "wrong-a",
        owner: { kind: "group", groupId: "missing-a" },
        type: "number",
        initialValue: "not-number",
      },
    };
    recordAt(first, "flow").variables = variables;
    recordAt(second, "flow").variables = { a: variables.a, z: variables.z };
    expect(validatePresentationDefinition(first)).toEqual(validatePresentationDefinition(second));
  });

  it("keeps IDs containing slashes as one diagnostic path segment", () => {
    const value = structuredClone(definitionFixture);
    recordAt(value, "flow").variables = {
      "optional/subtitle": {
        id: "optional/subtitle",
        owner: { kind: "presentation" },
        type: "null",
        initialValue: true,
      },
    };
    const result = validatePresentationDefinition(value);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "variable-type-mismatch",
          path: ["flow", "variables", "optional/subtitle", "initialValue"],
        }),
      );
  });

  it("returns diagnostics instead of throwing and keeps production code portable", async () => {
    expect(canonicalizePresentationDefinition({}).valid).toBe(false);
    expect(hashPresentationDefinition({}).valid).toBe(false);
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["']node:|\bBuffer\b|\bprocess\b/);
  });
});
