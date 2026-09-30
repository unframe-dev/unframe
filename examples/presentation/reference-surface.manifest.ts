import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  actions: {
    deactivate: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        { kind: "setSurfaceState", surfaceId: "reference-surface-root", stateId: "inactive" },
        {
          kind: "setVariable",
          variableId: "continued",
          value: { kind: "eventPayload", field: "accepted" },
        },
      ],
    },
    fade: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "playTimeline", timelineId: "fade", completion: "nonBlocking" }],
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
      producer: { kind: "surfaceInteraction", interactionId: "continue" },
    },
    elapsed: {
      kind: "output",
      payload: {},
      producer: { kind: "timer", afterMilliseconds: 1000 },
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
      kind: "number",
      default: 64,
    },
    showCard: {
      kind: "boolean",
      default: true,
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
