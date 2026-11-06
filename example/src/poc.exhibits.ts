import type { SceneTimelineDeclaration } from "@unframe-dev/authoring";
import { OriginalPanel } from "./component/original-panel.component";

const exhibit = {
  owner: { kind: "group", groupId: "poc-history" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  opacity: 0,
} as const;
const cube = { ...exhibit, model: { kind: "asset-ref", assetId: "demo-cube" } } as const;

export const pocExhibits = [
  {
    ...cube,
    id: "poc-3d-model",
    transform: { position: [-0.48, 0.88, 0.38], rotation: [0, 0, 0, 1], scale: [0.34, 0.34, 0.34] },
  },
  {
    ...exhibit,
    id: "poc-3d-panel",
    component: OriginalPanel,
    props: {},
    physicalSizeMeters: [0.68, 0.4352],
    fit: "contain",
    transform: { position: [0.38, 0.88, 0.25], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  },
  {
    ...cube,
    id: "poc-ring-1",
    transform: { position: [0, 0.74, 0.44], rotation: [0, 0, 0, 1], scale: [0.18, 0.18, 0.18] },
  },
  {
    ...cube,
    id: "poc-ring-2",
    transform: { position: [0.485, 0.74, 0.72], rotation: [0, 0, 0, 1], scale: [0.18, 0.18, 0.18] },
  },
  {
    ...cube,
    id: "poc-ring-3",
    transform: { position: [0.485, 0.74, 1.28], rotation: [0, 0, 0, 1], scale: [0.18, 0.18, 0.18] },
  },
  {
    ...cube,
    id: "poc-ring-4",
    transform: { position: [0, 0.74, 1.56], rotation: [0, 0, 0, 1], scale: [0.18, 0.18, 0.18] },
  },
  {
    ...cube,
    id: "poc-ring-5",
    transform: {
      position: [-0.485, 0.74, 1.28],
      rotation: [0, 0, 0, 1],
      scale: [0.18, 0.18, 0.18],
    },
  },
  {
    ...cube,
    id: "poc-ring-6",
    transform: {
      position: [-0.485, 0.74, 0.72],
      rotation: [0, 0, 0, 1],
      scale: [0.18, 0.18, 0.18],
    },
  },
  {
    ...cube,
    id: "poc-museum-1",
    transform: { position: [-1.2, 0.72, 0.72], rotation: [0, 0, 0, 1], scale: [0.28, 0.28, 0.28] },
  },
  {
    ...cube,
    id: "poc-museum-2",
    transform: { position: [0.15, 0.91, 1.5], rotation: [0, 0, 0, 1], scale: [0.23, 0.23, 0.23] },
  },
  {
    ...cube,
    id: "poc-museum-3",
    transform: { position: [1.23, 0.55, 1.12], rotation: [0, 0, 0, 1], scale: [0.33, 0.33, 0.33] },
  },
] as const;

export const pocExhibitFocus1 = [
  {
    target: { kind: "instance", instanceId: "poc-3d-model", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-3d-panel", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
] as const satisfies SceneTimelineDeclaration["tracks"];

export const pocExhibitFocus2 = [
  {
    target: { kind: "instance", instanceId: "poc-3d-model", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-3d-panel", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-1", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-2", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-3", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-4", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-5", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-6", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
] as const satisfies SceneTimelineDeclaration["tracks"];

export const pocExhibitFocus3 = [
  {
    target: { kind: "instance", instanceId: "poc-ring-1", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-2", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-3", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-4", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-5", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-ring-6", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-1", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-2", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-3", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
      { timeMilliseconds: 400, value: 1 },
    ],
  },
] as const satisfies SceneTimelineDeclaration["tracks"];

export const pocExhibitExit = [
  {
    target: { kind: "instance", instanceId: "poc-museum-1", property: "transform.position" },
    keyframes: [
      { timeMilliseconds: 0, value: [-1.2, 0.72, 0.72], easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: [0.8, 0.72, 0.72] },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-1", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-2", property: "transform.position" },
    keyframes: [
      { timeMilliseconds: 0, value: [0.15, 0.91, 1.5], easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: [2.15, 0.91, 1.5] },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-2", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: 0 },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-3", property: "transform.position" },
    keyframes: [
      { timeMilliseconds: 0, value: [1.23, 0.55, 1.12], easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: [3.23, 0.55, 1.12] },
    ],
  },
  {
    target: { kind: "instance", instanceId: "poc-museum-3", property: "opacity" },
    keyframes: [
      { timeMilliseconds: 0, value: 1, easingToNext: "cubicInOut" },
      { timeMilliseconds: 800, value: 0 },
    ],
  },
] as const satisfies SceneTimelineDeclaration["tracks"];
