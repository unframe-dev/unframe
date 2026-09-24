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
    inactive: {
      kind: "state",
    },
  },
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
  },
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
  },
  renderers: ["baked-web"],
});
