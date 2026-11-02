import { definePresentation } from "@unframe/authoring";
export default definePresentation({
  id: "logical-input-fixture",
  metadata: { title: "Logical input" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3, 4],
  },
  theme: { themeId: "default-theme" },
  assets: [],
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
                trigger: { kind: "logicalInput", action: "presenter.next" },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "surface-instance",
                    actionId: "mark",
                    arguments: {},
                  },
                ],
                next: { kind: "step", stepId: "done" },
              },
            ],
          },
          done: { id: "done", cues: [] },
        },
      },
    },
    variables: {
      count: { id: "count", owner: { kind: "presentation" }, type: "number", initialValue: 0 },
    },
  },
  operations: [],
});
