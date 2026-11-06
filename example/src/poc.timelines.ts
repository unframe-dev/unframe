import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";
import {
  pocExhibitExit,
  pocExhibitFocus1,
  pocExhibitFocus2,
  pocExhibitFocus3,
} from "./poc.exhibits";

export const pocTimelines = [
  {
    id: "poc-exit",
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    durationMilliseconds: 800,
    tracks: [
      ...pocExhibitExit,
      {
        target: {
          kind: "instance",
          instanceId: "poc-heading",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-0.95, 2.25, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [1.05, 2.25, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-heading",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-1.65, 1.4, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [0.3500000000000001, 1.4, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0, 1.4, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [2, 1.4, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1.65, 1.4, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [3.65, 1.4, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-1",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [-0.825, 1.4, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [1.175, 1.4, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-2",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0.825, 1.4, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: [2.825, 1.4, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 800,
            value: 0,
          },
        ],
      },
    ],
  },
  {
    id: "poc-overview",
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    durationMilliseconds: 3000,
    tracks: [
      {
        target: {
          kind: "instance",
          instanceId: "poc-heading",
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
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-heading",
          property: "transform.position",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [0, 1.6, -1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 700,
            value: [0, 1.6, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1000,
            value: [0, 1.6, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1800,
            value: [-0.95, 2.25, 0],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: [-0.95, 2.25, 0],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-heading",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1000,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1800,
            value: [0.65, 0.65, 0.65],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: [0.65, 0.65, 0.65],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 1800,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2200,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2000,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2400,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2200,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2600,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2400,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2800,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 2600,
            value: 0,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 3000,
            value: 1,
          },
        ],
      },
    ],
  },
  {
    id: "poc-focus-1",
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    durationMilliseconds: 400,
    tracks: [
      ...pocExhibitFocus1,
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1.25, 1.25, 1.25],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-arrow-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
    ],
  },
  {
    id: "poc-focus-2",
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    durationMilliseconds: 400,
    tracks: [
      ...pocExhibitFocus2,
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1.25, 1.25, 1.25],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1.25, 1.25, 1.25],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
    ],
  },
  {
    id: "poc-focus-3",
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    durationMilliseconds: 400,
    tracks: [
      ...pocExhibitFocus3,
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-1",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 1,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 0.25,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-2",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1.25, 1.25, 1.25],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1, 1, 1],
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "opacity",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: 0.25,
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: 1,
          },
        ],
      },
      {
        target: {
          kind: "instance",
          instanceId: "poc-item-3",
          property: "transform.scale",
        },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [1, 1, 1],
            easingToNext: "cubicInOut",
          },
          {
            timeMilliseconds: 400,
            value: [1.25, 1.25, 1.25],
          },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
