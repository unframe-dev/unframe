import { pocTimelines } from "./poc.timelines";
import { reactionTimelines } from "./reaction.timelines";
import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const showTimelines = [
  {
    id: "closing",
    owner: { kind: "group", groupId: "closing" },
    durationMilliseconds: 2000,
    tracks: [
      {
        target: { kind: "instance", instanceId: "brand", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
          { timeMilliseconds: 2000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "brand", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1.6, 0.5], easingToNext: "linear" },
          { timeMilliseconds: 2000, value: [0, 1.6, 0.5] },
        ],
      },
    ],
  },
  ...pocTimelines,
  ...reactionTimelines,
  {
    id: "expression-draw",
    owner: {
      kind: "group",
      groupId: "expression",
    },
    durationMilliseconds: 800,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "expression-cube",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 200,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "expression-cube",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0.1, 0.1, 0.1],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 200,
            value: [0.1, 0.1, 0.1],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: [0.4, 0.4, 0.4],
          },
        ],
      },
    ],
  },
  {
    id: "expression-move",
    owner: {
      kind: "group",
      groupId: "expression",
    },
    durationMilliseconds: 1100,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "expression-cube",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0, 1.3, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1100,
            value: [-1.2, 2.2, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "expression-cube",
          property: "transform.rotation",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0, 0, 0, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1100,
            value: [0, 0.7071067811865476, 0, 0.7071067811865476],
          },
        ],
      },
    ],
  },
  {
    id: "expression-message",
    owner: { kind: "group", groupId: "expression" },
    durationMilliseconds: 700,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "expression-message",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 700,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "expression-message",
          property: "transform.position",
        },
        keyframes: [
          { timeMilliseconds: 0, value: [-1.2, 1.3, 1], easingToNext: "cubicOut" },
          { timeMilliseconds: 700, value: [-1.2, 1.5, 1] },
        ],
      },
    ],
  },
  {
    id: "expression-exit",
    owner: { kind: "group", groupId: "expression" },
    durationMilliseconds: 800,
    tracks: [
      {
        target: { kind: "instance", instanceId: "expression-cube", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-1.2, 2.2, 1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 800, value: [-3.2, 2.2, 1] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "expression-cube", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 800, value: 0 },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "expression-message",
          property: "transform.position",
        },
        keyframes: [
          { timeMilliseconds: 0, value: [-1.2, 1.5, 1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 800, value: [-3.2, 1.5, 1] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "expression-message", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 800, value: 0 },
        ],
      },
    ],
  },
  {
    id: "journey-frame",
    owner: {
      kind: "group",
      groupId: "journey",
    },
    durationMilliseconds: 800,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-left",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-right",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-before",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-cube",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-before",
          property: "transform.position",
        },
        keyframes: [
          { timeMilliseconds: 0, value: [-0.35, 1.5, 0.35], easingToNext: "cubicOut" },
          { timeMilliseconds: 800, value: [-0.35, 1.7, 0.35] },
        ],
      },
    ],
  },
  {
    id: "journey-goal",
    owner: {
      kind: "group",
      groupId: "journey",
    },
    durationMilliseconds: 2200,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-left",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: 1,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-right",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: 1,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-left",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-0.6, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: [-0.6, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: [-1.8, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: [-1.8, 1.4, 0.3],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-frame-right",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0.6, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: [0.6, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: [1.8, 1.4, 0.3],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: [1.8, 1.4, 0.3],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-before",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-cube",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0.55, 1.3, 0.35],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: [0.55, 1.3, 0.35],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: [0.85, 1.35, 0],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: [0.85, 1.35, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-cube",
          property: "transform.rotation",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0, 0, 0, 1],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 300,
            value: [0, 0, 0, 1],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: [0, 0.3826834324, 0, 0.9238795325],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: [0, 0.3826834324, 0, 0.9238795325],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "goal-after",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1500,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 2200,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "journey-exit",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 1000,
    tracks: [
      {
        target: { kind: "instance", instanceId: "goal-after", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1.6, 0.5], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: [0, 1.6, -2.4] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-after", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: [0.2, 0.2, 0.2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-after", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-cube", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.85, 1.35, 0], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: [0.85, 1.35, -2.9] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-cube", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.24, 0.24, 0.24], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: [0.048, 0.048, 0.048] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-cube", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 1000, value: 0 },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
