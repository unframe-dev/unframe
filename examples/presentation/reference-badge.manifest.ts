import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  actions: {},
  authoring: {
    mode: "structured",
    structure: "./reference-badge.structure.tsx",
  },
  componentId: "reference-badge",
  outputs: {},
  parts: {},
  props: {
    label: {
      kind: "string",
      required: true,
    },
  },
  renderers: ["baked-web"],
  slots: {},
  states: {},
  variants: {},
  version: 1,
});
