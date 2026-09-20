import { describe, expect, it } from "vitest";

import {
  assetRef,
  componentInstance,
  defineComponentStructure,
  defineTheme,
  frame,
  isComponentStructure,
  isThemeDeclaration,
  namedStyleRef,
  propRef,
  slotPlaceholder,
  text,
  tokenRef,
} from "../src/index.js";

const absolute = { kind: "absolute" as const, x: 0, y: 0, width: 640, height: 360 };
const black = { red: 0, green: 0, blue: 0, alpha: 1 };

describe("M3A typed Theme declarations", () => {
  it("accepts all Token categories, same-category aliases, and typed Named Styles", () => {
    const theme = defineTheme({
      id: "theme",
      tokens: {
        ink: { category: "color", value: black },
        foreground: {
          category: "color",
          value: tokenRef({ category: "color", tokenId: "ink" }),
        },
        padding: { category: "logicalLength", value: 16 },
        distance: { category: "spatialLength", value: 1 },
        body: { category: "fontFace", value: assetRef({ assetId: "font-body" }) },
        fast: { category: "duration", value: 150 },
        entrance: { category: "easing", value: "cubicOut" },
      },
      namedStyles: {
        heading: {
          kind: "text",
          style: {
            font: tokenRef({ category: "fontFace", tokenId: "body" }),
            fallbackFonts: [],
            fontSize: tokenRef({ category: "logicalLength", tokenId: "padding" }),
            lineHeight: 24,
            color: tokenRef({ category: "color", tokenId: "foreground" }),
            weight: "bold",
            align: "start",
            overflow: "clip",
          },
        },
        panel: {
          kind: "frame",
          style: {
            backgroundColor: tokenRef({ category: "color", tokenId: "ink" }),
            clip: false,
          },
        },
      },
    });

    expect(theme.tokens.entrance.value).toBe("cubicOut");
    expect(theme.namedStyles.heading.kind).toBe("text");
  });

  it("rejects cross-category aliases and arbitrary Named Style objects", () => {
    expect(
      isThemeDeclaration({
        id: "theme",
        tokens: {
          invalid: {
            category: "color",
            value: { kind: "token-ref", category: "logicalLength", tokenId: "space" },
          },
        },
        namedStyles: {},
      }),
    ).toBe(false);
    expect(
      isThemeDeclaration({
        id: "theme",
        tokens: {},
        namedStyles: { invalid: { color: "red" } },
      }),
    ).toBe(false);
  });
});

describe("M3A typed Structure declarations", () => {
  it("rejects legacy untyped style, token, Prop, and Part override shapes", () => {
    expect(() => tokenRef({ tokenId: "ink" } as never)).toThrow(/Token reference/);
    expect(() =>
      text({
        id: "legacy-text",
        value: "Legacy",
        layout: absolute,
        maxCodePoints: 32,
        style: { fontAssetId: "font" },
      } as never),
    ).toThrow(/text declaration/);
    expect(() =>
      componentInstance({
        id: "legacy-instance",
        componentId: "component",
        version: 1,
        packageLock: {
          packageVersion: "1.0.0",
          packageIntegrity: "sha256:package",
          manifestHash: "sha256:manifest",
        },
        owner: { kind: "presentation" },
        props: { nested: { value: true } },
        slots: {},
        variants: {},
        partOverrides: [{ partId: "title", content: "Legacy" }],
      } as never),
    ).toThrow(/Component Instance declaration/);
  });

  it("accepts typed Prop references in scalar positions and variant style targets", () => {
    const title = text({
      id: "title",
      value: propRef({ propId: "title", expectedType: "string" }),
      layout: {
        ...absolute,
        width: propRef({ propId: "width", expectedType: "number" }),
      },
      visible: propRef({ propId: "visible", expectedType: "boolean" }),
      opacity: propRef({ propId: "opacity", expectedType: "number" }),
      maxCodePoints: propRef({ propId: "maxCodePoints", expectedType: "number" }),
      namedStyle: namedStyleRef({ styleId: "heading" }),
      style: { fontSize: 32, lineHeight: 40 },
      semanticNodeId: "semantic-title",
    });
    const root = frame({ id: "root", layout: absolute, children: [title] });
    const structure = defineComponentStructure({
      id: "structure",
      componentId: "component",
      root,
      baseSemanticTree: {
        rootNodeIds: ["semantic-title"],
        nodes: {
          "semantic-title": {
            id: "semantic-title",
            parentId: null,
            order: 0,
            role: "heading",
            level: 1,
            text: "Fallback title",
          },
        },
      },
      partBindings: { title: "title" },
      variantStyles: {
        emphasis: {
          strong: [
            {
              targetId: "title",
              targetKind: "text",
              style: { weight: "bold" },
            },
          ],
        },
      },
      timelines: [],
    });

    expect(structure.variantStyles.emphasis?.strong?.[0]?.targetKind).toBe("text");
    expect(isComponentStructure(structure)).toBe(true);
  });

  it("accepts number Prop references in Surface dimensions", () => {
    const size = propRef({ propId: "size", expectedType: "number" });
    const root = frame({ id: "root", layout: absolute, children: [] });

    expect(() =>
      defineComponentStructure({
        id: "surface-structure",
        componentId: "component",
        root: {
          id: "surface",
          kind: "surface",
          physicalSizeMeters: [size, size],
          logicalSize: [size, size],
          fit: "contain",
          root,
          baseSemanticTree: { rootNodeIds: [], nodes: {} },
          interactions: {},
          initialStateId: "default",
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] },
          },
          renderIntent: {
            updateModel: "static",
            interaction: "none",
            internalAnimation: "none",
            rendererPreference: "baked-web",
            fallbackPolicy: "reject",
          },
        },
        partBindings: {},
        variantStyles: {},
        timelines: [],
      }),
    ).not.toThrow();
  });

  it("places a Slot explicitly among Frame children", () => {
    const content = slotPlaceholder({
      id: "content-position",
      slotId: "content",
      semanticParentId: "content-group",
    });
    const unparented = slotPlaceholder({ id: "footer-position", slotId: "footer" });
    const root = frame({ id: "root", layout: absolute, children: [content, unparented] });

    expect(root.children).toEqual([
      {
        id: "content-position",
        kind: "slot-placeholder",
        slotId: "content",
        semanticParentId: "content-group",
      },
      { id: "footer-position", kind: "slot-placeholder", slotId: "footer" },
    ]);
    const structure = defineComponentStructure({
      id: "slot-structure",
      componentId: "component",
      root,
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      partBindings: {},
      variantStyles: {},
      timelines: [],
    });

    expect(isComponentStructure(structure)).toBe(true);
    expect(() =>
      slotPlaceholder({ id: "invalid-position", slotId: "content", semanticParentId: "" }),
    ).toThrow(/semanticParentId/);
    expect(
      isComponentStructure({
        ...structure,
        root: {
          ...root,
          children: [{ ...content, semanticParentId: "" }],
        },
      }),
    ).toBe(false);
  });

  it("accepts typed instance Prop values and Part overrides", () => {
    const instance = componentInstance({
      id: "instance",
      componentId: "component",
      version: 1,
      packageLock: {
        packageVersion: "1.0.0",
        packageIntegrity: "sha256:package",
        manifestHash: "sha256:manifest",
        structureHash: "sha256:structure",
      },
      owner: { kind: "presentation" },
      props: { title: "Hello", width: 640, visible: true },
      slots: {},
      variants: { emphasis: "strong" },
      partOverrides: [
        {
          partId: "title",
          targetKind: "text",
          content: "Override",
          placement: absolute,
          style: {
            color: tokenRef({ category: "color", tokenId: "foreground" }),
          },
        },
      ],
    });

    expect(instance.partOverrides[0]?.targetKind).toBe("text");
    expect(instance).not.toHaveProperty("spatialNodeId");
  });

  it("rejects Prop references in topology and mismatched style target fields", () => {
    expect(
      isComponentStructure({
        id: "structure",
        componentId: "component",
        root: {
          id: "root",
          kind: "frame",
          layout: absolute,
          children: { kind: "prop-ref", propId: "children", expectedType: "string" },
        },
        baseSemanticTree: { rootNodeIds: [], nodes: {} },
        partBindings: {},
        variantStyles: {},
        timelines: [],
      }),
    ).toBe(false);
    expect(
      isComponentStructure({
        id: "structure",
        componentId: "component",
        root: { id: "root", kind: "frame", layout: absolute, children: [] },
        baseSemanticTree: { rootNodeIds: [], nodes: {} },
        partBindings: {},
        variantStyles: {
          emphasis: {
            strong: [{ targetId: "root", targetKind: "frame", style: { fontSize: 24 } }],
          },
        },
        timelines: [],
      }),
    ).toBe(false);
    expect(
      isComponentStructure({
        id: "legacy-slot-structure",
        componentId: "component",
        root: { id: "root", kind: "frame", layout: absolute, children: [] },
        baseSemanticTree: { rootNodeIds: [], nodes: {} },
        partBindings: {},
        slotPlacements: { content: "root" },
        variantStyles: {},
        timelines: [],
      }),
    ).toBe(false);
  });
});
