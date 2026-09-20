import { defineComponentStructure } from "@unframe/unframe-authoring";

export default defineComponentStructure({
  id: "reference-surface",
  componentId: "reference-surface",
  root: {
    id: "reference-surface-root",
    kind: "surface",
    physicalSizeMeters: [1, 0.5625],
    logicalSize: [1920, 1080],
    fit: "contain",
    root: {
      id: "reference-frame",
      kind: "frame",
      style: {
        backgroundColor: {
          kind: "token-ref",
          category: "color",
          tokenId: "canvas",
        },
      },
      layout: {
        kind: "absolute",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      children: [
        {
          id: "reference-text",
          kind: "text",
          value: "Unframe",
          maxCodePoints: 96,
          semanticNodeId: "heading",
          namedStyle: {
            kind: "named-style-ref",
            styleId: "heading",
          },
          style: {
            fontSize: 64,
          },
          layout: {
            kind: "absolute",
            x: 64,
            y: 48,
            width: 1792,
            height: 104,
          },
        },
        {
          id: "card",
          kind: "frame",
          visible: {
            kind: "prop-ref",
            propId: "showCard",
            expectedType: "boolean",
          },
          namedStyle: {
            kind: "named-style-ref",
            styleId: "card",
          },
          layout: {
            kind: "absolute",
            x: {
              kind: "prop-ref",
              propId: "offset",
              expectedType: "number",
            },
            y: 184,
            width: 1792,
            height: 392,
          },
          children: [
            {
              id: "summary",
              kind: "text",
              value: {
                kind: "prop-ref",
                propId: "title",
                expectedType: "string",
              },
              maxCodePoints: 96,
              semanticNodeId: "summary",
              namedStyle: {
                kind: "named-style-ref",
                styleId: "body",
              },
              layout: {
                kind: "absolute",
                x: 32,
                y: 24,
                width: 1728,
                height: 64,
              },
            },
            {
              id: "inner",
              kind: "frame",
              style: {
                backgroundColor: {
                  kind: "token-ref",
                  category: "color",
                  tokenId: "highlight",
                },
                clip: true,
              },
              layout: {
                kind: "absolute",
                x: 32,
                y: 112,
                width: 1728,
                height: 112,
              },
              children: [
                {
                  id: "detail",
                  kind: "text",
                  value: "Typed themes, explicit fonts, stable artifacts",
                  maxCodePoints: 120,
                  semanticNodeId: "detail",
                  namedStyle: {
                    kind: "named-style-ref",
                    styleId: "body",
                  },
                  style: {
                    color: {
                      red: 1,
                      green: 1,
                      blue: 1,
                      alpha: 1,
                    },
                  },
                  layout: {
                    kind: "absolute",
                    x: 24,
                    y: 24,
                    width: 1680,
                    height: 64,
                  },
                },
              ],
            },
            {
              id: "badge-placement",
              kind: "slot-placeholder",
              slotId: "badge",
              semanticParentId: "heading",
            },
          ],
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: ["heading", "summary", "detail"],
      nodes: {
        heading: {
          id: "heading",
          parentId: null,
          order: 0,
          role: "heading",
          level: 1,
          text: "Structured authoring",
        },
        summary: {
          id: "summary",
          parentId: null,
          order: 1,
          role: "paragraph",
          text: {
            kind: "prop-ref",
            propId: "title",
            expectedType: "string",
          },
        },
        detail: {
          id: "detail",
          parentId: null,
          order: 2,
          role: "paragraph",
          text: "Typed themes, explicit fonts, stable artifacts",
        },
      },
    },
    interactions: {},
    initialStateId: "default",
    states: {
      default: {
        id: "default",
        semanticOverrides: [],
        enabledInteractionIds: [],
      },
    },
    renderIntent: {
      updateModel: "static",
      interaction: "none",
      internalAnimation: "none",
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
  },
  partBindings: {
    headline: "reference-text",
  },
  variantStyles: {
    tone: {
      quiet: [
        {
          targetId: "reference-text",
          targetKind: "text",
          style: {
            fontSize: 60,
          },
        },
      ],
      accent: [
        {
          targetId: "reference-text",
          targetKind: "text",
          style: {
            fontSize: 68,
            color: {
              kind: "token-ref",
              category: "color",
              tokenId: "highlight",
            },
          },
        },
      ],
    },
  },
  timelines: [],
});
