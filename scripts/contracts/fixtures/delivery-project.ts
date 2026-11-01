import {
  compileDeclarationProject,
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
  type CompilerDeclarationProject,
} from "@unframe/core/compiler";
import { standardComponents } from "@unframe/core/components";
import type {
  ComponentManifest,
  ComponentStructure,
  SurfaceDeclaration,
} from "@unframe/core/authoring";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/core/assets";
import {
  SUPPORTED_RENDERER_CONTRACT_VERSION,
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/core/renderer-api";

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

// Wire conformance exercises Compiler plans and serialization; pixels deliberately do not model a browser.
const renderer: RendererPlugin = {
  identity: {
    id: "baked-web",
    version: "delivery-contract-fixture-1",
    contractVersion: SUPPORTED_RENDERER_CONTRACT_VERSION,
    implementationHash: "sha256:delivery-contract-renderer-1",
  },
  capabilities: {
    inputKinds: ["structured"],
    updateModels: ["static", "finite-state"],
    interactions: ["none", "regions"],
    internalAnimations: ["none"],
    rendererPreferences: ["baked-web"],
    fallbackPolicies: ["reject"],
    deterministic: true,
  },
  support: evaluateFirstMilestoneSupport,
  build(input) {
    return {
      ok: true,
      renderSurface: {
        id: input.plan.id,
        semanticSurfaceId: input.plan.semanticSurfaceId,
        logicalBounds: input.plan.logicalBounds,
        layer: input.plan.layer,
      },
      captures: Object.entries(input.plan.states)
        .filter(([, state]) => state.kind === "capture")
        .map(([stateId]) => ({
          id: `${stateId}:capture`,
          stateId,
          rgba: Uint8Array.from(
            { length: input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 },
            (_, index) => (index % 4 === 3 ? 255 : 0),
          ),
          pixelSize: input.context.pixelTarget,
          colorSpace: "srgb",
          alphaMode: "opaque",
        })),
      provenance: {
        ...renderer.identity,
        inputHash: input.context.inputHash,
        buildContextHash: input.context.buildContextHash,
        environmentHash: input.context.environmentHash,
        rendererConfigHash: input.context.rendererConfigHash,
        rendererFingerprint: createRendererFingerprint(
          renderer.identity,
          input.context.rendererConfigHash,
        ),
      },
      diagnostics: [],
    };
  },
};

export const buildDeliveryFixtureArtifacts = async () => {
  const result = await compileDeclarationProject(
    createDeliveryFixtureProject(),
    {
      compiler: {
        name: "unframe-delivery-contract-fixture",
        version: "1",
        baseEnvironmentHash: "sha256:delivery-contract-environment-1",
      },
      locale: "en",
      timezone: "UTC",
      colorScheme: "light",
      rendererConfigHash: "sha256:delivery-contract-config-1",
      renderers: [renderer],
      encodeLimits: PNG_ABSOLUTE_LIMITS,
    },
    {},
  );
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
};
