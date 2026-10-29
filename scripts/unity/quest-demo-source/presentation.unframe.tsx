import { ComponentInstance, definePresentation } from "@unframe/unframe-authoring";
import theme from "./demo-theme.unframe";
import manifest from "./demo-surface.manifest";

export default definePresentation({
  id: "quest-demo-template",
  metadata: { title: "Quest Demo Presentation" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [2, 2, 2],
  },
  assets: [{ kind: "asset-ref", assetId: "reference-font" }],
  theme: { themeId: theme.id },
  scene: {
    spatial: [
      {
        id: "demo-node",
        kind: "spatial",
        name: "Demo slide",
        owner: { kind: "presentation" },
        audience: { kind: "all" },
        parent: { kind: "stage" },
        order: 0,
        transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        active: true,
        visible: true,
        opacity: 1,
      },
    ],
    components: [
      <ComponentInstance
        id="demo"
        componentId={manifest.componentId}
        version={manifest.version}
        spatialNodeId="demo-node"
        owner={{ kind: "presentation" }}
        props={{}}
        slots={{}}
        variants={{}}
        partOverrides={[]}
      />,
    ],
  },
  flow: {
    initialGroupId: "main",
    groups: {
      main: {
        id: "main",
        initialStepId: "first",
        steps: {
          first: {
            id: "first",
            cues: [
              {
                id: "next",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "demo",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "demo",
                    actionId: "showSecond",
                    arguments: {},
                  },
                ],
                next: { kind: "step", stepId: "second" },
              },
            ],
          },
          second: {
            id: "second",
            cues: [
              {
                id: "back",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "demo",
                  outputId: "next",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "demo",
                    actionId: "showFirst",
                    arguments: {},
                  },
                ],
                next: { kind: "step", stepId: "first" },
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
