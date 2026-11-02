import { defineComponentManifest } from "@unframe/authoring";
export default defineComponentManifest({
  componentId: "badge-component",
  version: 1,
  authoring: { mode: "structured", structure: "./badge.structure.tsx" },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: {},
  actions: {},
  outputs: {},
  renderers: ["baked-web"],
});
