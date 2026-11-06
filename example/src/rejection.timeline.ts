import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";

export const rejectionTimeline = {
  id: "original-reject",
  owner: { kind: "group", groupId: "demo" },
  durationMilliseconds: 2120,
  tracks: [
    {
      target: { kind: "instance", instanceId: "rejection-mark", property: "opacity" },
      keyframes: [
        { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
        { timeMilliseconds: 600, value: 0, easingToNext: "cubicOut" },
        { timeMilliseconds: 820, value: 1, easingToNext: "linear" },
        { timeMilliseconds: 1420, value: 1, easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: 0 },
      ],
    },
    {
      target: { kind: "instance", instanceId: "rejection-mark", property: "transform.scale" },
      keyframes: [
        { timeMilliseconds: 0, value: [0.8, 0.8, 0.8], easingToNext: "linear" },
        { timeMilliseconds: 600, value: [0.8, 0.8, 0.8], easingToNext: "cubicOut" },
        { timeMilliseconds: 820, value: [1, 1, 1], easingToNext: "linear" },
        { timeMilliseconds: 1420, value: [1, 1, 1], easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: [0.75, 0.75, 0.75] },
      ],
    },
    {
      target: { kind: "instance", instanceId: "rejection-mark", property: "transform.position" },
      keyframes: [
        { timeMilliseconds: 0, value: [0, 1.4, 1], easingToNext: "linear" },
        { timeMilliseconds: 1420, value: [0, 1.4, 1], easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: [0, 0.95, 1] },
      ],
    },
    {
      target: { kind: "instance", instanceId: "original-panel", property: "opacity" },
      keyframes: [
        { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
        { timeMilliseconds: 1420, value: 1, easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: 0 },
      ],
    },
    {
      target: { kind: "instance", instanceId: "original-panel", property: "transform.position" },
      keyframes: [
        { timeMilliseconds: 0, value: [-0.52, 1.35, 0.5], easingToNext: "linear" },
        { timeMilliseconds: 1420, value: [-0.52, 1.35, 0.5], easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: [-0.52, 0.9, 0.5] },
      ],
    },
    {
      target: { kind: "instance", instanceId: "demo-cube", property: "opacity" },
      keyframes: [
        { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
        { timeMilliseconds: 1420, value: 1, easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: 0 },
      ],
    },
    {
      target: { kind: "instance", instanceId: "demo-cube", property: "transform.position" },
      keyframes: [
        { timeMilliseconds: 0, value: [1.16, 1.38, 0.45], easingToNext: "linear" },
        { timeMilliseconds: 1420, value: [1.16, 1.38, 0.45], easingToNext: "cubicIn" },
        { timeMilliseconds: 2120, value: [1.16, 0.93, 0.45] },
      ],
    },
  ],
} as const satisfies SceneTimelineDeclaration;
