import { definePresentation } from "@unframe/unframe-authoring";

export default definePresentation({
  id: "reference-presentation",
  metadata: { title: "Unframe Reference" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [1, 1, 1],
  },
  theme: { themeId: "reference-theme" },
  scene: {
    spatial: [
      {
        id: "surface-node",
        kind: "spatial",
        name: "Reference surface",
        owner: { kind: "presentation" },
        audience: { kind: "all" },
        parent: { kind: "stage" },
        order: 0,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
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
        owner: { kind: "presentation" },
        spatialNodeId: "surface-node",
        packageLock: {
          packageVersion: "1.0.0",
          packageIntegrity:
            "sha256:a8a6ff70bfa6802e795144632428662d872524c21f0f04285a6a8ada41b86c50",
          manifestHash: "sha256:e88ff72e1a1a4b10d580d7b6a16ab6ac6e1c001041797db151ce5ca31f086f62",
          structureHash: "sha256:26d2afa9ca62162d8b995a86fcb088ba0169e28db60c4d325b7fedc210ca476c",
        },
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
  },
  assets: [{ kind: "asset-ref", assetId: "reference-font" }],
  flow: {
    initialGroupId: "main",
    groups: {
      main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } },
    },
    variables: {},
  },
  operations: [],
});
