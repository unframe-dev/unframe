import { defineComponentManifest } from "@unframe/unframe-authoring";
export default defineComponentManifest({
  componentId: "showcase-deck",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./showcase.structure.tsx",
  },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: {
    cover: {
      kind: "state",
      initial: true,
    },
    problem: {
      kind: "state",
    },
    system: {
      kind: "state",
    },
    workflow: {
      kind: "state",
    },
    closing: {
      kind: "state",
    },
  },
  actions: {
    cover: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "showcase-surface",
          stateId: "cover",
        },
        {
          kind: "playTimeline",
          timelineId: "focus",
          completion: "nonBlocking",
        },
      ],
    },
    problem: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "showcase-surface",
          stateId: "problem",
        },
        {
          kind: "playTimeline",
          timelineId: "focus",
          completion: "nonBlocking",
        },
      ],
    },
    system: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "showcase-surface",
          stateId: "system",
        },
        {
          kind: "playTimeline",
          timelineId: "focus",
          completion: "nonBlocking",
        },
      ],
    },
    workflow: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "showcase-surface",
          stateId: "workflow",
        },
        {
          kind: "playTimeline",
          timelineId: "focus",
          completion: "nonBlocking",
        },
      ],
    },
    closing: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "showcase-surface",
          stateId: "closing",
        },
        {
          kind: "playTimeline",
          timelineId: "focus",
          completion: "nonBlocking",
        },
      ],
    },
  },
  outputs: {
    next: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "next",
      },
    },
  },
  renderers: ["baked-web"],
});
