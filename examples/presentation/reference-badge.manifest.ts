import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "reference-badge",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./reference-badge.structure.tsx",
  },
  props: {
    label: {
      kind: "string",
      required: true,
    },
  },
  slots: {},
  parts: {},
  variants: {},
  states: {},
  actions: {},
  outputs: {},
  renderers: ["baked-web"],
});
