import { defineComponentManifest, state } from "@unframe/presentation";

export const standardSurfaceManifest = defineComponentManifest({
  componentId: "@unframe/components/Surface",
  version: 1,
  source: { file: "standard-surface.manifest.ts" },
  authoring: {
    mode: "structured",
    structure: "./standard-surface.structure.ts",
  },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: {
    default: state({ initial: true }),
  },
  actions: {},
  outputs: {},
  renderers: ["baked-web"],
});
