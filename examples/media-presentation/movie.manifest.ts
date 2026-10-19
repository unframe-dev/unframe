import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "movie",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./movie.structure.tsx",
  },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: {
    default: {
      kind: "state",
      initial: true,
    },
    loop: {
      kind: "state",
    },
  },
  actions: {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "playMedia",
          surfaceId: "video-surface",
        },
      ],
    },
    pause: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "pauseMedia",
          surfaceId: "video-surface",
        },
      ],
    },
    seek: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "seekMedia",
          surfaceId: "video-surface",
          positionSeconds: {
            kind: "literal",
            value: 0.25,
          },
        },
      ],
    },
    loopOn: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "video-surface",
          stateId: "loop",
        },
      ],
    },
    loopOff: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setSurfaceState",
          surfaceId: "video-surface",
          stateId: "default",
        },
      ],
    },
  },
  outputs: {
    done: {
      kind: "output",
      payload: {},
      producer: {
        kind: "mediaCompleted",
        surfaceId: "video-surface",
      },
    },
  },
  renderers: ["baked-web"],
});
