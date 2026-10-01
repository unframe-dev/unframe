import { describe, expect, it } from "vitest";
import { resolveStructuredLayout, validatePresentationDefinition } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";
import originalDefinition from "../../contracts/presentation/v2/fixtures/presentation-definition.json";

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe("Structured layout", () => {
  it("Core validation keeps runtime Text values available for non-baked consumers", () => {
    const { definition } = makeM3AArtifacts();
    const surface = definition.scene.surfaces.baked!;
    if (surface.content.kind !== "structured") throw new Error("structured fixture required");
    const text = surface.content.nodes.text;
    if (!text || text.kind !== "text") throw new Error("text fixture required");
    const original = originalDefinition.scene.surfaces.native.content;
    if (original.kind !== "structured") throw new Error("structured fixture required");
    const dynamic = original.nodes.text;
    if (!dynamic || dynamic.kind !== "text") throw new Error("text fixture required");
    text.value = dynamic.value as typeof text.value;
    definition.flow.variables.counter = originalDefinition.flow.variables.counter as NonNullable<
      typeof definition.flow.variables.counter
    >;

    expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
  });
  it("accepts a concrete Frame/Text/Image/Shape graph in Definition validation", () => {
    const { definition } = makeM3AArtifacts();
    const surface = definition.scene.surfaces.baked!;
    if (surface.content.kind !== "structured") throw new Error("structured fixture required");
    const root = surface.content.nodes.root!;
    if (root.kind !== "frame") throw new Error("frame fixture required");
    const original = originalDefinition.scene.surfaces.baked.content;
    if (original.kind !== "structured") throw new Error("structured fixture required");
    surface.content.nodes.image = original.nodes.image as NonNullable<
      typeof surface.content.nodes.image
    >;
    surface.content.nodes.shape = original.nodes.shape as NonNullable<
      typeof surface.content.nodes.shape
    >;
    root.children = ["text", "image", "shape"];

    expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
  });
  it("resolves nested Stack and Grid in Surface coordinates after State overrides", () => {
    const { definition } = makeM3AArtifacts();
    const surface = definition.scene.surfaces.baked!;
    if (surface.content.kind !== "structured") throw new Error("structured fixture required");
    const root = surface.content.nodes.root!;
    if (root.kind !== "frame") throw new Error("frame fixture required");
    root.placement = { kind: "absolute", x: 3, y: 4, width: 100, height: 80 };
    root.layout = {
      kind: "stack",
      direction: "horizontal",
      gap: 4,
      padding: { ...insets, left: 5 },
      alignItems: "start",
      justifyContent: "start",
    };
    root.children = ["grid", "shape"];
    surface.content.nodes = {
      root,
      grid: {
        id: "grid",
        kind: "frame",
        parentId: "root",
        order: 0,
        visible: true,
        opacity: 1,
        placement: {
          kind: "stack",
          grow: 0,
          width: 40,
          height: 30,
          alignSelf: "auto",
          margin: insets,
        },
        layout: {
          kind: "grid",
          columns: [
            { kind: "fixed", size: 10 },
            { kind: "fraction", fraction: 1 },
          ],
          rows: [{ kind: "fraction", fraction: 1 }],
          columnGap: 2,
          rowGap: 0,
          padding: insets,
        },
        children: ["image"],
        backgroundColor: root.backgroundColor,
        border: root.border,
        clip: false,
      },
      shape: {
        id: "shape",
        kind: "shape",
        parentId: "root",
        order: 1,
        visible: true,
        opacity: 1,
        placement: {
          kind: "stack",
          grow: 1,
          width: 10,
          height: 20,
          alignSelf: "auto",
          margin: insets,
        },
        geometry: { kind: "rectangle", width: 10, height: 20, radius: 0 },
        style: { fill: root.backgroundColor, stroke: root.backgroundColor, strokeWidth: 0 },
      },
      image: {
        id: "image",
        kind: "image",
        parentId: "grid",
        order: 0,
        visible: true,
        opacity: 1,
        placement: {
          kind: "grid",
          column: 2,
          row: 1,
          columnSpan: 1,
          rowSpan: 1,
          width: 8,
          height: 6,
          alignSelf: "center",
          justifySelf: "end",
          margin: insets,
        },
        assetId: "example",
        style: { fit: "contain", tint: root.backgroundColor, border: root.border },
      },
    };
    surface.states.default!.contentOverrides.shape = {
      kind: "shape",
      placement: {
        kind: "stack",
        grow: 0,
        width: 12,
        height: 20,
        alignSelf: "auto",
        margin: insets,
      },
    };

    expect(resolveStructuredLayout(surface, "default")).toMatchObject({
      root: { x: 3, y: 4, width: 100, height: 80 },
      grid: { x: 8, y: 4, width: 40, height: 30 },
      shape: { x: 52, y: 4, width: 12, height: 20 },
      image: { x: 40, y: 16, width: 8, height: 6 },
    });
  });

  it("rejects placement incompatible with its parent layout", () => {
    const { definition } = makeM3AArtifacts();
    const surface = definition.scene.surfaces.baked!;
    if (surface.content.kind !== "structured") throw new Error("structured fixture required");
    const root = surface.content.nodes.root!;
    if (root.kind !== "frame") throw new Error("frame fixture required");
    root.layout = {
      kind: "stack",
      direction: "vertical",
      gap: 0,
      padding: insets,
      alignItems: "start",
      justifyContent: "start",
    };
    expect(() => resolveStructuredLayout(surface, "default")).toThrow(TypeError);
  });
});
