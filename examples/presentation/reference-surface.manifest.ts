import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "reference-surface",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./reference-surface.structure.tsx",
  },
  props: {
    title: {
      kind: "string",
      required: true,
    },
    offset: {
      kind: "number",
      default: 64,
    },
    showCard: {
      kind: "boolean",
      default: true,
    },
  },
  slots: {
    badge: {
      kind: "slot",
    },
  },
  parts: {
    headline: {
      kind: "part",
    },
  },
  variants: {
    tone: {
      kind: "variant",
      values: ["quiet", "accent"],
      default: "quiet",
    },
  },
  states: {
    default: {
      kind: "state",
      initial: true,
    },
  },
  actions: {},
  outputs: {},
  renderers: ["baked-web"],
});
