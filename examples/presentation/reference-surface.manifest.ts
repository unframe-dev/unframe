import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  actions: {
    deactivate: {
      effects: [
        { kind: "setSurfaceState", stateId: "inactive", surfaceId: "reference-surface-root" },
        {
          kind: "setVariable",
          value: { field: "accepted", kind: "eventPayload" },
          variableId: "continued",
        },
      ],
      inputs: {},
      kind: "action",
      preconditions: [],
    },
    fade: {
      effects: [{ completion: "nonBlocking", kind: "playTimeline", timelineId: "fade" }],
      inputs: {},
      kind: "action",
      preconditions: [],
    },
  },
  authoring: {
    mode: "structured",
    structure: "./reference-surface.structure.tsx",
  },
  componentId: "reference-surface",
  outputs: {
    continued: {
      kind: "output",
      payload: { accepted: { type: "boolean", value: true } },
      producer: { interactionId: "continue", kind: "surfaceInteraction" },
    },
    elapsed: {
      kind: "output",
      payload: {},
      producer: { afterMilliseconds: 1000, kind: "timer" },
    },
    faded: {
      kind: "output",
      payload: {},
      producer: { kind: "timelineCompleted", timelineId: "fade" },
    },
  },
  parts: {
    headline: {
      kind: "part",
    },
  },
  props: {
    offset: {
      default: 64,
      kind: "number",
    },
    showCard: {
      default: true,
      kind: "boolean",
    },
    title: {
      kind: "string",
      required: true,
    },
  },
  renderers: ["baked-web"],
  slots: {
    badge: {
      kind: "slot",
    },
  },
  states: {
    default: {
      initial: true,
      kind: "state",
    },
    inactive: {
      kind: "state",
    },
  },
  variants: {
    tone: {
      default: "quiet",
      kind: "variant",
      values: ["quiet", "accent"],
    },
  },
  version: 1,
});
