import { definePresentation, ComponentInstance } from "@unframe/unframe-authoring";
import theme from "./reference-theme.unframe";
import surfaceManifest from "./reference-surface.manifest";
import badgeManifest from "./reference-badge.manifest";
import { presentationOwner } from "./reference-values";
import { surfaceLock, badgeLock } from "./reference-locks";

const components = [
  <ComponentInstance
    id="reference-surface"
    componentId={surfaceManifest.componentId}
    version={surfaceManifest.version}
    owner={presentationOwner}
    spatialNodeId="surface-node"
    packageLock={surfaceLock}
    props={{
      title: "Unframe / M3A",
      offset: 64,
      showCard: true,
    }}
    slots={{
      badge: ["reference-badge"],
    }}
    variants={{
      tone: "accent",
    }}
    partOverrides={[
      {
        partId: "headline",
        targetKind: "text",
        content: "Structured authoring",
        style: {
          fontSize: 72,
          color: {
            kind: "token-ref",
            category: "color",
            tokenId: "ink",
          },
        },
      },
    ]}
  />,
  <ComponentInstance
    id="reference-badge"
    componentId={badgeManifest.componentId}
    version={badgeManifest.version}
    owner={presentationOwner}
    packageLock={badgeLock}
    props={{
      label: "One nested Component, one placement",
    }}
    slots={{}}
    variants={{}}
    partOverrides={[]}
  />,
];
const scene = {
  spatial: [
    {
      id: "surface-node",
      kind: "spatial",
      name: "Reference surface",
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
  components,
} as const;

export default definePresentation({
  id: "reference-presentation",
  metadata: {
    title: "Unframe Reference",
  },
  stage: {
    coordinateSystem: {
      unit: "meter",
      handedness: "right",
      upAxis: "+Y",
      forwardAxis: "-Z",
    },
    size: [1, 1, 1],
  },
  assets: [
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
        initialStepId: "start",
        steps: {
          start: {
            id: "start",
            cues: [],
          },
        },
      },
    },
    variables: {},
  },
  operations: [],
  theme: { themeId: theme.id },
  scene,
});
