import { definePresentation } from "@unframe/unframe-authoring";

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
  theme: {
    themeId: "reference-theme",
  },
  scene: {
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
    components: [
      {
        id: "reference-surface",
        kind: "component-instance",
        componentId: "reference-surface",
        version: 1,
        owner: {
          kind: "presentation",
        },
        spatialNodeId: "surface-node",
        packageLock: {
          packageVersion: "1.0.0",
          packageIntegrity:
            "sha256:a8a6ff70bfa6802e795144632428662d872524c21f0f04285a6a8ada41b86c50",
          manifestHash: "sha256:9beade0acd726c3b65ef1be48e023f7a5de4e233e035d960be176c38cfb846d4",
          structureHash: "sha256:30bad08e64082d8044428fc8157437401db3aa9763fc56dd33646ea40de97e92",
        },
        props: {
          title: "Unframe / M3A",
          offset: 64,
          showCard: true,
        },
        slots: {
          badge: ["reference-badge"],
        },
        variants: {
          tone: "accent",
        },
        partOverrides: [
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
        ],
      },
      {
        id: "reference-badge",
        kind: "component-instance",
        componentId: "reference-badge",
        version: 1,
        owner: {
          kind: "presentation",
        },
        packageLock: {
          packageVersion: "1.0.0",
          packageIntegrity:
            "sha256:a8a6ff70bfa6802e795144632428662d872524c21f0f04285a6a8ada41b86c50",
          manifestHash: "sha256:b2c6d8daa2c8019317c322c670ac454ae2b98033e49deee926aab158e9675d7d",
          structureHash: "sha256:016c24e97b0b91c95b005df605cb83efd929d922a511391f5f27b19a15210c8c",
        },
        props: {
          label: "One nested Component, one placement",
        },
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
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
});
