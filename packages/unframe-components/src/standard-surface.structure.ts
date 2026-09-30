import {
  assetRef,
  defineComponentStructure,
  frame,
  surface,
  text,
} from "@unframe/unframe-authoring";

const textContent = text({
  id: "text-content",
  layout: { height: 1080, kind: "absolute", width: 1920, x: 0, y: 0 },
  maxCodePoints: 64,
  semanticNodeId: "semantic-text",
  source: { file: "standard-surface.structure.ts" },
  style: {
    font: assetRef({ assetId: "reference-font" }),
    fontSize: 32,
    lineHeight: 40,
  },
  value: "Unframe",
});

const rootFrame = frame({
  children: [textContent],
  id: "frame-root",
  layout: { height: 1080, kind: "absolute", width: 1920, x: 0, y: 0 },
  source: { file: "standard-surface.structure.ts" },
});

const rootSurface = surface({
  baseSemanticTree: {
    nodes: {
      "semantic-text": {
        id: "semantic-text",
        order: 0,
        parentId: null,
        role: "paragraph",
        text: "Unframe",
      },
    },
    rootNodeIds: ["semantic-text"],
  },
  fit: "contain",
  id: "surface-root",
  initialStateId: "default",
  interactions: {},
  logicalSize: [1920, 1080],
  physicalSizeMeters: [1.6, 0.9],
  renderIntent: {
    fallbackPolicy: "reject",
    interaction: "none",
    internalAnimation: "none",
    rendererPreference: "baked-web",
    updateModel: "static",
  },
  root: rootFrame,
  source: { file: "standard-surface.structure.ts" },
  states: {
    default: {
      enabledInteractionIds: [],
      id: "default",
      semanticOverrides: [],
    },
  },
});

export const standardSurfaceStructure = defineComponentStructure({
  componentId: "@unframe/components/Surface",
  id: "standard-surface-structure",
  partBindings: {},
  root: rootSurface,
  source: { file: "standard-surface.structure.ts" },
  timelines: [],
  variantStyles: {},
});
