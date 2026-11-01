import { definePresentation } from "@unframe/authoring";
export default definePresentation({
  id: "presentation-fb840ab9-f7f7-4c06-a7e8-786db75c9356",
  metadata: { title: "Packed project" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3, 4],
  },
  theme: { themeId: "default-theme" },
  assets: [
    { kind: "asset-ref", assetId: "white" },
    { kind: "asset-ref", assetId: "reference-font" },
  ],
  scene: {
    spatial: [
      {
        kind: "spatial",
        id: "surface-host",
        name: "Surface",
        owner: { kind: "presentation" },
        audience: { kind: "all" },
        parent: { kind: "stage" },
        order: 0,
        transform: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        active: true,
        visible: true,
        opacity: 1,
      },
    ],
    components: [
      {
        kind: "component-instance",
        id: "surface-instance",
        componentId: "surface-component",
        version: 1,
        owner: { kind: "presentation" },
        spatialNodeId: "surface-host",
        props: {},
        slots: { badge: ["badge-instance"] },
        variants: { tone: "quiet" },
        partOverrides: [],
      },
      {
        kind: "component-instance",
        id: "badge-instance",
        componentId: "badge-component",
        version: 1,
        owner: { kind: "presentation" },
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
  },
  flow: {
    initialGroupId: "main",
    groups: {
      main: {
        id: "main",
        initialStepId: "start",
        steps: {
          start: {
            id: "start",
            cues: [
              {
                id: "open",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "surface-instance",
                  outputId: "opened",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "surface-instance",
                    actionId: "play",
                    arguments: {},
                  },
                ],
              },
            ],
          },
          done: {
            id: "done",
            cues: [
              {
                id: "finished",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "surface-instance",
                  outputId: "finished",
                },
                actions: [],
              },
            ],
          },
        },
      },
    },
    variables: {},
  },
  operations: [],
});
