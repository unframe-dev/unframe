import { defineComponentStructure } from "@unframe/authoring";

export default defineComponentStructure({
  id: "surface-structure",
  componentId: "surface-component",
  root: {
    id: "surface-root",
    kind: "surface",
    physicalSizeMeters: [1, 1],
    logicalSize: [64, 64],
    fit: "contain",
    root: {
      id: "surface-frame",
      kind: "frame",
      layout: { kind: "absolute", x: 0, y: 0, width: 64, height: 64 },
      semanticNodeId: "button",
      style: { backgroundColor: { red: 0, green: 0, blue: 0, alpha: 1 } },
      children: [
        {
          kind: "video",
          id: "movie",
          asset: { kind: "asset-ref", assetId: "movie" },
          loop: false,
          layout: { kind: "absolute", x: 0, y: 0, width: 64, height: 64 },
          style: {
            fit: "contain",
            tint: { red: 1, green: 1, blue: 1, alpha: 1 },
            border: { width: 0, radius: 0, color: { red: 0, green: 0, blue: 0, alpha: 0 } },
          },
        },
        {
          id: "translucent-panel",
          kind: "frame",
          layout: { kind: "absolute", x: 8, y: 8, width: 32, height: 16 },
          opacity: 0.5,
          style: { backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 } },
          children: [],
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: ["button"],
      nodes: {
        button: {
          id: "button",
          parentId: null,
          order: 0,
          role: "button",
          text: "Open",
          interactionId: "open",
        },
      },
    },
    interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 1 } },
    initialStateId: "default",
    states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] } },
    renderIntent: {
      updateModel: "static",
      interaction: "regions",
      internalAnimation: "none",
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
  },
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
