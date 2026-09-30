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

const absolute = { height: 360, kind: "absolute" as const, width: 640, x: 0, y: 0 };
const black = { alpha: 1, blue: 0, green: 0, red: 0 };

describe("M3A typed Theme declarations", () => {
  it("accepts all Token categories, same-category aliases, and typed Named Styles", () => {
    const theme = defineTheme({
      id: "theme",
      namedStyles: {
        heading: {
          kind: "text",
          style: {
            align: "start",
            color: tokenRef({ category: "color", tokenId: "foreground" }),
            fallbackFonts: [],
            font: tokenRef({ category: "fontFace", tokenId: "body" }),
            fontSize: tokenRef({ category: "logicalLength", tokenId: "padding" }),
            lineHeight: 24,
            overflow: "clip",
            weight: "bold",
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
      tokens: {
        body: { category: "fontFace", value: assetRef({ assetId: "font-body" }) },
        distance: { category: "spatialLength", value: 1 },
        entrance: { category: "easing", value: "cubicOut" },
        fast: { category: "duration", value: 150 },
        foreground: {
          category: "color",
          value: tokenRef({ category: "color", tokenId: "ink" }),
        },
        ink: { category: "color", value: black },
        padding: { category: "logicalLength", value: 16 },
      },
    });

    expect(theme.tokens.entrance.value).toBe("cubicOut");
    expect(theme.namedStyles.heading.kind).toBe("text");
  });

  it("rejects cross-category aliases and arbitrary Named Style objects", () => {
    expect(
      isThemeDeclaration({
        id: "theme",
        namedStyles: {},
        tokens: {
          invalid: {
            category: "color",
            value: { category: "logicalLength", kind: "token-ref", tokenId: "space" },
          },
        },
      }),
    ).toBe(false);
    expect(
      isThemeDeclaration({
        id: "theme",
        namedStyles: { invalid: { color: "red" } },
        tokens: {},
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
        layout: absolute,
        maxCodePoints: 32,
        style: { fontAssetId: "font" },
        value: "Legacy",
      } as never),
    ).toThrow(/text declaration/);
    expect(() =>
      componentInstance({
        componentId: "component",
        id: "legacy-instance",
        owner: { kind: "presentation" },
        partOverrides: [{ content: "Legacy", partId: "title" }],
        props: { nested: { value: true } },
        slots: {},
        variants: {},
        version: 1,
      } as never),
    ).toThrow(/Component Instance declaration/);
  });

  it("accepts typed Prop references in scalar positions and variant style targets", () => {
    const title = text({
      id: "title",
      layout: {
        ...absolute,
        width: propRef({ expectedType: "number", propId: "width" }),
      },
      maxCodePoints: propRef({ expectedType: "number", propId: "maxCodePoints" }),
      namedStyle: namedStyleRef({ styleId: "heading" }),
      opacity: propRef({ expectedType: "number", propId: "opacity" }),
      semanticNodeId: "semantic-title",
      style: { fontSize: 32, lineHeight: 40 },
      value: propRef({ expectedType: "string", propId: "title" }),
      visible: propRef({ expectedType: "boolean", propId: "visible" }),
    });
    const root = frame({ children: [title], id: "root", layout: absolute });
    const structure = defineComponentStructure({
      baseSemanticTree: {
        nodes: {
          "semantic-title": {
            id: "semantic-title",
            level: 1,
            order: 0,
            parentId: null,
            role: "heading",
            text: "Fallback title",
          },
        },
        rootNodeIds: ["semantic-title"],
      },
      componentId: "component",
      id: "structure",
      partBindings: { title: "title" },
      root,
      timelines: [],
      variantStyles: {
        emphasis: {
          strong: [
            {
              style: { weight: "bold" },
              targetId: "title",
              targetKind: "text",
            },
          ],
        },
      },
    });

    expect(structure.variantStyles.emphasis?.strong?.[0]?.targetKind).toBe("text");
    expect(isComponentStructure(structure)).toBe(true);
  });

  it("accepts number Prop references in Surface dimensions", () => {
    const size = propRef({ expectedType: "number", propId: "size" });
    const root = frame({ children: [], id: "root", layout: absolute });

    expect(() =>
      defineComponentStructure({
        componentId: "component",
        id: "surface-structure",
        partBindings: {},
        root: {
          baseSemanticTree: { nodes: {}, rootNodeIds: [] },
          fit: "contain",
          id: "surface",
          initialStateId: "default",
          interactions: {},
          kind: "surface",
          logicalSize: [size, size],
          physicalSizeMeters: [size, size],
          renderIntent: {
            fallbackPolicy: "reject",
            interaction: "none",
            internalAnimation: "none",
            rendererPreference: "baked-web",
            updateModel: "static",
          },
          root,
          states: {
            default: { enabledInteractionIds: [], id: "default", semanticOverrides: [] },
          },
        },
        timelines: [],
        variantStyles: {},
      }),
    ).not.toThrow();
  });

  it("places a Slot explicitly among Frame children", () => {
    const content = slotPlaceholder({
      id: "content-position",
      semanticParentId: "content-group",
      slotId: "content",
    });
    const unparented = slotPlaceholder({ id: "footer-position", slotId: "footer" });
    const root = frame({ children: [content, unparented], id: "root", layout: absolute });

    expect(root.children).toEqual([
      {
        id: "content-position",
        kind: "slot-placeholder",
        semanticParentId: "content-group",
        slotId: "content",
      },
      { id: "footer-position", kind: "slot-placeholder", slotId: "footer" },
    ]);
    const structure = defineComponentStructure({
      baseSemanticTree: { nodes: {}, rootNodeIds: [] },
      componentId: "component",
      id: "slot-structure",
      partBindings: {},
      root,
      timelines: [],
      variantStyles: {},
    });

    expect(isComponentStructure(structure)).toBe(true);
    expect(() =>
      slotPlaceholder({ id: "invalid-position", semanticParentId: "", slotId: "content" }),
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
      componentId: "component",
      id: "instance",
      owner: { kind: "presentation" },
      partOverrides: [
        {
          content: "Override",
          partId: "title",
          placement: absolute,
          style: {
            color: tokenRef({ category: "color", tokenId: "foreground" }),
          },
          targetKind: "text",
        },
      ],
      props: { title: "Hello", visible: true, width: 640 },
      slots: {},
      variants: { emphasis: "strong" },
      version: 1,
    });

    expect(instance.partOverrides[0]?.targetKind).toBe("text");
    expect(instance).not.toHaveProperty("spatialNodeId");
  });

  it("rejects Prop references in topology and mismatched style target fields", () => {
    expect(
      isComponentStructure({
        baseSemanticTree: { nodes: {}, rootNodeIds: [] },
        componentId: "component",
        id: "structure",
        partBindings: {},
        root: {
          children: { expectedType: "string", kind: "prop-ref", propId: "children" },
          id: "root",
          kind: "frame",
          layout: absolute,
        },
        timelines: [],
        variantStyles: {},
      }),
    ).toBe(false);
    expect(
      isComponentStructure({
        baseSemanticTree: { nodes: {}, rootNodeIds: [] },
        componentId: "component",
        id: "structure",
        partBindings: {},
        root: { children: [], id: "root", kind: "frame", layout: absolute },
        timelines: [],
        variantStyles: {
          emphasis: {
            strong: [{ style: { fontSize: 24 }, targetId: "root", targetKind: "frame" }],
          },
        },
      }),
    ).toBe(false);
    expect(
      isComponentStructure({
        baseSemanticTree: { nodes: {}, rootNodeIds: [] },
        componentId: "component",
        id: "legacy-slot-structure",
        partBindings: {},
        root: { children: [], id: "root", kind: "frame", layout: absolute },
        slotPlacements: { content: "root" },
        timelines: [],
        variantStyles: {},
      }),
    ).toBe(false);
  });
});
