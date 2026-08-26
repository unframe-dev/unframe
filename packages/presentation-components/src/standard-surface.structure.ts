import {
  defineComponentStructure,
  frame,
  namedStyleRef,
  surface,
  text,
} from "@unframe/presentation";
import { standardThemeStyleIds } from "./standard-theme.js";

const textContent = text({
  id: "text-content",
  source: { file: "standard-surface.structure.ts" },
  value: "",
  layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
  style: namedStyleRef({ styleId: standardThemeStyleIds.surfaceText }),
});

const rootFrame = frame({
  id: "frame-root",
  source: { file: "standard-surface.structure.ts" },
  layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
  style: namedStyleRef({ styleId: standardThemeStyleIds.surfaceRoot }),
  children: [textContent],
});

const rootSurface = surface({
  id: "surface-root",
  source: { file: "standard-surface.structure.ts" },
  physicalSizeMeters: [1.6, 0.9],
  logicalSize: [1920, 1080],
  fit: "contain",
  root: rootFrame,
  baseSemanticTree: {
    rootNodeIds: ["semantic-text"],
    nodes: {
      "semantic-text": {
        id: "semantic-text",
        parentId: null,
        order: 0,
        role: "paragraph",
        text: "",
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
});

export const standardSurfaceStructure = defineComponentStructure({
  id: "standard-surface-structure",
  componentId: "@unframe/components/Surface",
  source: { file: "standard-surface.structure.ts" },
  root: rootSurface,
  partBindings: {},
  slotPlacements: {},
  timelines: [],
});
