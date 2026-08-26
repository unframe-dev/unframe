import { describe, expect, expectTypeOf, it } from "vitest";
import {
  standardComponents,
  standardSurfaceManifest,
  standardSurfaceStructure,
  standardTheme,
  standardThemeStyleIds,
} from "../src/index.js";

describe("standard Surface contract", () => {
  it("exposes only the implemented structured baked-web contract", () => {
    expect(standardSurfaceManifest).toMatchObject({
      componentId: "@unframe/components/Surface",
      version: 1,
      authoring: {
        mode: "structured",
        structure: "./standard-surface.structure.ts",
      },
    });
    expect(standardSurfaceManifest.props).toEqual({});
    expect(standardSurfaceManifest.slots).toEqual({});
    expect(standardSurfaceManifest.parts).toEqual({});
    expect(standardSurfaceManifest.variants).toEqual({});
    expect(standardSurfaceManifest.actions).toEqual({});
    expect(standardSurfaceManifest.outputs).toEqual({});
    expect(standardSurfaceManifest.states).toEqual({
      default: { kind: "state", initial: true },
    });
    expect(standardSurfaceManifest.renderers).toEqual(["baked-web"]);
    expect(standardSurfaceManifest).not.toHaveProperty("semantics");
    expect(standardSurfaceManifest.componentId).toBe(standardSurfaceStructure.componentId);
  });

  it("owns an explicit Surface to Frame to Text primitive graph", () => {
    const surface = standardSurfaceStructure.root;
    expect(surface).toMatchObject({
      id: "surface-root",
      kind: "surface",
      physicalSizeMeters: [1.6, 0.9],
      logicalSize: [1920, 1080],
      fit: "contain",
      initialStateId: "default",
      renderIntent: {
        updateModel: "static",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      },
    });
    expect(surface.root).toMatchObject({
      id: "frame-root",
      kind: "frame",
      layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
    });
    expect(surface.root.children).toHaveLength(1);
    expect(surface.root.children[0]).toMatchObject({
      id: "text-content",
      kind: "text",
      value: "",
      layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
    });
  });

  it("keeps state and semantic meaning static and non-interactive", () => {
    const surface = standardSurfaceStructure.root;
    expect(Object.keys(surface.states)).toEqual(["default"]);
    expect(Object.keys(standardSurfaceManifest.states)).toEqual(Object.keys(surface.states));
    expect(surface.states.default).toEqual({
      id: "default",
      semanticOverrides: [],
      enabledInteractionIds: [],
    });
    expect(surface.interactions).toEqual({});
    expect(surface.baseSemanticTree).toEqual({
      rootNodeIds: ["semantic-text"],
      nodes: {
        "semantic-text": {
          id: "semantic-text",
          parentId: null,
          order: 0,
          role: "paragraph",
          text: "",
        },
      },
    });
  });

  it("uses explicit unique local IDs instead of position-derived identity", () => {
    const surface = standardSurfaceStructure.root;
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

  it("resolves every Named Style reference from the standard Theme", () => {
    const surface = standardSurfaceStructure.root;
    const styleIds = [surface.root.style?.styleId, surface.root.children[0]?.style?.styleId];
    expect(styleIds).toEqual([
      standardThemeStyleIds.surfaceRoot,
      standardThemeStyleIds.surfaceText,
    ]);
    for (const styleId of styleIds) {
      expect(styleId).toBeDefined();
      expect(standardTheme.namedStyles).toHaveProperty(styleId as string);
    }
  });

  it("exports stable JSON-safe plain data without hidden registry state", () => {
    const serialized = JSON.stringify(standardComponents);
    expect(JSON.parse(serialized)).toEqual(standardComponents);
    expect(structuredClone(standardComponents)).toEqual(standardComponents);
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
