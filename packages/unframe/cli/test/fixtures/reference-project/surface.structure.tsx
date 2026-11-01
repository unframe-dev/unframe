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
        { id: "badge-slot", kind: "slot-placeholder", slotId: "badge" },
        {
          id: "fixture-text",
          kind: "text",
          semanticNodeId: "fixture-label",
          value: "Structured authoring",
          maxCodePoints: 64,
          layout: { kind: "absolute", x: 0, y: 40, width: 64, height: 20 },
          style: {
            font: { kind: "asset-ref", assetId: "reference-font" },
            fontSize: 12,
            lineHeight: 16,
          },
        },
        {
          id: "accent",
          kind: "frame",
          layout: { kind: "absolute", x: 40, y: 40, width: 12, height: 12 },
          opacity: 0.7,
          style: { backgroundColor: { red: 0, green: 0, blue: 1, alpha: 1 } },
          children: [],
        },
        {
          id: "translucent-panel",
          kind: "frame",
          layout: { kind: "absolute", x: 8, y: 8, width: 32, height: 16 },
          opacity: 0.5,
          style: { backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 }, clip: true },
          children: [
            {
              id: "sample-image",
              kind: "image",
              asset: { kind: "asset-ref", assetId: "white" },
              layout: { kind: "absolute", x: 0, y: 0, width: 8, height: 8 },
              style: {
                fit: "contain",
                tint: { red: 1, green: 1, blue: 1, alpha: 1 },
                border: { color: { red: 0, green: 0, blue: 0, alpha: 0 }, width: 0, radius: 0 },
              },
            },
          ],
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: ["button", "fixture-label"],
      nodes: {
        "fixture-label": {
          id: "fixture-label",
          parentId: null,
          order: 1,
          role: "paragraph",
          text: "Structured authoring",
        },
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
    interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 10 } },
    initialStateId: "default",
    states: {
      default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
      inactive: {
        id: "inactive",
        semanticOverrides: [
          { id: "waiting", kind: "semantic-override", targetId: "button", text: "Waiting" },
        ],
        enabledInteractionIds: [],
      },
    },
    renderIntent: {
      updateModel: "finite-state",
      interaction: "regions",
      internalAnimation: "none",
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
  },
  partBindings: {},
  variantStyles: { tone: { quiet: [], loud: [] } },
  timelines: [
    {
      id: "fade",
      durationMilliseconds: 1000,
      tracks: [
        {
          target: { kind: "host", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 1000, value: 1 },
          ],
        },
      ],
    },
  ],
});
