import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const reactionTimelines = [
  {
    id: "reaction-float-enter",
    owner: {
      kind: "group",
      groupId: "reaction-float",
    },
    durationMilliseconds: 700,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-float-text",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-1.1, 0.9, 0.25],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 700,
            value: [-1.1, 1.6, 0.25],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-float-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 700,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "reaction-bob",
    owner: {
      kind: "group",
      groupId: "reaction-float",
    },
    durationMilliseconds: 2000,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-float-text",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-1.1, 1.6, 0.25],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 500,
            value: [-1.1, 1.8, 0.25],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1500,
            value: [-1.1, 1.4, 0.25],
            easingToNext: "cubicIn",
          },
          {
            timeMilliseconds: 2000,
            value: [-1.1, 1.6, 0.25],
          },
        ],
      },
    ],
  },
  {
    id: "reaction-sense-enter",
    owner: {
      kind: "group",
      groupId: "reaction-sense",
    },
    durationMilliseconds: 700,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-sense-text",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1.8, 1.6, 0.25],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 700,
            value: [0, 1.6, 0.25],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-sense-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 700,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "reaction-gaze-focus",
    owner: {
      kind: "group",
      groupId: "reaction-sense",
    },
    durationMilliseconds: 1,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-float-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.32,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1,
            value: 0.32,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-sense-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.32,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1,
            value: 0.32,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-gaze-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "reaction-gaze-zoom",
    owner: {
      kind: "group",
      groupId: "reaction-sense",
    },
    durationMilliseconds: 800,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-gaze-text",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0.35, 0.35, 0.35],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 800,
            value: [1.24, 1.24, 1.24],
          },
        ],
      },
    ],
  },
  {
    id: "reaction-exit",
    owner: {
      kind: "group",
      groupId: "reaction-hold",
    },
    durationMilliseconds: 600,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "reaction-float-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.32,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 600,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-sense-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.32,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 600,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "reaction-gaze-text",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 600,
            value: 0,
          },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
