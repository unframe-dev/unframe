import { defineComponentStructure } from "@unframe/unframe-authoring";

export default defineComponentStructure({
  id: "reference-badge",
  componentId: "reference-badge",
  root: {
    id: "badge-frame",
    kind: "frame",
    style: {
      backgroundColor: {
        red: 0.9,
        green: 0.93,
        blue: 1,
        alpha: 1,
      },
      clip: true,
    },
    layout: {
      kind: "absolute",
      x: 32,
      y: 264,
      width: 880,
      height: 88,
    },
    children: [
      {
        id: "badge-text",
        kind: "text",
        value: {
          kind: "prop-ref",
          propId: "label",
          expectedType: "string",
        },
        maxCodePoints: 80,
        semanticNodeId: "badge-label",
        namedStyle: {
          kind: "named-style-ref",
          styleId: "body",
        },
        style: {
          fontSize: 28,
          lineHeight: 36,
        },
        layout: {
          kind: "absolute",
          x: 24,
          y: 24,
          width: 832,
          height: 48,
        },
      },
    ],
  },
  baseSemanticTree: {
    rootNodeIds: ["badge-label"],
    nodes: {
      "badge-label": {
        id: "badge-label",
        parentId: null,
        order: 0,
        role: "paragraph",
        text: {
          kind: "prop-ref",
          propId: "label",
          expectedType: "string",
        },
      },
    },
  },
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
