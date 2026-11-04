import { definePresentation } from "@unframe-dev/authoring";
import { OpeningBrand } from "./opening.component";
import { OriginalPanel } from "./original-panel.component";
import { originalTimelines } from "./original.timelines";
import { RejectionMark } from "./rejection.component";
import { rejectionTimeline } from "./rejection.timeline";

import { showScene } from "./show.scene";
import { originalDismissed, showGroups } from "./show.flow";
import { showTimelines } from "./show.timelines";

export default definePresentation({
  id: "presentation-8928636a-3e4f-49ac-8d2a-c0bfa3be8219",
  metadata: { title: "Unframe — 成果発表会 MR デモ" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3.2, 4],
  },
  assets: [
    { kind: "asset-ref", assetId: "logo-model" },
    { kind: "asset-ref", assetId: "demo-cube" },
  ],
  scene: [
    {
      id: "rejection-mark",
      component: RejectionMark,
      props: {},
      owner: { kind: "group", groupId: "demo" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.4, 1.4],
      fit: "contain",
      opacity: 0,
      transform: { position: [0, 1.4, -1.5], rotation: [0, 0, 0, 1], scale: [0.8, 0.8, 0.8] },
    },
    {
      id: "brand",
      component: OpeningBrand,
      props: { wordmark: "Unframe" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.28, 0.44],
      fit: "contain",
      opacity: 0,
      transform: { position: [0.254, 1.6, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: "logo",
      model: { kind: "asset-ref", assetId: "logo-model" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 0,
      transform: {
        position: [-0.644, 1.6, -2],
        rotation: [0, 0.7071067811865476, 0.7071067811865476, 0],
        scale: [0.4, 0.4, 0.4],
      },
    },
    {
      id: "original-panel",
      component: OriginalPanel,
      props: {},
      owner: { kind: "group", groupId: "demo" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.72, 1.1008],
      fit: "contain",
      opacity: 0,
      transform: { position: [-0.52, 1.25, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: "demo-cube",
      model: { kind: "asset-ref", assetId: "demo-cube" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 0,
      transform: {
        position: [1.16, 1.28, -2.05],
        rotation: [
          -0.1205904774487396, 0.37940952255126037, 0.049950211252314816, 0.9159756150367534,
        ],
        scale: [0.7, 0.7, 0.7],
      },
    },
    ...showScene,
  ],
  flow: {
    initialGroupId: "demo",
    groups: {
      demo: {
        id: "demo",
        initialStepId: "opening",
        steps: {
          opening: {
            id: "opening",
            cues: [
              {
                id: "show-opening",
                trigger: { kind: "timer", afterMilliseconds: 1 },
                actions: [
                  { kind: "timeline.play", timelineId: "opening", completion: "nonBlocking" },
                ],
              },
              {
                id: "opening-complete",
                trigger: { kind: "timelineCompleted", timelineId: "opening" },
                actions: [],
                next: { kind: "step", stepId: "opening-ready" },
              },
            ],
          },
          "opening-ready": {
            id: "opening-ready",
            cues: [
              {
                id: "next-scene",
                trigger: { kind: "logicalInput", action: "presenter.next" },
                actions: [],
                next: { kind: "step", stepId: "original-enter" },
              },
            ],
          },
          "original-enter": {
            id: "original-enter",
            cues: [
              {
                id: "show-original",
                trigger: { kind: "timer", afterMilliseconds: 1 },
                actions: [
                  {
                    kind: "timeline.play",
                    timelineId: "original-enter",
                    completion: "nonBlocking",
                  },
                ],
              },
              {
                id: "original-visible",
                trigger: { kind: "timelineCompleted", timelineId: "original-enter" },
                actions: [],
                next: { kind: "step", stepId: "original-intro" },
              },
            ],
          },
          "original-intro": {
            id: "original-intro",
            cues: [
              {
                id: "next-panel",
                trigger: { kind: "logicalInput", action: "presenter.next" },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "original-panel",
                    actionId: "advance",
                    arguments: {},
                  },
                ],
                next: { kind: "step", stepId: "original-detail" },
              },
            ],
          },
          "original-detail": {
            id: "original-detail",
            cues: [
              {
                id: "rotate-cube",
                trigger: { kind: "logicalInput", action: "presenter.rotate" },
                actions: [
                  { kind: "timeline.play", timelineId: "cube-turn", completion: "nonBlocking" },
                ],
                next: { kind: "step", stepId: "original-shown" },
              },
            ],
          },
          "original-shown": {
            id: "original-shown",
            cues: [
              {
                id: "reject-original",
                trigger: { kind: "logicalInput", action: "presenter.next" },
                actions: [],
                next: { kind: "step", stepId: "original-reject" },
              },
            ],
          },
          "original-reject": {
            id: "original-reject",
            cues: [
              {
                id: "dismiss-original",
                trigger: { kind: "timer", afterMilliseconds: 1 },
                actions: [
                  {
                    kind: "timeline.play",
                    timelineId: "original-reject",
                    completion: "nonBlocking",
                  },
                ],
              },
              {
                id: "original-dismissed",
                trigger: { kind: "timelineCompleted", timelineId: "original-reject" },
                actions: [],
                next: { kind: "step", stepId: "original-dismissed" },
              },
            ],
          },
          "original-dismissed": originalDismissed,
        },
      },
      ...showGroups,
    },
    timelines: [
      {
        id: "opening",
        durationMilliseconds: 3000,
        tracks: [
          {
            target: { kind: "instance", instanceId: "brand", property: "opacity" },
            keyframes: [
              { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
              { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 3000, value: 1 },
            ],
          },
          {
            target: { kind: "instance", instanceId: "brand", property: "transform.position" },
            keyframes: [
              { timeMilliseconds: 0, value: [0.254, 1.6, -2], easingToNext: "linear" },
              { timeMilliseconds: 1700, value: [0.254, 1.6, -2], easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: [-1.35872, 2.45, -2] },
            ],
          },
          {
            target: { kind: "instance", instanceId: "brand", property: "transform.scale" },
            keyframes: [
              { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "linear" },
              { timeMilliseconds: 1700, value: [1, 1, 1], easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: [0.32, 0.32, 0.32] },
            ],
          },
          {
            target: { kind: "instance", instanceId: "logo", property: "opacity" },
            keyframes: [
              { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
              { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 3000, value: 1 },
            ],
          },
          {
            target: { kind: "instance", instanceId: "logo", property: "transform.position" },
            keyframes: [
              { timeMilliseconds: 0, value: [-0.644, 1.6, -2], easingToNext: "linear" },
              { timeMilliseconds: 1700, value: [-0.644, 1.6, -2], easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: [-1.64608, 2.45, -2] },
            ],
          },
          {
            target: { kind: "instance", instanceId: "logo", property: "transform.scale" },
            keyframes: [
              { timeMilliseconds: 0, value: [0.4, 0.4, 0.4], easingToNext: "linear" },
              { timeMilliseconds: 1700, value: [0.4, 0.4, 0.4], easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: [0.128, 0.128, 0.128] },
            ],
          },
        ],
      },
      ...originalTimelines,
      rejectionTimeline,
      ...showTimelines,
    ],
    variables: {},
  },
  operations: [],
});
