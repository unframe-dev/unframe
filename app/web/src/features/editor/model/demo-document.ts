import type { PresentationDocument } from "./presentation-document";

export const demoDocument: PresentationDocument = {
  version: 1,
  id: "demo",
  revision: 0,
  metadata: {
    title: "Spatial story",
    description: "A fixture presentation for the Unframe Web Editor.",
  },
  slides: [
    {
      id: "opening",
      name: "Opening",
      elements: [
        {
          id: "demo-model-element",
          type: "model",
          name: "Unframe sculpture",
          assetId: "demo-model",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          visible: true,
          locked: false,
        },
      ],
    },
    {
      id: "detail",
      name: "Detail",
      elements: [
        {
          id: "detail-caption",
          type: "text",
          name: "Detail caption",
          content: "Shape the room around your idea.",
          transform: {
            position: [0, 1.4, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          visible: true,
          locked: false,
        },
      ],
    },
  ],
  assets: [
    {
      id: "demo-model",
      name: "Unframe sculpture",
      mediaType: "model/gltf-binary",
    },
  ],
};
