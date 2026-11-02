import { defineComponentManifest } from "@unframe/authoring";

export default defineComponentManifest({
  componentId: "surface-component",
  version: 1,
  authoring: { mode: "structured", structure: "./surface.structure.tsx" },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: { default: { kind: "state", initial: true } },
  actions: {},
  outputs: {
    opened: {
      kind: "output",
      payload: {},
      producer: { kind: "surfaceInteraction", interactionId: "open" },
    },
  },
  renderers: ["baked-web"],
});
