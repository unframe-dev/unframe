import { definePresentation } from "@unframe/unframe-authoring";

export default definePresentation({
  id: "media-presentation",
  metadata: {
    title: "Model and Video playback",
  },
  stage: {
    coordinateSystem: {
      unit: "meter",
      handedness: "right",
      upAxis: "+Y",
      forwardAxis: "-Z",
    },
    size: [4, 3, 4],
  },
  assets: [
    {
      kind: "asset-ref",
      assetId: "mesh-source",
    },
    {
      kind: "asset-ref",
      assetId: "movie-source",
    },
    {
      kind: "asset-ref",
      assetId: "reference-font",
    },
  ],
  flow: {
    initialGroupId: "main",
    groups: {
      main: {
        id: "main",
        initialStepId: "playback",
        steps: {
          playback: {
            id: "playback",
            cues: [
              {
                id: "initialize",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "start",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "play",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "play",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
              },
              {
                id: "modelPlay",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "modelPlay",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "play",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "play",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "modelPause",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "modelPause",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "pause",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "pause",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "modelResume",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "modelResume",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "resume",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "resume",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "modelStop",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "modelStop",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "stop",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "stop",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "modelFade",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "modelFade",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "model-left",
                    actionId: "crossfade",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "model-right",
                    actionId: "crossfade",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "videoPlay",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "videoPlay",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "video",
                    actionId: "play",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "videoPause",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "videoPause",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "video",
                    actionId: "pause",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "videoSeek",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "videoSeek",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "video",
                    actionId: "seek",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "loopOn",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "loopOn",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "video",
                    actionId: "loopOn",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "loopOff",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "loopOff",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "video",
                    actionId: "loopOff",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "pulse",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "controls",
                  outputId: "pulse",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "controls",
                    actionId: "pulse",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "clipFinished",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "model-left",
                  outputId: "done",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "controls",
                    actionId: "clipFinished",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
              {
                id: "videoFinished",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "video",
                  outputId: "done",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "controls",
                    actionId: "videoFinished",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "stay",
                },
                firePolicy: {
                  kind: "repeatable",
                },
              },
            ],
          },
        },
      },
    },
    variables: {
      clipFinished: {
        id: "clipFinished",
        owner: {
          kind: "presentation",
        },
        type: "boolean",
        initialValue: false,
      },
      videoFinished: {
        id: "videoFinished",
        owner: {
          kind: "presentation",
        },
        type: "boolean",
        initialValue: false,
      },
    },
  },
  operations: [],
  theme: {
    themeId: "media-theme",
  },
  scene: {
    spatial: [
      {
        kind: "spatial",
        id: "model-left-host",
        name: "model-left",
        owner: {
          kind: "presentation",
        },
        audience: {
          kind: "all",
        },
        parent: {
          kind: "stage",
        },
        order: 0,
        transform: {
          position: [-1, 0.25, -2],
          rotation: [0, 0, 0, 1],
          scale: [0.45, 0.45, 0.45],
        },
        active: true,
        visible: true,
        opacity: 1,
      },
      {
        kind: "spatial",
        id: "model-right-host",
        name: "model-right",
        owner: {
          kind: "presentation",
        },
        audience: {
          kind: "all",
        },
        parent: {
          kind: "stage",
        },
        order: 1,
        transform: {
          position: [0.25, 0.25, -2],
          rotation: [0, 0, 0, 1],
          scale: [0.3, 0.3, 0.3],
        },
        active: true,
        visible: true,
        opacity: 0.65,
      },
      {
        kind: "spatial",
        id: "video-host",
        name: "video",
        owner: {
          kind: "presentation",
        },
        audience: {
          kind: "all",
        },
        parent: {
          kind: "stage",
        },
        order: 2,
        transform: {
          position: [0, 1.4, -2],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        active: true,
        visible: true,
        opacity: 1,
      },
      {
        kind: "spatial",
        id: "controls-host",
        name: "controls",
        owner: {
          kind: "presentation",
        },
        audience: {
          kind: "all",
        },
        parent: {
          kind: "stage",
        },
        order: 3,
        transform: {
          position: [0, -0.6, -2],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        active: true,
        visible: true,
        opacity: 1,
      },
    ],
    components: [
      {
        kind: "component-instance",
        id: "model-left",
        componentId: "mesh",
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "model-left-host",
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
      {
        kind: "component-instance",
        id: "model-right",
        componentId: "mesh",
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "model-right-host",
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
      {
        kind: "component-instance",
        id: "video",
        componentId: "movie",
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "video-host",
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
      {
        kind: "component-instance",
        id: "controls",
        componentId: "controls",
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "controls-host",
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
  },
});
