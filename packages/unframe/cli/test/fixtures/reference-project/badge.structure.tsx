import { defineComponentStructure } from "@unframe/authoring";
export default defineComponentStructure({
  id: "badge-structure",
  componentId: "badge-component",
  root: {
    id: "badge-frame",
    kind: "frame",
    layout: { kind: "absolute", x: 8, y: 24, width: 32, height: 12 },
    children: [
      {
        id: "badge-text",
        kind: "text",
        value: "Nested component",
        semanticNodeId: "badge-label",
        maxCodePoints: 32,
        layout: { kind: "absolute", x: 0, y: 0, width: 32, height: 12 },
        style: {
          font: { kind: "asset-ref", assetId: "reference-font" },
          fontSize: 8,
          lineHeight: 10,
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
        text: "Nested component",
      },
    },
  },
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
