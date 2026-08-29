import { defineComponentManifest } from "@unframe/presentation";

export default defineComponentManifest({
  componentId: "reference-surface",
  version: 1,
  authoring: { mode: "structured", structure: "./reference-surface.structure.tsx" },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: { default: { kind: "state", initial: true } },
  actions: {},
  outputs: {},
  renderers: ["baked-web"],
});
