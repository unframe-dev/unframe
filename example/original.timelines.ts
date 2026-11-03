import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const originalTimelines = [
  {
    id: "original-enter",
    durationMilliseconds: 860,
    tracks: [
      {
        target: { kind: "instance", instanceId: "original-panel", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 700, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 860, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "original-panel", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-0.52, 1.25, -2], easingToNext: "cubicOut" },
          { timeMilliseconds: 700, value: [-0.52, 1.35, -2], easingToNext: "linear" },
          { timeMilliseconds: 860, value: [-0.52, 1.35, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "demo-cube", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 160, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 860, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "demo-cube", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [1.16, 1.28, -2.05], easingToNext: "linear" },
          { timeMilliseconds: 160, value: [1.16, 1.28, -2.05], easingToNext: "cubicOut" },
          { timeMilliseconds: 860, value: [1.16, 1.38, -2.05] },
        ],
      },
    ],
  },
  {
    id: "cube-turn",
    durationMilliseconds: 10000,
    tracks: [
      {
        target: { kind: "instance", instanceId: "demo-cube", property: "transform.rotation" },
        keyframes: [
          {
            timeMilliseconds: 0,
            value: [
              -0.1205904774487396, 0.37940952255126037, 0.049950211252314816, 0.9159756150367534,
            ],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 2500,
            value: [
              -0.04995021125231482, 0.9159756150367534, 0.1205904774487396, 0.3794095225512604,
            ],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 5000,
            value: [
              0.04995021125231481, 0.9159756150367534, 0.1205904774487396, -0.3794095225512603,
            ],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 7500,
            value: [
              0.1205904774487396, 0.3794095225512605, 0.04995021125231483, -0.9159756150367534,
            ],
            easingToNext: "linear",
          },
          {
            timeMilliseconds: 10000,
            value: [
              -0.1205904774487396, 0.37940952255126037, 0.049950211252314816, 0.9159756150367534,
            ],
          },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
