import { describe, expect, expectTypeOf, it } from "vitest";
import {
  standardComponents,
  standardSurfaceManifest,
  standardSurfaceStructure,
  standardTheme,
} from "../src/index.js";

describe("standard Surface contract", () => {
  it("exposes only the implemented structured baked-web contract", () => {
    expect(standardSurfaceManifest).toMatchObject({
      authoring: {
        mode: "structured",
        structure: "./standard-surface.structure.ts",
      },
      componentId: "@unframe/components/Surface",
      version: 1,
    });
    expect(standardSurfaceManifest.props).toEqual({});
    expect(standardSurfaceManifest.slots).toEqual({});
    expect(standardSurfaceManifest.parts).toEqual({});
    expect(standardSurfaceManifest.variants).toEqual({});
    expect(standardSurfaceManifest.actions).toEqual({});
    expect(standardSurfaceManifest.outputs).toEqual({});
    expect(standardSurfaceManifest.states).toEqual({
      default: { initial: true, kind: "state" },
    });
    expect(standardSurfaceManifest.renderers).toEqual(["baked-web"]);
    expect(standardSurfaceManifest).not.toHaveProperty("semantics");
    expect(standardSurfaceManifest.componentId).toBe(standardSurfaceStructure.componentId);
  });

  it("owns an explicit Surface to Frame to Text primitive graph", () => {
    const surface = standardSurfaceStructure.root;
    if (surface.kind !== "surface") {
      throw new Error("standard Surface must have a Surface root");
    }
    expect(surface).toMatchObject({
      fit: "contain",
      id: "surface-root",
      initialStateId: "default",
      kind: "surface",
      logicalSize: [1920, 1080],
      physicalSizeMeters: [1.6, 0.9],
      renderIntent: {
        fallbackPolicy: "reject",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        updateModel: "static",
      },
    });
    expect(surface.root).toMatchObject({
      id: "frame-root",
      kind: "frame",
      layout: { height: 1080, kind: "absolute", width: 1920, x: 0, y: 0 },
    });
    expect(surface.root.children).toHaveLength(1);
    expect(surface.root.children[0]).toMatchObject({
      id: "text-content",
      kind: "text",
      layout: { height: 1080, kind: "absolute", width: 1920, x: 0, y: 0 },
      maxCodePoints: 64,
      semanticNodeId: "semantic-text",
      style: {
        font: { assetId: "reference-font", kind: "asset-ref" },
        fontSize: 32,
        lineHeight: 40,
      },
      value: "Unframe",
    });
  });

  it("keeps state and semantic meaning static and non-interactive", () => {
    const surface = standardSurfaceStructure.root;
    if (surface.kind !== "surface") {
      throw new Error("standard Surface must have a Surface root");
    }
    expect(Object.keys(surface.states)).toEqual(["default"]);
    expect(Object.keys(standardSurfaceManifest.states)).toEqual(Object.keys(surface.states));
    expect(surface.states.default).toEqual({
      enabledInteractionIds: [],
      id: "default",
      semanticOverrides: [],
    });
    expect(surface.interactions).toEqual({});
    expect(surface.baseSemanticTree).toEqual({
      nodes: {
        "semantic-text": {
          id: "semantic-text",
          order: 0,
          parentId: null,
          role: "paragraph",
          text: "Unframe",
        },
      },
      rootNodeIds: ["semantic-text"],
    });
  });

  it("uses explicit unique local IDs instead of position-derived identity", () => {
    const surface = standardSurfaceStructure.root;
    if (surface.kind !== "surface") {
      throw new Error("standard Surface must have a Surface root");
    }
    const ids = [
      standardSurfaceStructure.id,
      surface.id,
      surface.root.id,
      surface.root.children[0]?.id,
      surface.baseSemanticTree.nodes["semantic-text"]?.id,
      surface.states.default.id,
    ];
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses concrete text inputs without applying unresolved Named Styles", () => {
    const surface = standardSurfaceStructure.root;
    if (surface.kind !== "surface") {
      throw new Error("standard Surface must have a Surface root");
    }
    const text = surface.root.children[0];
    if (text?.kind !== "text") {
      throw new Error("standard Surface child must be Text");
    }

    expect(surface.root).not.toHaveProperty("namedStyle");
    expect(text).not.toHaveProperty("namedStyle");
    expect(text?.style).toEqual({
      font: { assetId: "reference-font", kind: "asset-ref" },
      fontSize: 32,
      lineHeight: 40,
    });
    expect(standardTheme.namedStyles).toEqual({});
  });

  it("exports stable JSON-safe plain data without hidden registry state", () => {
    const serialized = JSON.stringify(standardComponents);
    expect(JSON.parse(serialized)).toEqual(standardComponents);
    expect(standardComponents.surface.manifest).toBe(standardSurfaceManifest);
    expect(standardComponents.surface.structure).toBe(standardSurfaceStructure);
    expect(standardComponents.theme).toBe(standardTheme);
  });

  it("preserves literal public contract types", () => {
    expectTypeOf(
      standardSurfaceManifest.componentId,
    ).toEqualTypeOf<"@unframe/components/Surface">();
    expectTypeOf(standardSurfaceManifest.authoring.mode).toEqualTypeOf<"structured">();
    expectTypeOf(standardSurfaceManifest.renderers[0]).toEqualTypeOf<"baked-web">();
    expectTypeOf(standardSurfaceStructure.root.id).toEqualTypeOf<"surface-root">();
  });
});
