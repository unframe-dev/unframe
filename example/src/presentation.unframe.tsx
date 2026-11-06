import { pocScene } from "./poc.scene";
import { reactionScene } from "./reaction.scene";
import { SlideFrame } from "./component/slide-frame.component";
import { definePresentation } from "@unframe-dev/authoring";
import { OpeningBrand } from "./component/opening.component";
import { openingWaveStarts, openingWaveStops } from "./opening.effects";
import { OriginalPanel } from "./component/original-panel.component";
import { originalTimelines } from "./original.timelines";
import { RejectionMark } from "./component/rejection.component";
import { rejectionTimeline } from "./rejection.timeline";

import { SpatialWord } from "./component/spatial-word.component";
import { originalDismissed, showGroups } from "./show.flow";
import { showTimelines } from "./show.timelines";

export default definePresentation({
  id: "presentation-8928636a-3e4f-49ac-8d2a-c0bfa3be8219",
  metadata: { title: "Unframe — 成果発表会 MR デモ" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3.2, 4],
    zones: {
      "closing-stage": {
        id: "closing-stage",
        owner: { kind: "group", groupId: "closing-wait" },
        center: [-1.8, 0.8, 0],
      },
      "reaction-gaze-stage": {
        id: "reaction-gaze-stage",
        owner: { kind: "group", groupId: "reaction-sense" },
        center: [1.8, 0.8, 0],
      },
      "journey-stage": {
        id: "journey-stage",
        owner: { kind: "group", groupId: "journey" },
        center: [-1.8, 0.8, 0],
      },
    },
  },
  assets: [
    { kind: "asset-ref", assetId: "logo-model" },
    { kind: "asset-ref", assetId: "demo-cube" },
    { kind: "asset-ref", assetId: "wave-anchor" },
  ],
  scene: [
    ...pocScene,
    ...reactionScene,
    {
      id: "goal-frame-left",
      component: SlideFrame,
      props: {},
      owner: { kind: "group", groupId: "journey" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.2, 1.35],
      fit: "contain",
      opacity: 0,
      transform: {
        position: [-0.6, 1.4, 0.3],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    {
      id: "goal-frame-right",
      component: SlideFrame,
      props: {},
      owner: { kind: "group", groupId: "journey" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.2, 1.35],
      fit: "contain",
      opacity: 0,
      transform: {
        position: [0.6, 1.4, 0.3],
        rotation: [0, 0, 1, 0],
        scale: [1, 1, 1],
      },
    },
    {
      id: "goal-cube",
      model: {
        kind: "asset-ref",
        assetId: "demo-cube",
      },
      owner: {
        kind: "group",
        groupId: "journey",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "stage",
      },
      opacity: 0,
      transform: {
        position: [0.55, 1.3, 0.35],
        rotation: [0, 0, 0, 1],
        scale: [0.24, 0.24, 0.24],
      },
    },
    {
      id: "expression-left-hand",
      model: {
        kind: "asset-ref",
        assetId: "wave-anchor",
      },
      owner: {
        kind: "group",
        groupId: "expression",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "anchor",
        owner: {
          kind: "presenter",
        },
        target: "leftHand",
        followPosition: true,
        followRotation: false,
      },
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    {
      id: "expression-right-hand",
      model: {
        kind: "asset-ref",
        assetId: "wave-anchor",
      },
      owner: {
        kind: "group",
        groupId: "expression",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "anchor",
        owner: {
          kind: "presenter",
        },
        target: "rightHand",
        followPosition: true,
        followRotation: false,
      },
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    {
      id: "expression-cube",
      model: {
        kind: "asset-ref",
        assetId: "demo-cube",
      },
      owner: {
        kind: "group",
        groupId: "expression",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "stage",
      },
      opacity: 0,
      transform: {
        position: [0, 1.3, 1],
        rotation: [0, 0, 0, 1],
        scale: [0.4, 0.4, 0.4],
      },
    },
    {
      id: "expression-trail-root",
      model: {
        kind: "asset-ref",
        assetId: "wave-anchor",
      },
      owner: {
        kind: "group",
        groupId: "expression",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "stage",
      },
      opacity: 1,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    {
      id: "expression-message",
      component: SpatialWord,
      props: {
        text: "動きも、表現になる。",
      },
      owner: {
        kind: "group",
        groupId: "expression",
      },
      audience: {
        kind: "all",
      },
      parent: {
        kind: "stage",
      },
      physicalSizeMeters: [2.6, 0.7222],
      fit: "contain",
      opacity: 0,
      transform: {
        position: [-1.2, 1.5, 1],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
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
      transform: { position: [0, 1.4, 1], rotation: [0, 0, 0, 1], scale: [0.8, 0.8, 0.8] },
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
      transform: { position: [0.381, 1.6, 0.5], rotation: [0, 0, 0, 1], scale: [1.5, 1.5, 1.5] },
    },
    {
      id: "logo",
      model: { kind: "asset-ref", assetId: "logo-model" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 0,
      transform: {
        position: [-0.966, 1.6, 0.5],
        rotation: [0, 0.7071067811865476, 0.7071067811865476, 0],
        scale: [0.6, 0.6, 0.6],
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
      transform: { position: [-0.52, 1.25, 0.5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: "demo-cube",
      model: { kind: "asset-ref", assetId: "demo-cube" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 0,
      transform: {
        position: [1.16, 1.28, 0.45],
        rotation: [
          -0.1205904774487396, 0.37940952255126037, 0.049950211252314816, 0.9159756150367534,
        ],
        scale: [0.7, 0.7, 0.7],
      },
    },
    {
      model: { kind: "asset-ref", assetId: "wave-anchor" },
      owner: { kind: "group", groupId: "demo" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 1,
      id: "opening-wave-bottom-left",
      transform: { position: [-2.1, 0.4, 0.3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      model: { kind: "asset-ref", assetId: "wave-anchor" },
      owner: { kind: "group", groupId: "demo" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      opacity: 1,
      id: "opening-wave-top-right",
      transform: { position: [2.1, 2.8, 0.3], rotation: [0, 1, 0, 0], scale: [1, 1, 1] },
    },
    {
      id: "goal-before",
      component: SpatialWord,
      props: { text: "スライドを空間へ" },
      owner: { kind: "group", groupId: "journey" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.5, 0.4167],
      fit: "contain",
      opacity: 0,
      transform: { position: [-0.35, 1.7, 0.35], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: "goal-after",
      component: SpatialWord,
      props: { text: "動きに連動する" },
      owner: { kind: "group", groupId: "journey" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.4444],
      fit: "contain",
      opacity: 0,
      transform: { position: [0, 1.6, 0.5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  flow: {
    initialGroupId: "demo",
    groups: {
      demo: {
        id: "demo",
        initialStepId: "opening-wait",
        steps: {
          "opening-wait": {
            id: "opening-wait",
            cues: [
              {
                id: "start-opening",
                trigger: { kind: "logicalInput", action: "presenter.next" },
                actions: [],
                next: { kind: "step", stepId: "opening" },
              },
            ],
          },
          opening: {
            id: "opening",
            cues: [
              {
                id: "show-opening",
                trigger: { kind: "timer", afterMilliseconds: 1 },
                actions: [
                  { kind: "timeline.play", timelineId: "opening", completion: "nonBlocking" },
                  ...openingWaveStarts,
                ],
              },
              {
                id: "opening-complete",
                trigger: { kind: "timelineCompleted", timelineId: "opening" },
                actions: openingWaveStops,
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
                trigger: { kind: "logicalInput", action: "presenter.next" },
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
        owner: { kind: "group", groupId: "demo" },
        durationMilliseconds: 6000,
        tracks: [
          {
            target: { kind: "instance", instanceId: "brand", property: "opacity" },
            keyframes: [
              { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 4500, value: 1, easingToNext: "cubicInOut" },
              { timeMilliseconds: 6000, value: 0 },
            ],
          },
          {
            target: { kind: "instance", instanceId: "logo", property: "opacity" },
            keyframes: [
              { timeMilliseconds: 0, value: 0, easingToNext: "cubicInOut" },
              { timeMilliseconds: 3000, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 4500, value: 1, easingToNext: "cubicInOut" },
              { timeMilliseconds: 6000, value: 0 },
            ],
          },
          {
            target: {
              kind: "instance",
              instanceId: "opening-wave-bottom-left",
              property: "opacity",
            },
            keyframes: [
              { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 4500, value: 1, easingToNext: "cubicInOut" },
              { timeMilliseconds: 6000, value: 0 },
            ],
          },
          {
            target: {
              kind: "instance",
              instanceId: "opening-wave-top-right",
              property: "opacity",
            },
            keyframes: [
              { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
              { timeMilliseconds: 4500, value: 1, easingToNext: "cubicInOut" },
              { timeMilliseconds: 6000, value: 0 },
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
