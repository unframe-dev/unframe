import type { PresentationDocument } from "./presentation-document";

export const demoDocument: PresentationDocument = {
  assets: [
    {
      id: "demo-model",
      mediaType: "model/gltf-binary",
      name: "Unframe sculpture",
    },
  ],
  id: "demo",
  metadata: {
    description: "A fixture presentation for the Unframe Web Editor.",
    title: "Spatial story",
  },
  revision: 0,
  slides: [
    {
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
      id: "opening",
      name: "Opening",
    },
    {
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
      id: "detail",
      name: "Detail",
    },
  ],
  version: 1,
};
