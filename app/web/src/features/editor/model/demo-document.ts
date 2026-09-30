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
          assetId: "demo-model",
          id: "demo-model-element",
          locked: false,
          name: "Unframe sculpture",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          type: "model",
          visible: true,
        },
      ],
      id: "opening",
      name: "Opening",
    },
    {
      elements: [
        {
          content: "Shape the room around your idea.",
          id: "detail-caption",
          locked: false,
          name: "Detail caption",
          transform: {
            position: [0, 1.4, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          type: "text",
          visible: true,
        },
      ],
      id: "detail",
      name: "Detail",
    },
  ],
  version: 1,
};
