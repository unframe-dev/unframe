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
          color: {
            category: "color",
            kind: "token-ref",
            tokenId: "ink",
          },
          fontSize: 72,
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
          done: {
            cues: [
              {
                actions: [],
                id: "finish",
                next: { kind: "step", stepId: "finished" },
                trigger: {
                  componentInstanceId: "reference-surface",
                  kind: "component.output",
                  outputId: "faded",
                },
              },
            ],
            id: "done",
          },
          finished: { cues: [], id: "finished" },
          start: {
            cues: [
              {
                actions: [
                  {
                    actionId: "fade",
                    arguments: {},
                    componentInstanceId: "reference-surface",
                    kind: "component.action",
                  },
                  {
                    actionId: "deactivate",
                    arguments: {},
                    componentInstanceId: "reference-surface",
                    kind: "component.action",
                  },
                ],
                guard: {
                  kind: "compare",
                  left: { field: "accepted", kind: "eventPayload" },
                  operator: "eq",
                  right: true,
                },
                id: "continue",
                next: { kind: "step", stepId: "done" },
                trigger: {
                  componentInstanceId: "reference-surface",
                  kind: "component.output",
                  outputId: "continued",
                },
              },
            ],
            id: "start",
          },
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
