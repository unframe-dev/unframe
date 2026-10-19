import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "controls",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./controls.structure.tsx",
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
  },
  actions: {
    pulse: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "playTimeline",
          timelineId: "pulse",
          completion: "nonBlocking",
        },
      ],
    },
    clipFinished: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setVariable",
          variableId: "clipFinished",
          value: {
            kind: "literal",
            value: true,
          },
        },
      ],
    },
    videoFinished: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "setVariable",
          variableId: "videoFinished",
          value: {
            kind: "literal",
            value: true,
          },
        },
      ],
    },
  },
  outputs: {
    start: {
      kind: "output",
      payload: {},
      producer: {
        kind: "timer",
        afterMilliseconds: 100,
      },
    },
    modelPlay: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "modelPlay",
      },
    },
    modelPause: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "modelPause",
      },
    },
    modelResume: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "modelResume",
      },
    },
    modelStop: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "modelStop",
      },
    },
    modelFade: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "modelFade",
      },
    },
    videoPlay: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "videoPlay",
      },
    },
    videoPause: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "videoPause",
      },
    },
    videoSeek: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "videoSeek",
      },
    },
    loopOn: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "loopOn",
      },
    },
    loopOff: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "loopOff",
      },
    },
    pulse: {
      kind: "output",
      payload: {},
      producer: {
        kind: "surfaceInteraction",
        interactionId: "pulse",
      },
    },
  },
  renderers: ["baked-web"],
});
