import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "quest-demo-surface",
  version: 1,
  authoring: { mode: "structured", structure: "./demo-surface.structure.tsx" },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: { first: { kind: "state", initial: true }, second: { kind: "state" } },
  actions: {
    showFirst: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "setSurfaceState", surfaceId: "demo-surface", stateId: "first" }],
    },
    showSecond: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "setSurfaceState", surfaceId: "demo-surface", stateId: "second" }],
    },
  },
  outputs: {
    next: {
      kind: "output",
      payload: {},
      producer: { kind: "surfaceInteraction", interactionId: "next" },
    },
  },
  renderers: ["baked-web"],
});
