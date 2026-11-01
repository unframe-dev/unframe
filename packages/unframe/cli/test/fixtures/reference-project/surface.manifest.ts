import { defineComponentManifest } from "@unframe/authoring";

export default defineComponentManifest({
  componentId: "surface-component",
  version: 1,
  authoring: { mode: "structured", structure: "./surface.structure.tsx" },
  props: {},
  slots: { badge: { kind: "slot" } },
  parts: {},
  variants: { tone: { kind: "variant", values: ["quiet", "loud"], default: "quiet" } },
  states: { default: { kind: "state", initial: true }, inactive: { kind: "state" } },
  actions: {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "playTimeline", timelineId: "fade", completion: "nonBlocking" }],
    },
  },
  outputs: {
    finished: {
      kind: "output",
      payload: {},
      producer: { kind: "timelineCompleted", timelineId: "fade" },
    },
    opened: {
      kind: "output",
      payload: {},
      producer: { kind: "surfaceInteraction", interactionId: "open" },
    },
  },
  renderers: ["baked-web"],
});
