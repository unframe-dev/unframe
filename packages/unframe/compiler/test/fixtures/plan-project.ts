import {
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
  type CompilerDeclarationProject,
} from "../../src/index.js";
import { standardComponents } from "@unframe/authoring/components";
import type { ComponentManifest, ComponentStructure, SurfaceDeclaration } from "@unframe/authoring";

export const createDeliveryFixtureProject = (): CompilerDeclarationProject => {
  const base = standardComponents.surface.structure;
  const original = base.root;
  if (original.kind !== "surface" || original.root.kind !== "frame")
    throw new Error("The delivery fixture requires a structured Surface.");
  const manifest: ComponentManifest = {
    ...standardComponents.surface.manifest,
    outputs: {
      opened: {
        kind: "output",
        payload: {},
        producer: { kind: "surfaceInteraction", interactionId: "open" },
      },
    },
  };
  const surface: SurfaceDeclaration = {
    ...original,
    logicalSize: [64, 32],
    physicalSizeMeters: [0.64, 0.32],
    root: {
      ...original.root,
      semanticNodeId: "button",
      layout: { kind: "absolute", x: 0, y: 0, width: 64, height: 32 },
      style: { backgroundColor: { red: 0, green: 0, blue: 0, alpha: 1 } },
      children: [
        {
          ...original.root,
          id: "translucent-panel",
          layout: { kind: "absolute", x: 8, y: 8, width: 32, height: 16 },
          opacity: 0.5,
          style: { backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 } },
          children: [],
        },
      ],
    },
    baseSemanticTree: {
      rootNodeIds: ["button"],
      nodes: {
        button: {
          id: "button",
          parentId: null,
          order: 0,
          role: "button",
          text: "Open",
          interactionId: "open",
        },
      },
    },
    interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 1 } },
    states: {
      default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
    },
    renderIntent: { ...original.renderIntent, interaction: "regions" },
  };
  const structure: ComponentStructure = { ...base, root: surface };
  const theme = structuredClone(standardComponents.theme);
  return {
    presentation: {
      id: "compiler-wire-fixture",
      metadata: { title: "Delivery contract fixture" },
      stage: {
        coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
        size: [4, 3, 4],
      },
      theme: { themeId: theme.id },
      scene: {
        spatial: [
          {
            id: "host",
            kind: "spatial",
            name: "Contract Surface",
            owner: { kind: "presentation" },
            audience: { kind: "all" },
            parent: { kind: "stage" },
            order: 0,
            transform: { position: [0, 0, -1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            active: true,
            visible: true,
            opacity: 1,
          },
        ],
        components: [
          {
            id: "fixture",
            kind: "component-instance",
            componentId: manifest.componentId,
            version: manifest.version,
            owner: { kind: "presentation" },
            spatialNodeId: "host",
            props: {},
            slots: {},
            variants: {},
            partOverrides: [],
          },
        ],
      },
      assets: [],
      flow: {
        initialGroupId: "group",
        groups: {
          group: {
            id: "group",
            initialStepId: "step",
            steps: {
              step: {
                id: "step",
                cues: [
                  {
                    id: "open",
                    trigger: {
                      kind: "component.output",
                      componentInstanceId: "fixture",
                      outputId: "opened",
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
    },
    themes: [{ declaration: theme, hash: hashThemeDeclaration(theme) }],
    components: [
      {
        manifest,
        structure,
        lock: {
          mode: "structured",
          origin: {
            kind: "local",
            entryFile: "delivery-project.ts",
            files: [],
            sourceHash: "sha256:delivery-contract-fixture",
          },
          manifestHash: hashComponentManifestDeclaration(manifest),
          structureHash: hashComponentStructureDeclaration(structure),
        },
      },
    ],
    assets: {},
  };
};
