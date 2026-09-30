import { defineComponentManifest, state } from "@unframe/unframe-authoring";

export const standardSurfaceManifest = defineComponentManifest({
  actions: {},
  authoring: {
    mode: "structured",
    structure: "./standard-surface.structure.ts",
  },
  componentId: "@unframe/components/Surface",
  outputs: {},
  parts: {},
  props: {},
  renderers: ["baked-web"],
  slots: {},
  source: { file: "standard-surface.manifest.ts" },
  states: {
    default: state({ initial: true }),
  },
  variants: {},
  version: 1,
});
