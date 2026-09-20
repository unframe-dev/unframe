import { defineComponentStructure } from "@unframe/unframe-authoring";

export default defineComponentStructure({
  id: "reference-surface",
  componentId: "reference-surface",
  root: {
    id: "reference-surface-root",
    kind: "surface",
    physicalSizeMeters: [1, 1],
    logicalSize: [1920, 1080],
    fit: "contain",
    root: {
      id: "reference-frame",
      kind: "frame",
      style: { backgroundColor: { red: 1, green: 1, blue: 1, alpha: 1 } },
      layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
      children: [
        {
          id: "reference-text",
          kind: "text",
          value: "Unframe",
          maxCodePoints: 64,
          semanticNodeId: "reference-text",
          style: { fontAssetId: "reference-font", fontSize: 64, lineHeight: 80 },
          layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: ["reference-text"],
      nodes: {
        "reference-text": {
          id: "reference-text",
          parentId: null,
          order: 0,
          role: "paragraph",
          text: "Unframe",
        },
      },
    },
    interactions: {},
    initialStateId: "default",
    states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
    renderIntent: {
      updateModel: "static",
      interaction: "none",
      internalAnimation: "none",
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
  },
  partBindings: {},
  slotPlacements: {},
  timelines: [],
});
