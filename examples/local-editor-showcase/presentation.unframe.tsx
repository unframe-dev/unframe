import { definePresentation } from "@unframe/unframe-authoring";
import manifest from "./showcase.manifest";
import theme from "./showcase-theme.unframe";
export default definePresentation({
  id: "showcase-presentation",
  metadata: {
    title: "Unframe: Present beyond the screen",
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
      assetId: "reference-font",
    },
  ],
  flow: {
    initialGroupId: "story",
    groups: {
      story: {
        id: "story",
        initialStepId: "cover",
        steps: {
          cover: {
            id: "cover",
            cues: [
              {
                id: "next-cover",
                trigger: {
                  kind: "event",
                  event: "presenter.next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "problem",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "problem",
                },
              },
              {
                id: "click-cover",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "showcase",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "problem",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "problem",
                },
              },
            ],
          },
          problem: {
            id: "problem",
            cues: [
              {
                id: "next-problem",
                trigger: {
                  kind: "event",
                  event: "presenter.next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "system",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "system",
                },
              },
              {
                id: "click-problem",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "showcase",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "system",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "system",
                },
              },
            ],
          },
          system: {
            id: "system",
            cues: [
              {
                id: "next-system",
                trigger: {
                  kind: "event",
                  event: "presenter.next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "workflow",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "workflow",
                },
              },
              {
                id: "click-system",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "showcase",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "workflow",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "workflow",
                },
              },
            ],
          },
          workflow: {
            id: "workflow",
            cues: [
              {
                id: "next-workflow",
                trigger: {
                  kind: "event",
                  event: "presenter.next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "closing",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "closing",
                },
              },
              {
                id: "click-workflow",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "showcase",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "closing",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "closing",
                },
              },
            ],
          },
          closing: {
            id: "closing",
            cues: [
              {
                id: "next-closing",
                trigger: {
                  kind: "event",
                  event: "presenter.next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "cover",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "cover",
                },
              },
              {
                id: "click-closing",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "showcase",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "showcase",
                    actionId: "cover",
                    arguments: {},
                  },
                ],
                next: {
                  kind: "step",
                  stepId: "cover",
                },
              },
            ],
          },
        },
      },
    },
    variables: {},
  },
  operations: [],
  theme: {
    themeId: theme.id,
  },
  scene: {
    spatial: [
      {
        id: "showcase-node",
        kind: "spatial",
        name: "Story stage",
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
          position: [0, 0, 0],
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
        id: "showcase",
        kind: "component-instance",
        componentId: manifest.componentId,
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "showcase-node",
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
  },
});
