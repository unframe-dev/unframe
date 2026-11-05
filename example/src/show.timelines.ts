import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const showTimelines = [
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
    durationMilliseconds: 1800,
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
            value: [0, 1.3, -1.5],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1100,
            value: [0, 1.6, -3],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1800,
            value: [0, 1.6, -3],
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
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1800,
            value: [0, 0.7071067811865476, 0, 0.7071067811865476],
          },
        ],
      },
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
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1100,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1800,
            value: 1,
          },
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
    ],
  },
  {
    id: "journey-goal",
    owner: {
      kind: "group",
      groupId: "journey",
    },
    durationMilliseconds: 1200,
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
            timeMilliseconds: 1200,
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
            timeMilliseconds: 1200,
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
            value: [-0.6, 1.4, -2.2],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1200,
            value: [-1.8, 1.4, -2.2],
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
            value: [0.6, 1.4, -2.2],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1200,
            value: [1.8, 1.4, -2.2],
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
          {
            timeMilliseconds: 0,
            value: [-0.35, 1.7, -2.15],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1200,
            value: [-0.8, 1.9, -2.8],
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
            value: [0.55, 1.3, -2.15],
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 1200,
            value: [0.85, 1.35, -1.4],
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
            timeMilliseconds: 1200,
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
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "conditions",
    owner: {
      kind: "group",
      groupId: "conditions",
    },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "conditions-title",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 500,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "condition-content",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 120,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 620,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "condition-action",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 240,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 740,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "condition-space",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 360,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 860,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "condition-sharing",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 480,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 980,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "content-action",
    owner: {
      kind: "group",
      groupId: "content-action",
    },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "action-title",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 500,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "action-gesture",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 120,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 620,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "action-zone",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 240,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 740,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "action-message",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 360,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 860,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "space-sharing",
    owner: {
      kind: "group",
      groupId: "space-sharing",
    },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "sharing-title",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 500,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "sharing-place",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 120,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 620,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "sharing-progress",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 240,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 740,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "sharing-message",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 360,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 860,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "summary",
    owner: {
      kind: "group",
      groupId: "summary",
    },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "summary-content",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 500,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "summary-body-space",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 120,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 620,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "summary-audience",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 240,
            value: 0,
            easingToNext: "cubicOut",
          },
          {
            timeMilliseconds: 740,
            value: 1,
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 1200,
            value: 1,
          },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
