import { definePresentation } from "@unframe/presentation";

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
            "sha256:c548b342a5dda6934c12afa6d5fb6e8ba01ba808375a7cda5a02867441213bf7",
          manifestHash: "sha256:e88ff72e1a1a4b10d580d7b6a16ab6ac6e1c001041797db151ce5ca31f086f62",
          structureHash: "sha256:27ea8d8ee71ccd11ef9a2199b462f746e1a236f42689c774bb41cc4977432b1c",
        },
        props: {},
        slots: {},
        variants: {},
        partOverrides: [],
      },
    ],
  },
  assets: [],
  flow: {
    initialGroupId: "main",
    groups: {
      main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } },
    },
    variables: {},
  },
  operations: [],
});
