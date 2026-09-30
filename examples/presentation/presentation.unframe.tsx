import { definePresentation, ComponentInstance } from "@unframe/unframe-authoring";
import theme from "./reference-theme.unframe";
import surfaceManifest from "./reference-surface.manifest";
import badgeManifest from "./reference-badge.manifest";
import { presentationOwner } from "./reference-values";

const components = [
  <ComponentInstance
    componentId={surfaceManifest.componentId}
    id="reference-surface"
    owner={presentationOwner}
    partOverrides={[
      {
        content: "Structured authoring",
        partId: "headline",
        style: {
          fontSize: 72,
          color: {
            kind: "token-ref",
            category: "color",
            tokenId: "ink",
          },
        },
        targetKind: "text",
      },
    ]}
    props={{
      offset: 64,
      showCard: true,
      title: "Unframe / M3A",
    }}
    slots={{
      badge: ["reference-badge"],
    }}
    spatialNodeId="surface-node"
    variants={{
      tone: "accent",
    }}
    version={surfaceManifest.version}
  />,
  <ComponentInstance
    componentId={badgeManifest.componentId}
    id="reference-badge"
    owner={presentationOwner}
    partOverrides={[]}
    props={{
      label: "One nested Component, one placement",
    }}
    slots={{}}
    variants={{}}
    version={badgeManifest.version}
  />,
];
const scene = {
  components,
  spatial: [
    {
      active: true,
      audience: {
        kind: "all",
      },
      id: "surface-node",
      kind: "spatial",
      name: "Reference surface",
      opacity: 1,
      order: 0,
      owner: {
        kind: "presentation",
      },
      parent: {
        kind: "stage",
      },
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      visible: true,
    },
  ],
} as const;

export default definePresentation({
  assets: [
    {
      assetId: "reference-font",
      kind: "asset-ref",
    },
  ],
  flow: {
    groups: {
      main: {
        id: "main",
        initialStepId: "start",
        steps: {
          start: {
            id: "start",
            cues: [
              {
                id: "continue",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "reference-surface",
                  outputId: "continued",
                },
                guard: {
                  kind: "compare",
                  left: { kind: "eventPayload", field: "accepted" },
                  operator: "eq",
                  right: true,
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "reference-surface",
                    actionId: "fade",
                    arguments: {},
                  },
                  {
                    kind: "component.action",
                    componentInstanceId: "reference-surface",
                    actionId: "deactivate",
                    arguments: {},
                  },
                ],
                next: { kind: "step", stepId: "done" },
              },
            ],
          },
          done: {
            id: "done",
            cues: [
              {
                id: "finish",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "reference-surface",
                  outputId: "faded",
                },
                actions: [],
                next: { kind: "step", stepId: "finished" },
              },
            ],
          },
          finished: { id: "finished", cues: [] },
        },
      },
    },
    initialGroupId: "main",
    variables: {
      continued: {
        id: "continued",
        initialValue: false,
        owner: { kind: "presentation" },
        type: "boolean",
      },
    },
  },
  id: "reference-presentation",
  metadata: {
    title: "Unframe Reference",
  },
  operations: [],
  scene,
  stage: {
    coordinateSystem: {
      forwardAxis: "-Z",
      handedness: "right",
      unit: "meter",
      upAxis: "+Y",
    },
    size: [1, 1, 1],
  },
  theme: { themeId: theme.id },
});
