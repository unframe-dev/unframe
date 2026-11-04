import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const showTimelines = [
  {
    id: "expression",
    owner: { kind: "group", groupId: "expression" },
    durationMilliseconds: 2400,
    tracks: [
      {
        target: { kind: "instance", instanceId: "word-speak", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 600, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2400, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-speak", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-0.3, 1.4, -2], easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: [-1, 1.8, -2], easingToNext: "linear" },
          { timeMilliseconds: 2400, value: [-1, 1.8, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 450, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1050, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2400, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.3, 1.4, -2.3], easingToNext: "linear" },
          { timeMilliseconds: 450, value: [0.3, 1.4, -2.3], easingToNext: "cubicOut" },
          { timeMilliseconds: 1350, value: [1, 1.8, -2.3], easingToNext: "linear" },
          { timeMilliseconds: 2400, value: [1, 1.8, -2.3] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 900, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1500, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2400, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.0, 1.4, -1.8], easingToNext: "linear" },
          { timeMilliseconds: 900, value: [0.0, 1.4, -1.8], easingToNext: "cubicOut" },
          { timeMilliseconds: 1800, value: [0, 0.8, -1.8], easingToNext: "linear" },
          { timeMilliseconds: 2400, value: [0, 0.8, -1.8] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1350, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1950, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2400, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.0, 1.4, -2.1], easingToNext: "linear" },
          { timeMilliseconds: 1350, value: [0.0, 1.4, -2.1], easingToNext: "cubicOut" },
          { timeMilliseconds: 2250, value: [0, 1.5, -2.1], easingToNext: "linear" },
          { timeMilliseconds: 2400, value: [0, 1.5, -2.1] },
        ],
      },
    ],
  },
  {
    id: "journey-goal",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: { kind: "instance", instanceId: "word-speak", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-before", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-after", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
    ],
  },
  {
    id: "journey-challenge",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: { kind: "instance", instanceId: "goal-before", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "goal-after", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "challenge-author", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "challenge-sync", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "challenge-deliver", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 680, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1180, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
    ],
  },
  {
    id: "journey-prototype",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 1600,
    tracks: [
      {
        target: { kind: "instance", instanceId: "challenge-author", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1600, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "challenge-sync", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1600, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "challenge-deliver", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1600, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "prototype-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1600, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1600, value: 1 },
        ],
      },
    ],
  },
  {
    id: "journey-discovery",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 1200,
    tracks: [
      {
        target: { kind: "instance", instanceId: "prototype-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "discovery-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1200, value: 1 },
        ],
      },
    ],
  },
  {
    id: "journey-exit",
    owner: { kind: "group", groupId: "journey" },
    durationMilliseconds: 350,
    tracks: [
      {
        target: { kind: "instance", instanceId: "discovery-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0 },
        ],
      },
    ],
  },
  {
    id: "comparison-expected",
    owner: { kind: "group", groupId: "comparison" },
    durationMilliseconds: 3000,
    tracks: [
      {
        target: { kind: "instance", instanceId: "expected-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "transform.rotation" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0, 0, 1], easingToNext: "linear" },
          { timeMilliseconds: 1500, value: [0, 1, 0, 0], easingToNext: "linear" },
          { timeMilliseconds: 3000, value: [0, 0, 0, -1] },
        ],
      },
    ],
  },
  {
    id: "comparison-observed",
    owner: { kind: "group", groupId: "comparison" },
    durationMilliseconds: 3000,
    tracks: [
      {
        target: { kind: "instance", instanceId: "expected-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "comparison-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-speak", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 680, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1180, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 820, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1320, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1.25, -2.1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 3000, value: [1.1, 1.35, -2.2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.6, 0.6, 0.6], easingToNext: "cubicOut" },
          { timeMilliseconds: 1600, value: [1, 1, 1], easingToNext: "linear" },
          { timeMilliseconds: 3000, value: [1, 1, 1] },
        ],
      },
    ],
  },
  {
    id: "showcase",
    owner: { kind: "group", groupId: "comparison" },
    durationMilliseconds: 5400,
    tracks: [
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1.5, -2.1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1400, value: [-1.15, 0.95, -2], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [-1.15, 0.95, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1400, value: [0.6, 0.6, 0.6], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [0.6, 0.6, 0.6] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "comparison-word", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 5400, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 680, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1180, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 5400, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [1.1, 1.35, -2.2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1400, value: [-0.9, 1.4, -2.2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 3400, value: [0.7, 1.6, -1.8], easingToNext: "cubicInOut" },
          { timeMilliseconds: 4400, value: [0, 1.45, -2], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [0, 1.45, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.55, 0.55, 0.55], easingToNext: "cubicInOut" },
          { timeMilliseconds: 1400, value: [0.55, 0.55, 0.55], easingToNext: "cubicInOut" },
          { timeMilliseconds: 3400, value: [1.15, 1.15, 1.15], easingToNext: "cubicInOut" },
          { timeMilliseconds: 4400, value: [0.8, 0.8, 0.8], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [0.8, 0.8, 0.8] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "transform.rotation" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0, 0, -1], easingToNext: "linear" },
          { timeMilliseconds: 1700, value: [0, -1, 0, 0], easingToNext: "linear" },
          { timeMilliseconds: 3400, value: [0, 0, 0, 1], easingToNext: "linear" },
          {
            timeMilliseconds: 4400,
            value: [0, 0.3826834324, 0, 0.9238795325],
            easingToNext: "linear",
          },
          { timeMilliseconds: 5400, value: [0, 0.3826834324, 0, 0.9238795325] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-speak", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-1, 1.8, -2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 4400, value: [-1.05, 1.95, -2.2], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [-1.05, 1.95, -2.2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [1, 1.8, -2.3], easingToNext: "cubicInOut" },
          { timeMilliseconds: 4400, value: [1.05, 1.95, -2.2], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [1.05, 1.95, -2.2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0.8, -1.8], easingToNext: "cubicInOut" },
          { timeMilliseconds: 4400, value: [0, 0.65, -1.8], easingToNext: "linear" },
          { timeMilliseconds: 5400, value: [0, 0.65, -1.8] },
        ],
      },
    ],
  },
  {
    id: "technology",
    owner: { kind: "group", groupId: "technology" },
    durationMilliseconds: 1800,
    tracks: [
      {
        target: { kind: "instance", instanceId: "word-speak", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-move", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "word-space", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "gesture-drawing", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "show-cube", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicIn" },
          { timeMilliseconds: 350, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-control", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 400, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-realtime", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 540, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1040, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-unity", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 680, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1180, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-web", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 820, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1320, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-assets", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 960, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1460, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-links", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 960, value: 0, easingToNext: "cubicOut" },
          { timeMilliseconds: 1460, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 1800, value: 1 },
        ],
      },
    ],
  },
  {
    id: "closing",
    owner: { kind: "group", groupId: "technology" },
    durationMilliseconds: 3700,
    tracks: [
      {
        target: { kind: "instance", instanceId: "tech-control", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-realtime", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-unity", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-web", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-assets", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "tech-links", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 700, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "brand", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2800, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "brand", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-1.35872, 2.45, -2], easingToNext: "linear" },
          { timeMilliseconds: 700, value: [-1.35872, 2.45, -2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 2000, value: [0.254, 1.6, -2], easingToNext: "linear" },
          { timeMilliseconds: 3700, value: [0.254, 1.6, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "brand", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.32, 0.32, 0.32], easingToNext: "linear" },
          { timeMilliseconds: 700, value: [0.32, 0.32, 0.32], easingToNext: "cubicInOut" },
          { timeMilliseconds: 2000, value: [1, 1, 1], easingToNext: "linear" },
          { timeMilliseconds: 3700, value: [1, 1, 1] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "logo", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 2800, value: 1, easingToNext: "cubicInOut" },
          { timeMilliseconds: 3700, value: 0 },
        ],
      },
      {
        target: { kind: "instance", instanceId: "logo", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [-1.64608, 2.45, -2], easingToNext: "linear" },
          { timeMilliseconds: 700, value: [-1.64608, 2.45, -2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 2000, value: [-0.644, 1.6, -2], easingToNext: "linear" },
          { timeMilliseconds: 3700, value: [-0.644, 1.6, -2] },
        ],
      },
      {
        target: { kind: "instance", instanceId: "logo", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [0.128, 0.128, 0.128], easingToNext: "linear" },
          { timeMilliseconds: 700, value: [0.128, 0.128, 0.128], easingToNext: "cubicInOut" },
          { timeMilliseconds: 2000, value: [0.4, 0.4, 0.4], easingToNext: "linear" },
          { timeMilliseconds: 3700, value: [0.4, 0.4, 0.4] },
        ],
      },
    ],
  },
] as const satisfies readonly SceneTimelineDeclaration[];
