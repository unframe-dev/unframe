import { defineComponentStructure } from "@unframe/unframe-authoring";

export default defineComponentStructure({
  id: "movie-structure",
  componentId: "movie",
  root: {
    kind: "surface",
    id: "video-surface",
    physicalSizeMeters: [1.6, 0.9],
    logicalSize: [1600, 900],
    fit: "contain",
    root: {
      kind: "frame",
      id: "video-frame",
      layout: {
        kind: "absolute",
        x: 0,
        y: 0,
        width: 1600,
        height: 900,
      },
      children: [
        {
          kind: "video",
          id: "movie",
          asset: {
            kind: "asset-ref",
            assetId: "movie-source",
          },
          loop: false,
          layout: {
            kind: "absolute",
            x: 0,
            y: 0,
            width: 1600,
            height: 900,
          },
          style: {
            fit: "contain",
            tint: {
              red: 1,
              green: 1,
              blue: 1,
              alpha: 1,
            },
            border: {
              width: 0,
              radius: 0,
              color: {
                red: 0,
                green: 0,
                blue: 0,
                alpha: 0,
              },
            },
          },
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: [],
      nodes: {},
    },
    interactions: {},
    initialStateId: "default",
    states: {
      default: {
        id: "default",
        semanticOverrides: [],
        enabledInteractionIds: [],
      },
      loop: {
        id: "loop",
        semanticOverrides: [],
        enabledInteractionIds: [],
        contentOverrides: {
          movie: {
            kind: "video",
            loop: true,
          },
        },
      },
    },
    renderIntent: {
      updateModel: "finite-state",
      interaction: "none",
      internalAnimation: "none",
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
  },
  partBindings: {},
  variantStyles: {},
  timelines: [],
});
