import { defineComponentStructure } from "@unframe/presentation";

export default defineComponentStructure({
  id: "reference-surface",
  componentId: "reference-surface",
  root: {
    id: "reference-surface-root",
    kind: "surface",
    physicalSizeMeters: [1, 1],
    logicalSize: [1, 1],
    fit: "contain",
    root: {
      id: "reference-frame",
      kind: "frame",
      layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
      children: [
        {
          id: "reference-text",
          kind: "text",
          value: "Unframe",
          layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
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
