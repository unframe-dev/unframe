import { describe, expect, it } from "vitest";

import legacyDefinition from "../../contracts/presentation/fixtures/minimal.presentation-definition.v1.json";
import legacyBundle from "../../contracts/presentation/fixtures/minimal.render-bundle.v1.json";
import {
  canonicalizeJsonPayload,
  canonicalizePresentationDefinition,
  hashCanonicalJsonPayload,
  hashPresentationDefinition,
  materializeCompletedSemanticTree,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

describe("unframe-core v2", () => {
  it("accepts the static baked-web Frame to Text v2 slice", () => {
    const { definition, renderBundle } = makeM3AArtifacts();

    expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: true });
    expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({ valid: true });
  });

  it("rejects legacy v1 artifacts instead of converting them", () => {
    expect(validatePresentationDefinition(legacyDefinition)).toMatchObject({ valid: false });
    expect(validateRenderBundle(legacyBundle)).toMatchObject({ valid: false });
  });

  it("materializes the v2 completed semantic tree", () => {
    const surface = makeM3AArtifacts().definition.scene.surfaces.baked!;

    expect(materializeCompletedSemanticTree(surface, "default")).toEqual({
      valid: true,
      value: surface.baseSemanticTree,
      diagnostics: [],
    });
    expect(materializeCompletedSemanticTree(surface, "missing")).toMatchObject({ valid: false });
  });

  it.each([
    ["heading", { role: "heading", level: 2, text: "Heading" }],
    ["paragraph", { role: "paragraph", text: "Paragraph", language: "ja" }],
    ["image", { role: "image", alt: "Image", language: "en" }],
    ["button", { role: "button", interactionId: "activate", text: "Button" }],
    ["list", { role: "list", ordered: true }],
    ["listItem", { role: "listItem", text: "Item" }],
    ["table", { role: "table", label: "Table", language: "en" }],
    ["row", { role: "row" }],
    ["cell", { role: "cell", text: "Cell" }],
    ["columnHeader", { role: "columnHeader", text: "Column" }],
    ["rowHeader", { role: "rowHeader", text: "Row" }],
  ] as const)("materializes the v2 %s role-specific fields", (_role, fields) => {
    const surface = makeM3AArtifacts().definition.scene.surfaces.baked!;
    surface.baseSemanticTree = {
      rootNodeIds: ["node"],
      nodes: {
        node: { id: "node", parentId: null, order: 0, ...fields },
      },
    } as typeof surface.baseSemanticTree;

    const result = materializeCompletedSemanticTree(surface, "default");

    expect(result).toMatchObject({ valid: true });
    if (result.valid) expect(result.value.nodes.node).toMatchObject(fields);
  });

  it.each([
    ["heading without level", { role: "heading", text: "Heading" }],
    ["paragraph with level", { role: "paragraph", level: 1, text: "Paragraph" }],
    ["list without ordered", { role: "list" }],
    ["row with ordered", { role: "row", ordered: false }],
    ["empty table label", { role: "table", label: "" }],
  ])("rejects invalid v2 role fields: %s", (_name, fields) => {
    const surface = makeM3AArtifacts().definition.scene.surfaces.baked!;
    surface.baseSemanticTree = {
      rootNodeIds: ["node"],
      nodes: {
        node: { id: "node", parentId: null, order: 0, ...fields },
      },
    } as typeof surface.baseSemanticTree;

    expect(materializeCompletedSemanticTree(surface, "default")).toMatchObject({ valid: false });
  });

  it("fails closed for hostile materialization input", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile");
        },
      },
    );

    expect(materializeCompletedSemanticTree(hostile as never, "default")).toMatchObject({
      valid: false,
    });
  });

  it("keeps array order significant in canonical v2 JSON", () => {
    const first = { rootNodeIds: ["second", "first"] };
    const second = { rootNodeIds: ["first", "second"] };

    expect(canonicalizeJsonPayload(first)).not.toBe(canonicalizeJsonPayload(second));
    expect(hashCanonicalJsonPayload(first)).not.toBe(hashCanonicalJsonPayload(second));
  });

  it("does not mutate values while canonicalizing", () => {
    const { definition } = makeM3AArtifacts();
    const before = structuredClone(definition);

    expect(canonicalizePresentationDefinition(definition)).toMatchObject({ valid: true });
    expect(definition).toEqual(before);
  });

  it("hashes the validated v2 definition with the generic JCS hash", () => {
    const { definition } = makeM3AArtifacts();

    expect(hashPresentationDefinition(definition)).toEqual({
      valid: true,
      value: hashCanonicalJsonPayload(definition),
      diagnostics: [],
    });
  });

  it("rejects observably unsafe JSON without invoking accessors", () => {
    let reads = 0;
    const input = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        reads += 1;
        return 1;
      },
    });

    expect(() => canonicalizeJsonPayload(input)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
