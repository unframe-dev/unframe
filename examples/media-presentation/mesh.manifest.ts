import { defineComponentManifest } from "@unframe/unframe-authoring";

export default defineComponentManifest({
  componentId: "mesh",
  version: 1,
  authoring: {
    mode: "structured",
    structure: "./mesh.structure.tsx",
  },
  props: {},
  slots: {},
  parts: {},
  variants: {},
  states: {},
  actions: {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "playModelClip",
          nodeId: "model-root",
          clipId: "clip-0",
          speed: 1,
          loop: true,
          completion: "nonBlocking",
          transition: {
            kind: "immediate",
          },
          conflict: "reject",
        },
      ],
    },
    crossfade: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "playModelClip",
          nodeId: "model-root",
          clipId: "clip-1",
          speed: 1,
          loop: false,
          completion: "nonBlocking",
          transition: {
            kind: "crossfade",
            durationMilliseconds: 400,
            easing: "linear",
          },
          conflict: "reject",
        },
      ],
    },
    pause: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "pauseModelClip",
          nodeId: "model-root",
        },
      ],
    },
    resume: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "resumeModelClip",
          nodeId: "model-root",
        },
      ],
    },
    stop: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "stopModelClip",
          nodeId: "model-root",
        },
      ],
    },
  },
  outputs: {
    done: {
      kind: "output",
      payload: {},
      producer: {
        kind: "modelClipCompleted",
        nodeId: "model-root",
        clipId: "clip-1",
      },
    },
  },
  renderers: [],
});
