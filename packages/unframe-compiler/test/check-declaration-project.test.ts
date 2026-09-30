import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/unframe-components";
import type {
  ComponentManifest,
  ComponentPackageLock,
  ComponentStructure,
  PresentationDeclaration,
  SurfaceDeclaration,
} from "@unframe/unframe-authoring";
import {
  buildOpaqueComponentManifest,
  validateStaticComponentMetadata,
} from "@unframe/unframe-authoring";
import {
  type SemanticSurface,
  canonicalizePresentationDefinition,
  validatePresentationDefinition,
} from "@unframe/unframe-core";
import { compileDeclarationProject, checkDeclarationProject } from "../src/index.js";
import type { CompilerDeclarationProject, CompilerSourceAsset } from "../src/index.js";
type StructuredProject = Omit<CompilerDeclarationProject, "presentation" | "components"> & {
  components: Array<{
    lock: ComponentPackageLock & { mode: "structured" };
    manifest: ComponentManifest;
    structure: ComponentStructure;
  }>;
  presentation: PresentationDeclaration;
};
import { safePlainClone } from "../src/validation/safe-plain-clone.js";
import {
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/unframe-renderer-api";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/unframe-assets";

const structuredContent = (surface: SemanticSurface | undefined) => {
  if (surface?.content.kind !== "structured") {
    throw new Error("Expected structured Surface");
  }
  return surface.content;
};

const presentation = (): PresentationDeclaration => ({
  assets: [{ assetId: "reference-font", kind: "asset-ref" }],
  flow: {
    groups: {
      group: { id: "group", initialStepId: "step", steps: { step: { cues: [], id: "step" } } },
    },
    initialGroupId: "group",
    variables: {},
  },
  id: "presentation",
  metadata: { title: "Reference" },
  operations: [],
  scene: {
    components: [
      {
        componentId: standardComponents.surface.manifest.componentId,
        id: "instance",
        kind: "component-instance",
        owner: { kind: "presentation" },
        partOverrides: [],
        props: {},
        slots: {},
        spatialNodeId: "spatial",
        variants: {},
        version: 1,
      },
    ],
    spatial: [
      {
        active: true,
        audience: { kind: "all" },
        id: "spatial",
        kind: "spatial",
        name: "Surface",
        opacity: 1,
        order: 0,
        owner: { kind: "presentation" },
        parent: { kind: "stage" },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        visible: true,
      },
    ],
  },
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [4, 3, 4],
  },
  theme: { themeId: standardComponents.theme.id },
});

const project = () => ({
  assets: {
    "reference-font": {
      checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
      dataBase64: "AAEAAAAAAAAAAAAA",
      encodedSizeBytes: 12,
      id: "reference-font",
      mediaType: "font/ttf" as const,
    },
  } as Record<string, CompilerSourceAsset>,
  components: [
    {
      lock: {
        manifestHash: "manifest",
        mode: "structured" as const,
        origin: {
          entryFile: "surface.ts",
          files: [],
          kind: "local" as const,
          sourceHash: "sha256:source",
        },
        structureHash: "structure",
      },
      manifest: standardComponents.surface.manifest,
      structure: standardComponents.surface.structure,
    },
  ],
  presentation: presentation(),
  themes: [
    {
      declaration: standardComponents.theme,
      hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  ],
});

const nullPrototype = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(nullPrototype);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.assign(
    Object.create(null),
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nullPrototype(child)])),
  );
};

const codes = (value: unknown) => {
  const result = checkDeclarationProject(value);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("checkDeclarationProject", () => {
  it("keeps Structured and React Surfaces in one Presentation", () => {
    const input = project();
    const metadata = validateStaticComponentMetadata({
      id: "react",
      props: {},
      semantics: {
        nodes: { title: { level: 1, order: 0, parentId: null, role: "heading", text: "Hello" } },
        rootNodeIds: ["title"],
      },
      surface: { logicalSize: [800, 450] },
      version: 1,
    });
    const reactItem = {
      audience: { kind: "all" },
      component: { id: "react", version: 1 },
      fit: "contain",
      id: "react-one",
      owner: { kind: "presentation" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.9],
      props: {},
      transform: { position: [1, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    };
    const result = checkDeclarationProject({
      ...input,
      components: [
        ...input.components,
        {
          lock: {
            manifestHash: "sha256:manifest",
            mode: "opaque",
            origin: {
              entryFile: "react.component.tsx",
              files: [],
              kind: "local",
              sourceHash: "sha256:source",
            },
            rendererInputHash: "sha256:renderer",
          },
          manifest: buildOpaqueComponentManifest(metadata, "react.component.tsx#render"),
          metadata,
          rendererEntry: "react.component.tsx#render",
          rendererSource: "export default () => null",
        },
      ],
      presentation: {
        ...input.presentation,
        scene: {
          ...input.presentation.scene,
          components: [...input.presentation.scene.components, reactItem],
        },
      },
    });
    if (!result.valid) {
      throw new Error(JSON.stringify(result.diagnostics));
    }
    expect(
      Object.values(result.value.definition.scene.surfaces)
        .map((surface) => surface.content.kind)
        .sort(),
    ).toEqual(["opaque", "structured"]);
  });
  it("preserves source Cue positions across Structured and React lowering", () => {
    const input = project() as StructuredProject;
    const structured = input.components[0]!;
    structured.manifest = {
      ...structured.manifest,
      outputs: {
        advanced: {
          kind: "output",
          payload: {},
          producer: { afterMilliseconds: 1, kind: "timer" },
        },
        skipped: { kind: "output", payload: {}, producer: { afterMilliseconds: 2, kind: "timer" } },
      },
    };
    const metadata = validateStaticComponentMetadata({
      actions: {},
      id: "react",
      initialState: "ready",
      interactions: { next: { event: "next", hitPriority: 0, kind: "click" } },
      outputs: {
        clicked: { payload: {}, producer: { interactionId: "next", kind: "surfaceInteraction" } },
      },
      props: {},
      semantics: {
        nodes: {
          button: {
            interactionId: "next",
            order: 0,
            parentId: null,
            role: "button",
            text: "Next",
          },
        },
        rootNodeIds: ["button"],
      },
      states: { ready: { enabledInteractionIds: ["next"], semanticOverrides: [] } },
      surface: { logicalSize: [800, 450] },
      version: 1,
    });
    const reactItem = {
      audience: { kind: "all" },
      component: { id: "react", version: 1 },
      fit: "contain",
      id: "react-one",
      owner: { kind: "presentation" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.9],
      props: {},
      transform: { position: [1, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    };
    const result = checkDeclarationProject({
      ...input,
      components: [
        ...input.components,
        {
          lock: {
            manifestHash: "sha256:manifest",
            mode: "opaque",
            origin: {
              entryFile: "react.component.tsx",
              files: [],
              kind: "local",
              sourceHash: "sha256:source",
            },
            rendererInputHash: "sha256:renderer",
          },
          manifest: buildOpaqueComponentManifest(metadata, "react.component.tsx#render"),
          metadata,
          rendererEntry: "react.component.tsx#render",
          rendererSource: "export default () => null",
        },
      ],
      presentation: {
        ...input.presentation,
        flow: {
          ...input.presentation.flow,
          groups: {
            group: {
              id: "group",
              initialStepId: "step",
              steps: {
                step: {
                  cues: [
                    {
                      actions: [],
                      id: "react-first",
                      trigger: {
                        componentInstanceId: "react-one",
                        kind: "component.output",
                        outputId: "clicked",
                      },
                    },
                    {
                      actions: [],
                      id: "structured-second",
                      trigger: {
                        componentInstanceId: "instance",
                        kind: "component.output",
                        outputId: "advanced",
                      },
                    },
                    {
                      actions: [],
                      id: "structured-explicit",
                      order: 7,
                      trigger: {
                        componentInstanceId: "instance",
                        kind: "component.output",
                        outputId: "skipped",
                      },
                    },
                  ],
                  id: "step",
                },
              },
            },
          },
        },
        scene: {
          ...input.presentation.scene,
          components: [...input.presentation.scene.components, reactItem],
        },
      },
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(
      Object.fromEntries(
        result.value.definition.flow.groups.group!.steps.step!.cues.map((cue) => [
          cue.id,
          cue.order,
        ]),
      ),
    ).toEqual({ "react-first": 0, "structured-explicit": 7, "structured-second": 1 });
  });
  it("identifies the lowered content as a structured tree", () => {
    const result = checkDeclarationProject(project());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(Object.values(result.value.definition.scene.surfaces)[0]).toHaveProperty(
      "content.kind",
      "structured",
    );
  });

  it("lowers a host Timeline and its local Action and Output references", () => {
    const input = project() as StructuredProject;
    const entry = input.components[0]!;
    entry.structure = {
      ...entry.structure,
      timelines: [
        {
          durationMilliseconds: 100,
          id: "fade",
          tracks: [
            {
              keyframes: [
                { easingToNext: "linear", timeMilliseconds: 0, value: 0 },
                { timeMilliseconds: 100, value: 1 },
              ],
              target: { kind: "host", property: "opacity" },
            },
          ],
        },
      ],
    };
    entry.manifest = {
      ...entry.manifest,
      actions: {
        ...entry.manifest.actions,
        play: {
          effects: [{ completion: "nonBlocking", kind: "playTimeline", timelineId: "fade" }],
          inputs: {},
          kind: "action",
          preconditions: [],
        },
      },
      outputs: {
        ...entry.manifest.outputs,
        finished: {
          kind: "output",
          payload: {},
          producer: { kind: "timelineCompleted", timelineId: "fade" },
        },
        started: { kind: "output", payload: {}, producer: { afterMilliseconds: 1, kind: "timer" } },
      },
    };
    (
      input.presentation.flow.groups.group!.steps.step!.cues as unknown as Array<
        import("@unframe/unframe-authoring").CueDeclaration
      >
    ).push({
      actions: [
        {
          actionId: "play",
          arguments: {},
          componentInstanceId: "instance",
          kind: "component.action",
        },
      ],
      id: "start",
      trigger: { componentInstanceId: "instance", kind: "component.output", outputId: "started" },
    });
    (
      input.presentation.flow.groups.group!.steps.step!.cues as unknown as Array<
        import("@unframe/unframe-authoring").CueDeclaration
      >
    ).push({
      actions: [],
      id: "finished",
      trigger: { componentInstanceId: "instance", kind: "component.output", outputId: "finished" },
    });
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(result.value.definition.flow.timelines["instance:fade"]).toEqual({
      durationMilliseconds: 100,
      id: "instance:fade",
      owner: { kind: "presentation" },
      tracks: [
        {
          keyframes: [
            { easingToNext: "linear", timeMilliseconds: 0, value: 0 },
            { timeMilliseconds: 100, value: 1 },
          ],
          target: { nodeId: "instance:spatial", property: "opacity" },
        },
      ],
    });
    expect(result.value.definition.flow.groups.group!.steps.step!.cues[0]!.actions).toEqual([
      {
        completion: "nonBlocking",
        conflict: "reject",
        kind: "timeline.play",
        timelineId: "instance:fade",
      },
    ]);
    expect(result.value.definition.flow.groups.group!.steps.step!.cues[1]!.trigger).toEqual({
      kind: "timelineCompleted",
      timelineId: "instance:fade",
    });
  });
  it("canonicalizes Timeline rotation and rejects a zero Quaternion", () => {
    const input = project() as StructuredProject;
    const entry = input.components[0]!;
    entry.structure = {
      ...entry.structure,
      timelines: [
        {
          durationMilliseconds: 100,
          id: "rotate",
          tracks: [
            {
              keyframes: [
                { easingToNext: "linear", timeMilliseconds: 0, value: [0, 0, 0, -2] },
                { timeMilliseconds: 100, value: [0, 0, 0, 2] },
              ],
              target: { kind: "host", property: "transform.rotation" },
            },
          ],
        },
      ],
    };
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(
      result.value.definition.flow.timelines["instance:rotate"]!.tracks[0]!.keyframes.map(
        (frame) => frame.value,
      ),
    ).toEqual([
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ]);
    const invalid = project() as StructuredProject;
    invalid.components[0]!.structure = {
      ...entry.structure,
      timelines: [
        {
          ...entry.structure.timelines[0]!,
          tracks: [
            {
              ...entry.structure.timelines[0]!.tracks[0]!,
              keyframes: [
                { easingToNext: "linear", timeMilliseconds: 0, value: [0, 0, 0, 0] },
                { timeMilliseconds: 100, value: [0, 0, 0, 1] },
              ],
            },
          ],
        },
      ],
    };
    expect(codes(invalid)).toContain("compiler-timeline-quaternion-invalid");
  });
  it("lowers Component Output payload, Action effects, Guard, and empty Step transition", () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("fixture must be a surface");
    }
    entry.manifest = {
      ...entry.manifest,
      actions: {
        activate: {
          effects: [
            {
              kind: "setSurfaceState",
              stateId: "active",
              surfaceId: "surface-root",
              transition: {
                completion: "blocking",
                durationMilliseconds: 200,
                easing: "linear",
                kind: "crossfade",
              },
            },
            {
              kind: "setVariable",
              value: { inputId: "value", kind: "input" },
              variableId: "count",
            },
            {
              kind: "patchNode",
              nodeId: "spatial",
              patch: { opacity: { field: "opacity", kind: "eventPayload" } },
            },
          ],
          inputs: { value: "number" },
          kind: "action",
          preconditions: [],
        },
      },
      outputs: {
        clicked: {
          kind: "output",
          payload: { opacity: { type: "number", value: 0.5 } },
          producer: { interactionId: "open", kind: "surfaceInteraction" },
        },
      },
      states: { active: { kind: "state" }, default: { initial: true, kind: "state" } },
    };
    entry.structure = {
      ...entry.structure,
      root: {
        ...root,
        baseSemanticTree: {
          nodes: {
            "semantic-text": {
              id: "semantic-text",
              interactionId: "open",
              order: 0,
              parentId: null,
              role: "button",
              text: "Open",
            },
          },
          rootNodeIds: ["semantic-text"],
        },
        interactions: { open: { event: "open", hitPriority: 0, id: "open", kind: "click" } },
        renderIntent: { ...root.renderIntent, interaction: "regions", updateModel: "finite-state" },
        states: {
          active: { enabledInteractionIds: ["open"], id: "active", semanticOverrides: [] },
          default: { enabledInteractionIds: ["open"], id: "default", semanticOverrides: [] },
        },
      },
    } as ComponentStructure;
    const cues: PresentationDeclaration["flow"]["groups"][string]["steps"][string]["cues"] = [
      {
        actions: [
          {
            actionId: "activate",
            arguments: { value: { kind: "literal", value: 2 } },
            componentInstanceId: "instance",
            kind: "component.action",
          },
        ],
        guard: {
          kind: "compare",
          left: { field: "opacity", kind: "eventPayload" },
          operator: "gt",
          right: 0,
        },
        id: "activate",
        next: { kind: "step", stepId: "done" },
        trigger: { componentInstanceId: "instance", kind: "component.output", outputId: "clicked" },
      },
    ];
    input.presentation = {
      ...input.presentation,
      flow: {
        ...input.presentation.flow,
        groups: {
          group: {
            id: "group",
            initialStepId: "step",
            steps: { done: { cues: [], id: "done" }, step: { cues, id: "step" } },
          },
        },
        variables: {
          count: { id: "count", initialValue: 0, owner: { kind: "presentation" }, type: "number" },
        },
      },
    };
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(result.value.definition.flow.groups.group?.steps.step?.cues).toEqual([
      expect.objectContaining({
        actions: [
          {
            kind: "surface.setState",
            stateId: "instance:active",
            surfaceId: "instance:surface-root",
            transition: {
              completion: "blocking",
              durationMilliseconds: 200,
              easing: "linear",
              kind: "crossfade",
            },
          },
          { kind: "variable.set", value: { kind: "literal", value: 2 }, variableId: "count" },
          {
            kind: "node.patch",
            nodeId: "instance:spatial",
            patch: { opacity: { field: "opacity", kind: "eventPayload" } },
          },
        ],
        fixedPayload: { opacity: 0.5 },
        guard: {
          kind: "compare",
          left: { field: "opacity", kind: "eventPayload" },
          operator: "gt",
          right: 0,
        },
        next: { kind: "step", stepId: "done" },
        trigger: {
          actor: { kind: "presenter" },
          interactionId: "instance:open",
          kind: "surfaceInteraction",
          surfaceId: "instance:surface-root",
        },
      }),
    ]);
    expect(result.value.definition.flow.groups.group?.steps.done?.cues).toEqual([]);
  });
  it("lowers a timer Output to an actionless Step transition", () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    entry.manifest = {
      ...entry.manifest,
      outputs: {
        elapsed: {
          kind: "output",
          payload: { phase: { type: "string", value: "ready" } },
          producer: { afterMilliseconds: 1000, kind: "timer" },
        },
      },
    };
    input.presentation = {
      ...input.presentation,
      flow: {
        ...input.presentation.flow,
        groups: {
          group: {
            id: "group",
            initialStepId: "step",
            steps: {
              done: { cues: [], id: "done" },
              step: {
                cues: [
                  {
                    actions: [],
                    guard: {
                      kind: "compare",
                      left: { kind: "surfaceState", surfaceId: "surface-root" },
                      operator: "eq",
                      right: "default",
                    },
                    id: "advance",
                    next: { kind: "step", stepId: "done" },
                    trigger: {
                      componentInstanceId: "instance",
                      kind: "component.output",
                      outputId: "elapsed",
                    },
                  },
                ],
                id: "step",
              },
            },
          },
        },
      },
    };
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(result.value.definition.flow.groups.group?.steps.step?.cues).toEqual([
      expect.objectContaining({
        actions: [],
        fixedPayload: { phase: "ready" },
        guard: {
          kind: "compare",
          left: { kind: "surfaceState", surfaceId: "instance:surface-root" },
          operator: "eq",
          right: "instance:default",
        },
        next: { kind: "step", stepId: "done" },
        trigger: { afterMilliseconds: 1000, kind: "timer" },
      }),
    ]);
  });
  it("rejects undeclared Timeline effects and media Output producers", () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    entry.manifest = {
      ...entry.manifest,
      actions: {
        animate: {
          effects: [{ completion: "blocking", kind: "playTimeline", timelineId: "animation" }],
          inputs: {},
          kind: "action",
          preconditions: [],
        },
      },
      outputs: {
        ended: {
          kind: "output",
          payload: {},
          producer: { kind: "mediaCompleted", surfaceId: "surface-root" },
        },
      },
    };
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "compiler-timeline-not-found",
        "compiler-output-producer-unsupported",
      ]),
    );
  });
  it("lowers finite states, visual changes, semantic changes and interactions", () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const original = input.components[0]!;
    const root = original.structure.root;
    if (root.kind !== "surface") {
      throw new Error("fixture must be a surface");
    }
    (input.themes as Array<StructuredProject["themes"][number]>)[0] = {
      ...input.themes[0]!,
      declaration: {
        ...input.themes[0]!.declaration,
        tokens: {
          accent: { category: "color", value: { alpha: 1, blue: 0.4, green: 0.3, red: 0.2 } },
        },
      },
    };
    input.components[0] = {
      ...original,
      manifest: {
        ...original.manifest,
        states: { active: { kind: "state" }, default: { initial: true, kind: "state" } },
      },
      structure: {
        ...original.structure,
        root: {
          ...root,
          baseSemanticTree: {
            nodes: {
              "semantic-text": {
                id: "semantic-text",
                interactionId: "open",
                order: 0,
                parentId: null,
                role: "button",
                text: "Open",
              },
            },
            rootNodeIds: ["semantic-text"],
          },
          interactions: { open: { event: "open", hitPriority: 7, id: "open", kind: "click" } },
          renderIntent: {
            ...root.renderIntent,
            interaction: "regions",
            updateModel: "finite-state",
          },
          states: {
            active: {
              contentOverrides: {
                "frame-root": {
                  backgroundColor: { category: "color", kind: "token-ref", tokenId: "accent" },
                  border: { color: { alpha: 1, blue: 0, green: 0, red: 1 }, radius: 3, width: 2 },
                  clip: true,
                  kind: "frame",
                  layout: { kind: "absolute" },
                  opacity: 0.8,
                  placement: { height: 900, kind: "absolute", width: 1600, x: 1, y: 2 },
                  visible: true,
                },
                "text-content": {
                  kind: "text",
                  opacity: 0.7,
                  placement: { height: 100, kind: "absolute", width: 1000, x: 10, y: 20 },
                  style: {
                    align: "center",
                    color: { category: "color", kind: "token-ref", tokenId: "accent" },
                    fontSize: 44,
                    lineHeight: 50,
                    overflow: "ellipsis",
                    weight: "bold",
                  },
                  value: "Active",
                  visible: true,
                },
              },
              enabledInteractionIds: ["open"],
              id: "active",
              semanticOverrides: [
                {
                  id: "override",
                  kind: "semantic-override",
                  targetId: "semantic-text",
                  text: "Active",
                },
              ],
            },
            default: { enabledInteractionIds: [], id: "default", semanticOverrides: [] },
          },
        } as SurfaceDeclaration,
      } as ComponentStructure,
    };
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    const surface = result.value.definition.scene.surfaces["instance:surface-root"]!;
    expect(surface.interactions["instance:open"]).toMatchObject({ event: "open", hitPriority: 7 });
    expect(surface.states["instance:active"]).toMatchObject({
      contentOverrides: {
        "instance:frame-root": {
          backgroundColor: { red: 0.2 },
          border: { radius: 3, width: 2 },
          clip: true,
          kind: "frame",
          layout: { kind: "absolute" },
          placement: { height: 900, kind: "absolute", width: 1600, x: 1, y: 2 },
        },
        "instance:text-content": {
          kind: "text",
          style: {
            align: "center",
            color: { red: 0.2 },
            fontAssetId: "reference-font",
            fontSize: 44,
            lineHeight: 50,
            overflow: "ellipsis",
            weight: "bold",
          },
          value: { kind: "literal", value: "Active" },
        },
      },
      enabledInteractionIds: ["instance:open"],
    });
  });
  it("rejects state visual overrides with missing or mismatched targets", () => {
    for (const [targetId, kind] of [
      ["missing", "text"],
      ["text-content", "frame"],
    ] as const) {
      const input = project();
      const entry = input.components[0]!;
      entry.structure = {
        ...entry.structure,
        root: {
          ...entry.structure.root,
          states: {
            default: {
              contentOverrides: { [targetId]: { kind } },
              enabledInteractionIds: [],
              id: "default",
              semanticOverrides: [],
            },
          },
        },
      } as never;
      expect(codes(input)).toContain("compiler-content-override-target-invalid");
    }
  });
  it("lowers only v2 artifacts with explicit literal fonts and external assets", () => {
    const input = project();
    input.presentation.assets = [{ assetId: "reference-font", kind: "asset-ref" }];
    input.assets = {
      "reference-font": {
        checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
        dataBase64: "AAEAAAAAAAAAAAAA",
        encodedSizeBytes: 12,
        id: "reference-font",
        mediaType: "font/ttf",
      },
    };
    const result = checkDeclarationProject(input);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.definition.schemaVersion).toBe(2);
    expect(result.value.definition).not.toHaveProperty("assets");
    expect(result.value.assetSet.assets["reference-font"]?.mediaType).toBe("font/ttf");
  });

  it("reports defaults only for omitted props and variants", () => {
    const input = project();
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      props: {
        count: { default: 0, kind: "number" },
        enabled: { default: false, kind: "boolean" },
        title: { default: "Default", kind: "string" },
      },
      variants: {
        density: { kind: "variant", values: ["compact", "roomy"] },
        explicitTone: { default: "quiet", kind: "variant", values: ["quiet", "loud"] },
        optional: { kind: "variant", values: ["on", "off"] },
        tone: { default: "quiet", kind: "variant", values: ["quiet", "loud"] },
      },
    };
    component.structure = {
      ...component.structure,
      variantStyles: {
        density: { compact: [], roomy: [] },
        explicitTone: { loud: [], quiet: [] },
        optional: { off: [], on: [] },
        tone: { loud: [], quiet: [] },
      },
    } as never;
    input.presentation.scene.components[0]!.props = { count: 0, enabled: false };
    input.presentation.scene.components[0]!.variants = {
      density: "compact",
      explicitTone: "quiet",
    };

    const result = checkDeclarationProject(input);

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.warnings).toEqual([
      expect.objectContaining({
        code: "compiler-prop-default-applied",
        componentInstanceId: "instance",
        defaultValue: "Default",
        propName: "title",
      }),
      expect.objectContaining({
        code: "compiler-variant-default-applied",
        componentInstanceId: "instance",
        defaultValue: "quiet",
        variantName: "tone",
      }),
    ]);
  });

  it.each([
    ["noncanonical base64", { dataBase64: "AAEAAAAAAAAAAAA" }],
    ["encoded length mismatch", { encodedSizeBytes: 11 }],
    [
      "checksum mismatch",
      { checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
    ],
    [
      "font signature mismatch",
      {
        checksum: "sha256:a1f098f0b83e4000e5265942ea3a38af0c92d06425a754ba6f28c301a66388c0",
        dataBase64: "T1RUAAAAAAAAAAAA",
      },
    ],
  ])("rejects %s in a self-contained source font", (_, change) => {
    const input = project();
    input.assets["reference-font"] = { ...input.assets["reference-font"]!, ...change };
    expect(codes(input)).toContain("compiler-invalid-asset");
  });
  it("rejects an empty title at the shared declaration boundary", () => {
    const input = project();
    input.presentation.metadata.title = "";
    expect(codes(input)).toEqual(["compiler-invalid-declaration"]);
  });

  it("rejects malformed Prop declarations before checking supported features", () => {
    const input = project();
    const component = input.components[0]!;
    expect(
      codes({
        ...input,
        components: [
          {
            ...component,
            manifest: {
              ...component.manifest,
              props: { title: { default: 42, kind: "string" } },
            },
          },
        ],
      }),
    ).toContain("compiler-invalid-declaration");
  });

  it("resolves a required string Prop into Text content", () => {
    const input = project();
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      props: {
        limit: { kind: "number", required: true },
        opacity: { kind: "number", required: true },
        title: { kind: "string", required: true },
        visible: { kind: "boolean", required: true },
        x: { kind: "number", required: true },
      },
    };
    component.structure = {
      ...component.structure,
      root: {
        ...component.structure.root,
        baseSemanticTree: {
          ...component.structure.root.baseSemanticTree,
          nodes: {
            "semantic-text": {
              ...component.structure.root.baseSemanticTree.nodes["semantic-text"]!,
              text: { expectedType: "string", kind: "prop-ref", propId: "title" },
            },
          },
        },
        root: {
          ...component.structure.root.root,
          children: component.structure.root.root.children.map((child) =>
            child.kind === "text"
              ? {
                  ...child,
                  layout: {
                    ...child.layout,
                    x: { expectedType: "number", kind: "prop-ref", propId: "x" },
                  },
                  maxCodePoints: { expectedType: "number", kind: "prop-ref", propId: "limit" },
                  opacity: { expectedType: "number", kind: "prop-ref", propId: "opacity" },
                  value: { expectedType: "string", kind: "prop-ref", propId: "title" },
                  visible: { expectedType: "boolean", kind: "prop-ref", propId: "visible" },
                }
              : child,
          ),
        },
      },
    } as never;
    input.presentation.scene.components[0]!.props = {
      limit: 80,
      opacity: 0,
      title: "Resolved",
      visible: false,
      x: 12,
    };

    const result = checkDeclarationProject(input);

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(
      structuredContent(Object.values(result.value.definition.scene.surfaces)[0]).nodes[
        "instance:text-content"
      ],
    ).toMatchObject({
      maxCodePoints: 80,
      opacity: 0,
      placement: { x: 12 },
      value: { kind: "literal", value: "Resolved" },
      visible: false,
    });
    expect(
      Object.values(result.value.definition.scene.surfaces)[0]!.baseSemanticTree.nodes[
        "instance:semantic-text"
      ],
    ).toMatchObject({ text: "Resolved" });
  });

  it("resolves Theme aliases, NamedStyle, Variant, and Part overrides in contract order", () => {
    const input = project();
    input.themes[0]!.declaration = {
      ...input.themes[0]!.declaration,
      namedStyles: {
        title: {
          kind: "text",
          style: {
            color: { category: "color", kind: "token-ref", tokenId: "inkAlias" },
            fallbackFonts: [{ assetId: "reference-font", kind: "asset-ref" }],
            font: { category: "fontFace", kind: "token-ref", tokenId: "face" },
            fontSize: { category: "logicalLength", kind: "token-ref", tokenId: "sizeAlias" },
            lineHeight: 32,
          },
        },
      },
      tokens: {
        ease: { category: "easing", value: "linear" },
        face: {
          category: "fontFace",
          value: { assetId: "reference-font", kind: "asset-ref" },
        },
        ink: { category: "color", value: { alpha: 1, blue: 0, green: 0, red: 1 } },
        inkAlias: {
          category: "color",
          value: { category: "color", kind: "token-ref", tokenId: "ink" },
        },
        meter: { category: "spatialLength", value: 1 },
        pause: { category: "duration", value: 100 },
        size: { category: "logicalLength", value: 24 },
        sizeAlias: {
          category: "logicalLength",
          value: { category: "logicalLength", kind: "token-ref", tokenId: "size" },
        },
      },
    };
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      parts: { title: { kind: "part" } },
      variants: { emphasis: { kind: "variant", values: ["normal", "strong"] } },
    };
    const text = component.structure.root.root.children[0]!;
    component.structure = {
      ...component.structure,
      partBindings: { title: "text-content" },
      root: {
        ...component.structure.root,
        root: {
          ...component.structure.root.root,
          children: [
            {
              ...text,
              namedStyle: { kind: "named-style-ref", styleId: "title" },
              style: {
                ...text.style,
                align: "center",
                fallbackFonts: [],
                fontSize: 28,
              },
            },
          ],
        },
      },
      variantStyles: {
        emphasis: {
          normal: [],
          strong: [
            {
              style: { fontSize: 30, weight: "bold" },
              targetId: "text-content",
              targetKind: "text",
            },
          ],
        },
      },
    } as never;
    input.presentation.scene.components[0]!.variants = { emphasis: "strong" };
    input.presentation.scene.components[0]!.partOverrides = [
      {
        content: "Overridden",
        partId: "title",
        style: { fontSize: 36 },
        targetKind: "text",
      },
    ];

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(
      structuredContent(result.value.definition.scene.surfaces["instance:surface-root"]).nodes[
        "instance:text-content"
      ],
    ).toMatchObject({
      style: {
        align: "center",
        color: { alpha: 1, blue: 0, green: 0, red: 1 },
        fallbackFontAssetIds: [],
        fontAssetId: "reference-font",
        fontSize: 36,
        lineHeight: 40,
        weight: "bold",
      },
      value: { kind: "literal", value: "Overridden" },
    });
  });

  it("rejects Theme reference failures and conflicting selected Variants", () => {
    const missing = project();
    missing.themes[0]!.declaration = {
      ...missing.themes[0]!.declaration,
      tokens: {
        missing: {
          category: "color",
          value: { category: "color", kind: "token-ref", tokenId: "absent" },
        },
      },
    };
    expect(codes(missing)).toContain("compiler-token-not-found");

    const cycle = project();
    cycle.themes[0]!.declaration = {
      ...cycle.themes[0]!.declaration,
      tokens: {
        a: {
          category: "duration",
          value: { category: "duration", kind: "token-ref", tokenId: "b" },
        },
        b: {
          category: "duration",
          value: { category: "duration", kind: "token-ref", tokenId: "a" },
        },
      },
    };
    expect(codes(cycle)).toContain("compiler-token-cycle");

    const conflict = project();
    conflict.components[0]!.manifest = {
      ...conflict.components[0]!.manifest,
      variants: {
        first: { kind: "variant", values: ["on"] },
        second: { kind: "variant", values: ["on"] },
      },
    };
    conflict.components[0]!.structure = {
      ...conflict.components[0]!.structure,
      variantStyles: {
        first: {
          on: [{ style: { fontSize: 20 }, targetId: "text-content", targetKind: "text" }],
        },
        second: {
          on: [{ style: { fontSize: 21 }, targetId: "text-content", targetKind: "text" }],
        },
      },
    };
    conflict.presentation.scene.components[0]!.variants = { first: "on", second: "on" };
    expect(codes(conflict)).toContain("compiler-variant-style-conflict");

    const unselected = project();
    unselected.components[0]!.manifest = {
      ...unselected.components[0]!.manifest,
      variants: { tone: { kind: "variant", values: ["quiet", "loud"] } },
    };
    unselected.components[0]!.structure = {
      ...unselected.components[0]!.structure,
      variantStyles: {
        tone: {
          loud: [],
          quiet: [{ style: { fontSize: 20 }, targetId: "missing", targetKind: "text" }],
        },
      },
    };
    expect(codes(unselected)).toContain("compiler-variant-target-not-found");
  });

  it("rejects duplicate and non-primitive Part bindings even without overrides", () => {
    const missing = project();
    missing.components[0]!.manifest = {
      ...missing.components[0]!.manifest,
      parts: { title: { kind: "part" } },
    };
    expect(codes(missing)).toContain("compiler-part-binding-set-mismatch");

    const duplicate = project();
    duplicate.components[0]!.manifest = {
      ...duplicate.components[0]!.manifest,
      parts: { first: { kind: "part" }, second: { kind: "part" } },
    };
    duplicate.components[0]!.structure = {
      ...duplicate.components[0]!.structure,
      partBindings: { first: "text-content", second: "text-content" },
    } as never;
    expect(codes(duplicate)).toContain("compiler-part-binding-duplicate");

    const placeholder = project();
    placeholder.components[0]!.manifest = {
      ...placeholder.components[0]!.manifest,
      parts: { badgePlacement: { kind: "part" } },
      slots: { badge: { kind: "slot" } },
    };
    placeholder.components[0]!.structure = {
      ...placeholder.components[0]!.structure,
      partBindings: { badgePlacement: "badge-placement" },
      root: {
        ...placeholder.components[0]!.structure.root,
        root: {
          ...placeholder.components[0]!.structure.root.root,
          children: [
            ...placeholder.components[0]!.structure.root.root.children,
            { id: "badge-placement", kind: "slot-placeholder", slotId: "badge" },
          ],
        },
      },
    } as never;
    expect(codes(placeholder)).toContain("compiler-part-binding-invalid");
  });

  it("expands slotted Frame Components at the placeholder order and adds their semantic roots", () => {
    const input = project();
    const top = input.components[0]!;
    top.manifest = {
      ...top.manifest,
      slots: { badge: { kind: "slot" } },
    };
    top.structure = {
      ...top.structure,
      root: {
        ...top.structure.root,
        baseSemanticTree: {
          nodes: {
            "existing-child": {
              id: "existing-child",
              order: 1,
              parentId: null,
              role: "paragraph",
              text: "Existing",
            },
            "semantic-text": {
              id: "semantic-text",
              level: 1,
              order: 0,
              parentId: null,
              role: "heading",
              text: "Unframe",
            },
          },
          rootNodeIds: ["semantic-text", "existing-child"],
        },
        root: {
          ...top.structure.root.root,
          children: [
            top.structure.root.root.children[0]!,
            {
              ...top.structure.root.root.children[0]!,
              id: "existing-text",
              semanticNodeId: "existing-child",
              value: "Existing",
            },
            { id: "badge-slot", kind: "slot-placeholder", slotId: "badge" },
          ],
        },
      },
    } as never;
    input.presentation.scene.components[0]!.slots = { badge: ["badge-instance"] };
    (
      input.presentation.scene.components as unknown as Array<
        PresentationDeclaration["scene"]["components"][number]
      >
    ).push({
      componentId: "badge",
      id: "badge-instance",
      kind: "component-instance",
      owner: { kind: "presentation" },
      partOverrides: [],
      props: {},
      slots: {},
      variants: {},
      version: 1,
    });
    (input.components as unknown as Array<StructuredProject["components"][number]>).push({
      lock: {
        manifestHash: "badge-manifest",
        mode: "structured",
        origin: { entryFile: "badge.ts", files: [], kind: "local", sourceHash: "sha256:badge" },
        structureHash: "badge-structure",
      },
      manifest: {
        actions: {},
        authoring: { mode: "structured", structure: "./badge.structure.ts" },
        componentId: "badge",
        outputs: {},
        parts: {},
        props: {},
        renderers: ["baked-web"],
        slots: {},
        states: {},
        variants: {},
        version: 1,
      },
      structure: {
        baseSemanticTree: {
          nodes: {
            "badge-semantic": {
              id: "badge-semantic",
              order: 0,
              parentId: null,
              role: "paragraph",
              text: "Badge",
            },
          },
          rootNodeIds: ["badge-semantic"],
        },
        componentId: "badge",
        id: "badge-structure",
        partBindings: {},
        root: {
          children: [
            {
              id: "badge-text",
              kind: "text",
              layout: { height: 100, kind: "absolute", width: 300, x: 0, y: 0 },
              maxCodePoints: 16,
              semanticNodeId: "badge-semantic",
              style: {
                font: { assetId: "reference-font", kind: "asset-ref" },
                fontSize: 24,
                lineHeight: 30,
              },
              value: "Badge",
            },
          ],
          id: "badge-frame",
          kind: "frame",
          layout: { height: 100, kind: "absolute", width: 300, x: 100, y: 100 },
        },
        timelines: [],
        variantStyles: {},
      },
    });

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    const surface = result.value.definition.scene.surfaces["instance:surface-root"]!;
    expect(structuredContent(surface).nodes["instance:frame-root"]).toMatchObject({
      children: ["instance:text-content", "instance:existing-text", "badge-instance:badge-frame"],
    });
    expect(structuredContent(surface).nodes["badge-instance:badge-frame"]).toMatchObject({
      order: 2,
      parentId: "instance:frame-root",
    });
    expect(surface.baseSemanticTree.rootNodeIds).toEqual([
      "instance:semantic-text",
      "instance:existing-child",
      "badge-instance:badge-semantic",
    ]);

    const topStructure = (
      input.components as unknown as Array<StructuredProject["components"][number]>
    )[0]!.structure;
    if (topStructure.root.kind !== "surface") {
      return;
    }
    const slotPlaceholder = topStructure.root.root.children[2];
    if (slotPlaceholder?.kind !== "slot-placeholder") {
      return;
    }
    slotPlaceholder.semanticParentId = "missing";
    expect(codes(input)).toContain("compiler-slot-semantic-parent-not-found");
    slotPlaceholder.semanticParentId = "semantic-text";
    const attached = checkDeclarationProject(input);
    expect(attached.valid ? [] : attached.diagnostics.map(({ code }) => code)).toContain(
      "graph.invalid",
    );

    const badgeStructure = (
      input.components as unknown as Array<StructuredProject["components"][number]>
    )[1]!.structure;
    if (badgeStructure.root.kind !== "frame") {
      return;
    }
    const badgeSemanticTree = badgeStructure.baseSemanticTree!;
    badgeStructure.baseSemanticTree = {
      nodes: {
        ...badgeSemanticTree.nodes,
        alias: badgeSemanticTree.nodes["badge-semantic"]!,
      },
      rootNodeIds: badgeSemanticTree.rootNodeIds,
    };
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "compiler-duplicate-semantic-node-id",
        "compiler-record-key-id-mismatch",
      ]),
    );
  });

  it("rejects missing and self-referencing Slot instance IDs", () => {
    const input = project();
    input.components[0]!.manifest = {
      ...input.components[0]!.manifest,
      slots: { missing: { kind: "slot" }, self: { kind: "slot" } },
    };
    input.components[0]!.structure = {
      ...input.components[0]!.structure,
      root: {
        ...input.components[0]!.structure.root,
        root: {
          ...input.components[0]!.structure.root.root,
          children: [
            input.components[0]!.structure.root.root.children[0]!,
            { id: "self-slot", kind: "slot-placeholder", slotId: "self" },
            { id: "missing-slot", kind: "slot-placeholder", slotId: "missing" },
          ],
        },
      },
    } as never;
    input.presentation.scene.components[0]!.slots = {
      missing: ["absent"],
      self: ["instance"],
    };

    expect(codes(input)).toEqual(
      expect.arrayContaining(["compiler-slot-self-reference", "compiler-slot-instance-not-found"]),
    );
  });

  it("rejects accessor-backed project data without executing the accessor", () => {
    let reads = 0;
    const input = {
      assets: {},
      components: [],
      presentation: presentation(),
      themes: [],
    };
    Object.defineProperty(input, "themes", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      },
    });
    expect(codes(input)).toContain("compiler-invalid-input");
    expect(reads).toBe(0);
  });

  it("keeps malformed public envelopes and sparse arrays on the diagnostic boundary", () => {
    const sparse: Array<string> = [];
    sparse.length = 2;
    sparse[1] = "hole";
    for (const input of [
      { assets: {}, components: [], presentation: {}, themes: [] },
      { assets: {}, components: [], presentation: {}, themes: {} },
      { assets: {}, components: [], extra: sparse, presentation: {}, themes: [] },
    ]) {
      expect(() => checkDeclarationProject(input)).not.toThrow();
      expect(codes(input)).not.toEqual([]);
    }
  });

  it("lowers the reference structured Surface to a Core-valid canonical Definition", () => {
    const result = checkDeclarationProject(project());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(validatePresentationDefinition(result.value.definition).valid).toBe(true);
    expect(
      structuredContent(result.value.definition.scene.surfaces["instance:surface-root"])
        .rootFrameId,
    ).toBe("instance:frame-root");
    const canonical = canonicalizePresentationDefinition(result.value.definition);
    expect(canonical).toMatchObject({ valid: true });
    if (canonical.valid) {
      expect(result.value.definitionJson).toBe(canonical.value);
    }
    expect(result.value.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.sourceHash).toBe(
      "sha256:aa489f983b548617876a4e79f710321d159d6ebd572b1d39db558806dd64ce01",
    );
    expect(result.value.definitionHash).toBe(
      "sha256:feeb8319fee482e9d68aaeb3f71546284aa0bc3a1d12f989fac1e67832509ed0",
    );
  });

  it("accepts recursively null-prototype declaration data", () => {
    const normalized = nullPrototype(project());
    const result = checkDeclarationProject(normalized);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
  });

  it("normalizes Spatial rotations to the v2 canonical quaternion form", () => {
    const input = project();
    input.presentation.scene.spatial[0]!.transform.rotation = [-2, -0, -0, -0];
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(result.value.definition.scene.nodes["instance:spatial"]?.transform.rotation).toEqual([
      1, 0, 0, 0,
    ]);

    const zero = project();
    zero.presentation.scene.spatial[0]!.transform.rotation = [0, 0, 0, 0];
    expect(codes(zero)).toContain("compiler-invalid-quaternion");
  });

  it("does not read length through declaration Array Proxies", () => {
    let reads = 0;
    const value = project();
    value.themes = new Proxy(value.themes, {
      get() {
        reads++;
        throw new Error("must not read array length");
      },
    });

    const result = checkDeclarationProject(value);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(reads).toBe(0);
  });

  it("does not inherit Object.prototype accessors into cloned declaration data", () => {
    let reads = 0;
    Object.defineProperty(Object.prototype, "presentation", {
      configurable: true,
      get() {
        reads++;
        throw new Error("must not inherit caller data");
      },
    });

    try {
      const result = safePlainClone(project());
      expect(result.valid).toBe(true);
      if (!result.valid) {
        return;
      }
      expect(reads).toBe(0);
      expect(Object.getPrototypeOf(result.value)).toBeNull();
    } finally {
      delete (Object.prototype as { presentation?: unknown }).presentation;
    }
  });

  it("is independent of plain-object insertion order", () => {
    const firstProject = project();
    firstProject.presentation.assets = [
      { assetId: "asset-a", kind: "asset-ref" },
      { assetId: "asset-b", kind: "asset-ref" },
    ];
    const sourceAsset = project().assets["reference-font"]!;
    const validAssetA = { ...sourceAsset, id: "asset-a" };
    const validAssetB = { ...sourceAsset, id: "asset-b" };
    const structure = structuredClone(firstProject.components[0]!.structure);
    const text = structure.root.root.children[0]!;
    (text as unknown as { style: Record<string, unknown> }).style = {
      ...text.style!,
      fallbackFonts: [{ assetId: "asset-b", kind: "asset-ref" }],
      font: { assetId: "asset-a", kind: "asset-ref" },
    };
    firstProject.components[0]!.structure = structure;
    firstProject.assets = { "asset-a": validAssetA, "asset-b": validAssetB };
    const first = checkDeclarationProject(firstProject);
    const secondProject = project();
    secondProject.components[0]!.structure = structure;
    secondProject.presentation.assets = [...firstProject.presentation.assets];
    secondProject.assets = {
      "asset-a": validAssetA,
      "asset-b": validAssetB,
    };
    const second = checkDeclarationProject(secondProject);
    expect(first).toMatchObject({ valid: true });
    expect(second).toMatchObject({ valid: true });
    if (!first.valid || !second.valid) {
      return;
    }
    expect(second.value).toEqual(first.value);
  });

  it("does not mutate input and rejects duplicate catalogs, empty locks, interactions, and node parents", () => {
    const value = project();
    const before = structuredClone(value);
    checkDeclarationProject(value);
    expect(value).toEqual(before);

    const duplicateTheme = project();
    expect(
      codes({ ...duplicateTheme, themes: [...duplicateTheme.themes, duplicateTheme.themes[0]!] }),
    ).toContain("compiler-theme-not-found");
    const emptyLock = project();
    expect(
      codes({
        ...emptyLock,
        components: [
          {
            ...emptyLock.components[0]!,
            lock: { ...emptyLock.components[0]!.lock, manifestHash: "" },
          },
        ],
      }),
    ).toContain("compiler-invalid-component-entry");
    const duplicateComponent = project();
    expect(
      codes({
        ...duplicateComponent,
        components: [...duplicateComponent.components, duplicateComponent.components[0]!],
      }),
    ).toContain("compiler-component-not-found");
    const interactions = project();
    expect(
      codes({
        ...interactions,
        components: [
          {
            ...interactions.components[0]!,
            structure: {
              ...interactions.components[0]!.structure,
              root: {
                ...interactions.components[0]!.structure.root,
                states: {
                  default: {
                    ...interactions.components[0]!.structure.root.states.default!,
                    enabledInteractionIds: ["tap"],
                  },
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("behavior.invalid");
    const parent = project();
    expect(
      codes({
        ...parent,
        presentation: {
          ...parent.presentation,
          scene: {
            ...parent.presentation.scene,
            spatial: [
              {
                ...parent.presentation.scene.spatial[0]!,
                parent: { kind: "node", nodeId: "spatial" },
              },
            ],
          },
        },
      }),
    ).toContain("compiler-spatial-node-parent-unsupported");
  });

  it("rejects resolution and subset mismatches without silently dropping them", () => {
    const missingTheme = project();
    missingTheme.presentation.theme = { themeId: "missing" };
    expect(codes(missingTheme)).toContain("compiler-theme-not-found");

    const opaque = project();
    opaque.components[0]!.manifest = {
      ...opaque.components[0]!.manifest,
      authoring: { mode: "opaque" },
      renderers: {},
      semantics: { surfaces: [], targets: [] },
    } as never;
    expect(codes(opaque)).toContain("compiler-opaque-component-unsupported");

    const props = project();
    props.presentation.scene.components[0]!.props = { title: "not supported" };
    expect(codes(props)).toContain("compiler-prop-not-found");

    const owner = project();
    owner.presentation.scene.components[0]!.owner = { groupId: "group", kind: "group" };
    expect(codes(owner)).toContain("compiler-owner-mismatch");
  });

  it("rejects component, structure, lock, style, and Spatial resolution mismatches", () => {
    const missingComponent = project();
    expect(
      codes({
        ...missingComponent,
        presentation: {
          ...missingComponent.presentation,
          scene: {
            ...missingComponent.presentation.scene,
            components: [
              { ...missingComponent.presentation.scene.components[0]!, componentId: "missing" },
            ],
          },
        },
      }),
    ).toContain("compiler-component-not-found");

    const mismatch = project();
    expect(
      codes({
        ...mismatch,
        components: [
          {
            ...mismatch.components[0]!,
            structure: { ...mismatch.components[0]!.structure, componentId: "wrong" } as never,
          },
        ],
      }),
    ).toContain("compiler-component-identity-mismatch");

    const missingSpatial = project();
    expect(
      codes({
        ...missingSpatial,
        presentation: {
          ...missingSpatial.presentation,
          scene: {
            ...missingSpatial.presentation.scene,
            components: [
              { ...missingSpatial.presentation.scene.components[0]!, spatialNodeId: "missing" },
            ],
          },
        },
      }),
    ).toContain("compiler-spatial-not-found");

    const style = project();
    expect(
      codes({
        ...style,
        components: [
          {
            ...style.components[0]!,
            structure: {
              ...style.components[0]!.structure,
              root: {
                ...style.components[0]!.structure.root,
                root: {
                  ...standardComponents.surface.structure.root.root,
                  namedStyle: { kind: "named-style-ref", styleId: "missing" },
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("compiler-named-style-not-found");
  });

  it("lowers nested absolute Frames and rejects nonempty actions, outputs, cues, and operations", () => {
    const nested = project();
    const nestedResult = checkDeclarationProject({
      ...nested,
      components: [
        {
          ...nested.components[0]!,
          structure: {
            ...nested.components[0]!.structure,
            root: {
              ...standardComponents.surface.structure.root,
              root: {
                ...standardComponents.surface.structure.root.root,
                children: [
                  {
                    children: [standardComponents.surface.structure.root.root.children[0]!],
                    id: "nested",
                    kind: "frame",
                    layout: { height: 1, kind: "absolute", width: 1, x: 0, y: 0 },
                  },
                ],
              },
            },
          } as never,
        },
      ],
    });
    expect(nestedResult.valid).toBe(true);
    if (nestedResult.valid) {
      expect(
        structuredContent(Object.values(nestedResult.value.definition.scene.surfaces)[0]).nodes,
      ).toHaveProperty("instance:nested");
    }

    const features = project();
    expect(
      codes({
        ...features,
        components: [
          {
            ...features.components[0]!,
            manifest: {
              ...features.components[0]!.manifest,
              actions: {
                click: {
                  effects: [
                    { completion: "blocking", kind: "playTimeline", timelineId: "timeline" },
                  ],
                  inputs: {},
                  kind: "action",
                  preconditions: [],
                },
              },
              outputs: {
                done: {
                  kind: "output",
                  payload: {},
                  producer: { afterMilliseconds: 1, kind: "timer" },
                },
              },
            },
          },
        ],
        presentation: {
          ...features.presentation,
          flow: {
            ...features.presentation.flow,
            groups: {
              group: {
                id: "group",
                initialStepId: "step",
                steps: {
                  step: {
                    cues: [{ actions: [], id: "cue", trigger: { event: "tap", kind: "event" } }],
                    id: "step",
                  },
                },
              },
            },
          },
          operations: [
            {
              id: "detach",
              instanceId: "instance",
              kind: "detach",
              mode: "structured",
              provenance: { componentId: "x", version: 1 },
            },
          ],
        },
      }),
    ).toEqual(expect.arrayContaining(["compiler-operations-unsupported"]));
  });

  it("uses escaped instance-local identifiers and rejects hostile boundary values", () => {
    const escaped = project();
    escaped.presentation.scene.components[0]!.id = "instance/a";
    const result = checkDeclarationProject(escaped);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (result.valid) {
      expect(result.value.definition.scene.surfaces).toHaveProperty("instance/a:surface-root");
    }

    const collision = project();
    collision.presentation.scene.spatial[0]!.id = "surface-root";
    collision.presentation.scene.components[0]!.spatialNodeId = "surface-root";
    expect(codes(collision)).toContain("compiler-resource-id-collision");

    const inheritedAsset = project();
    inheritedAsset.presentation.assets = [{ assetId: "toString", kind: "asset-ref" }];
    expect(codes(inheritedAsset)).toContain("compiler-asset-not-found");

    const unreferencedAsset = project();
    unreferencedAsset.assets = {
      unused: { ...project().assets["reference-font"]!, id: "unused" },
    };
    expect(codes(unreferencedAsset)).toContain("compiler-asset-unreferenced");

    const malformedStructure = project();
    (malformedStructure.components[0] as unknown as { structure: unknown }).structure = {};
    const malformedStructureResult = checkDeclarationProject(malformedStructure);
    expect(malformedStructureResult).toMatchObject({
      diagnostics: [
        {
          code: "compiler-invalid-declaration",
          path: ["components", 0, "structure"],
        },
      ],
      valid: false,
    });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => checkDeclarationProject(cyclic)).not.toThrow();
    expect(codes(cyclic)).toContain("compiler-invalid-input");

    expect(codes({ presentation: undefined })).toContain("compiler-invalid-input");
    expect(codes({ callback: () => undefined })).toContain("compiler-invalid-input");
    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "presentation", {
      enumerable: true,
      get: () => {
        throw new Error("hostile");
      },
    });
    expect(() => checkDeclarationProject(throwingGetter)).not.toThrow();
    expect(codes(throwingGetter)).toContain("compiler-invalid-input");

    const symbol = project() as Record<string | symbol, unknown>;
    symbol[Symbol("hidden")] = true;
    expect(codes(symbol)).toContain("compiler-invalid-input");
    const hidden = project();
    Object.defineProperty(hidden, "hidden", { value: true });
    expect(codes(hidden)).toContain("compiler-invalid-input");
    const arrayWithExtra = project();
    Object.assign(arrayWithExtra.themes, { extra: true });
    expect(codes(arrayWithExtra)).toContain("compiler-invalid-input");
    const proto = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
    Object.defineProperty(proto, "__proto__", { enumerable: true, value: { retained: true } });
    expect(codes(proto)).toContain("compiler-invalid-project-field");

    const customArray = project();
    let customMapCalled = false;
    Object.setPrototypeOf(customArray.themes, {
      map: () => {
        customMapCalled = true;
        return [];
      },
    });
    expect(codes(customArray)).toContain("compiler-invalid-input");
    expect(customMapCalled).toBe(false);

    class CustomData {}
    const customObject = project();
    customObject.assets = new CustomData() as never;
    expect(codes(customObject)).toContain("compiler-invalid-input");
  });

  it("keeps instance and local ID tuples distinct when either segment contains a colon", () => {
    const input = project();
    const baseSpatial = input.presentation.scene.spatial[0]!;
    const baseInstance = input.presentation.scene.components[0]!;
    const baseComponent = input.components[0]!;
    const makeComponent = (
      componentId: string,
      instanceId: string,
      spatialId: string,
      surfaceId: string,
      suffix: string,
    ) => {
      const manifest = { ...baseComponent.manifest, componentId };
      const structure = {
        ...baseComponent.structure,
        componentId,
        root: {
          ...baseComponent.structure.root,
          id: surfaceId,
          root: {
            ...baseComponent.structure.root.root,
            children: baseComponent.structure.root.root.children.map((child) => ({
              ...child,
              id: `text-${suffix}`,
            })),
            id: `frame-${suffix}`,
          },
        },
      };
      const lock = {
        manifestHash: `manifest-${suffix}`,
        mode: "structured" as const,
        origin: {
          entryFile: `surface-${suffix}.ts`,
          files: [],
          kind: "local" as const,
          sourceHash: `sha256:source-${suffix}`,
        },
        structureHash: `structure-${suffix}`,
      };
      return {
        catalog: { lock, manifest, structure },
        instance: {
          ...baseInstance,
          componentId,
          id: instanceId,
          spatialNodeId: spatialId,
        },
        spatial: { ...baseSpatial, id: spatialId, order: suffix === "one" ? 0 : 1 },
      };
    };
    const first = makeComponent("surface-one", "a:b", "spatial-one", "c", "one");
    const second = makeComponent("surface-two", "a", "spatial-two", "b:c", "two");
    input.presentation.scene.spatial = [first.spatial, second.spatial];
    input.presentation.scene.components = [first.instance, second.instance];
    (input as unknown as { components: Array<unknown> }).components = [
      first.catalog,
      second.catalog,
    ];

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(Object.keys(result.value.definition.scene.surfaces)).toHaveLength(2);
  });

  it("rejects duplicate lowering identifiers and operations without component instances", () => {
    const duplicateSpatial = project();
    duplicateSpatial.presentation.scene.spatial = [
      ...duplicateSpatial.presentation.scene.spatial,
      { ...duplicateSpatial.presentation.scene.spatial[0]! },
    ] as never;
    expect(codes(duplicateSpatial)).toContain("compiler-duplicate-spatial-id");
    const duplicateContent = project();
    duplicateContent.components[0]!.structure = {
      ...duplicateContent.components[0]!.structure,
      root: {
        ...duplicateContent.components[0]!.structure.root,
        root: {
          ...duplicateContent.components[0]!.structure.root.root,
          children: [
            ...duplicateContent.components[0]!.structure.root.root.children,
            { ...duplicateContent.components[0]!.structure.root.root.children[0]! },
          ],
        },
      },
    } as never;
    expect(codes(duplicateContent)).toContain("compiler-duplicate-content-id");
    const operations = project();
    operations.presentation.scene.components = [];
    operations.presentation.scene.spatial = [];
    operations.presentation.operations = [
      {
        id: "op",
        instanceId: "instance",
        kind: "detach",
        mode: "structured",
        provenance: { componentId: "component", version: 1 },
      },
    ];
    expect(codes(operations)).toContain("compiler-operations-unsupported");
  });

  it("rejects malformed presentation fields, assets, and duplicate asset references", () => {
    const metadata = project();
    (metadata.presentation.metadata as unknown as { title: unknown }).title = 1;
    expect(codes(metadata)).toContain("compiler-invalid-declaration");

    const coordinateSystem = project();
    (
      coordinateSystem.presentation.stage.coordinateSystem as unknown as { handedness: string }
    ).handedness = "left";
    expect(codes(coordinateSystem)).toContain("compiler-invalid-declaration");

    const audience = project();
    (audience.presentation.scene.spatial[0] as unknown as { audience: unknown }).audience = {
      kind: "role",
      role: "operator",
    };
    expect(codes(audience)).toContain("compiler-invalid-declaration");

    const malformedAsset = project() as ReturnType<typeof project> & {
      assets: Record<string, unknown>;
    };
    (malformedAsset.assets as Record<string, unknown>)["asset"] = {
      checksum: null,
      id: "asset",
      mediaType: 123,
    };
    expect(codes(malformedAsset)).toContain("compiler-invalid-asset");

    const duplicateReference = project();
    duplicateReference.presentation.assets = [
      { assetId: "asset", kind: "asset-ref" },
      { assetId: "asset", kind: "asset-ref" },
    ];
    (duplicateReference as typeof duplicateReference & { assets: Record<string, unknown> }).assets =
      {
        asset: { ...project().assets["reference-font"]!, id: "asset" },
      };
    expect(codes(duplicateReference)).toContain("compiler-duplicate-asset-reference");
  });

  it("keeps the asset validation diagnostic code and path", () => {
    const input = project();
    input.assets["reference-font"] = {
      ...input.assets["reference-font"]!,
      checksum: "sha256:invalid",
    };

    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([
      {
        code: "compiler-invalid-asset",
        message: "Asset descriptors must match their key and portable contract shape.",
        path: ["assets", "reference-font"],
      },
    ]);
  });
});

describe("compileDeclarationProject", () => {
  const renderer: RendererPlugin = {
    build: (input) => ({
      captures: Object.entries(input.plan.states)
        .filter(([, state]) => state.kind === "capture")
        .map(([stateId]) => ({
          alphaMode: "opaque",
          colorSpace: "srgb",
          id: `${stateId}:capture`,
          pixelSize: input.context.pixelTarget,
          rgba: Uint8Array.from(
            { length: input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 },
            (_, index) => (index % 4 === 3 ? 255 : 0),
          ),
          stateId,
        })),
      diagnostics: [],
      ok: true,
      provenance: {
        ...renderer.identity,
        buildContextHash: input.context.buildContextHash,
        environmentHash: input.context.environmentHash,
        inputHash: input.context.inputHash,
        rendererConfigHash: input.context.rendererConfigHash,
        rendererFingerprint: createRendererFingerprint(
          renderer.identity,
          input.context.rendererConfigHash,
        ),
      },
      renderSurface: {
        id: input.plan.id,
        layer: input.plan.layer,
        logicalBounds: input.plan.logicalBounds,
        semanticSurfaceId: input.plan.semanticSurfaceId,
      },
    }),
    capabilities: {
      deterministic: true,
      fallbackPolicies: ["reject"],
      inputKinds: ["structured"],
      interactions: ["none", "regions"],
      internalAnimations: ["none"],
      rendererPreferences: ["baked-web"],
      updateModels: ["static", "finite-state"],
    },
    identity: {
      contractVersion: "1",
      id: "baked-web",
      implementationHash: "sha256:renderer",
      version: "1",
    },
    support: evaluateFirstMilestoneSupport,
  };
  const options = () => ({
    colorScheme: "dark" as const,
    compiler: { baseEnvironmentHash: "sha256:environment", name: "unframe", version: "1" },
    encodeLimits: PNG_ABSOLUTE_LIMITS,
    locale: "ja-JP",
    rendererConfigHash: "sha256:config",
    renderers: [renderer],
    timezone: "Asia/Tokyo",
  });

  it("does not render a Surface with no paint in any state", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("Expected standard Surface.");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          states: {
            default: {
              contentOverrides: { "text-content": { kind: "text", visible: false } },
              enabledInteractionIds: [],
              id: "default",
              semanticOverrides: [],
            },
          },
        },
      } as ComponentStructure,
    };
    let calls = 0;
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(input, { ...options(), renderers: [observing] });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(calls).toBe(0);
    expect(result.value.renderBundle.surfaces["instance:surface-root"]?.renderSurfaceIds).toEqual(
      [],
    );
    expect(
      Object.values(result.value.assetSet.assets).filter(
        ({ mediaType }) => mediaType === "image/png",
      ),
    ).toEqual([]);
  });

  it("keeps partition identity and bounds fixed when a later state is empty", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("Expected standard Surface.");
    }
    input.components[0] = {
      ...entry,
      manifest: {
        ...entry.manifest,
        states: { default: { initial: true, kind: "state" }, hidden: { kind: "state" } },
      },
      structure: {
        ...entry.structure,
        root: {
          ...root,
          renderIntent: { ...root.renderIntent, updateModel: "finite-state" },
          states: {
            default: { enabledInteractionIds: [], id: "default", semanticOverrides: [] },
            hidden: {
              contentOverrides: { "text-content": { kind: "text", visible: false } },
              enabledInteractionIds: [],
              id: "hidden",
              semanticOverrides: [],
            },
          },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProject(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toHaveLength(1);
    const renderSurface = compiled.renderSurfaces[compiled.renderSurfaceIds[0]!]!;
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        artifactIds: [Object.keys(renderSurface.artifacts)[0]!],
        kind: "artifacts",
      },
      "instance:hidden": { kind: "empty" },
    });
    const artifact = Object.values(renderSurface.artifacts)[0]!;
    if (artifact.kind !== "baked-web") {
      throw new Error("Expected baked-web artifact.");
    }
    expect(Object.keys(artifact.states)).toEqual(["instance:default"]);
  });

  const partitionedInput = () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame") {
      throw new Error("Expected standard Surface.");
    }
    const text = root.root.children[0]!;
    const nested = {
      ...root.root,
      children: [
        {
          ...text,
          id: "inner-text",
          layout: { height: 50, kind: "absolute" as const, width: 100, x: 10, y: 10 },
        },
      ],
      id: "nested",
      layout: { height: 400, kind: "absolute" as const, width: 800, x: 100, y: 100 },
      opacity: 0.5,
      style: { backgroundColor: { alpha: 1, blue: 0, green: 0, red: 1 } },
    };
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: {
            ...root.root,
            children: [nested],
            style: { backgroundColor: { alpha: 1, blue: 0, green: 0, red: 0 } },
          },
        },
      } as ComponentStructure,
    };
    return input;
  };

  it("partitions a painted root and a translucent group in canonical paint order", async () => {
    const input = partitionedInput();
    const seen: Array<{
      context: ReadonlyArray<string>;
      id: string;
      layer: number;
      owned: ReadonlyArray<string>;
    }> = [];
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        seen.push({
          context:
            value.plan.ownership.kind === "structured" ? value.plan.ownership.contextNodeIds : [],
          id: value.plan.id,
          layer: value.plan.layer,
          owned:
            value.plan.ownership.kind === "structured"
              ? value.plan.ownership.ownedContentNodeIds
              : [],
        });
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(input, { ...options(), renderers: [observing] });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    const compiled = Object.values(result.value.renderBundle.surfaces)[0]!;
    expect(compiled.renderSurfaceIds).toEqual([
      "rs_72492e420a8d63224465f844a782dd31ef0c6e948ca29dc6e0571e8cd3ede04c",
      "rs_4ad6b5a5009dcbbd660389e2de40f038ea3475eefb324c445c6f600d52290982",
    ]);
    expect(seen.map(({ layer }) => layer)).toEqual([0, 1]);
    expect(seen.flatMap(({ owned }) => owned)).toEqual([
      "instance:frame-root",
      "instance:nested",
      "instance:inner-text",
    ]);
    expect(seen[1]?.context).toContain("instance:frame-root");
    expect(compiled.renderSurfaceIds.every((id) => /^rs_[0-9a-f]{64}$/.test(id))).toBe(true);
  });

  it("derives one Surface button region across multiple image partitions", async () => {
    const input = partitionedInput();
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame") {
      throw new Error("Expected partitioned Surface.");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          baseSemanticTree: {
            nodes: {
              ...root.baseSemanticTree.nodes,
              button: {
                id: "button",
                interactionId: "open",
                order: 1,
                parentId: null,
                role: "button",
                text: "Open",
              },
            },
            rootNodeIds: ["semantic-text", "button"],
          },
          interactions: { open: { event: "open", hitPriority: 4, id: "open", kind: "click" } },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
          root: { ...root.root, semanticNodeId: "button" },
          states: {
            default: { enabledInteractionIds: ["open"], id: "default", semanticOverrides: [] },
          },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProject(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toHaveLength(2);
    expect(compiled.interactionsByState["instance:default"]).toEqual([
      {
        bounds: { height: 1, width: 1, x: 0, y: 0 },
        coordinateSpace: "normalized",
        interactionId: "instance:open",
        priority: 4,
        semanticNodeId: "instance:button",
      },
    ]);
  });

  it("changes the clipped partition identity when only its border radius changes", async () => {
    const withRadius = (radius: number) => {
      const input = partitionedInput();
      const entry = input.components[0]!;
      const root = entry.structure.root;
      if (root.kind !== "surface" || root.root.kind !== "frame") {
        throw new Error("Expected partitioned Surface.");
      }
      const nested = root.root.children[0]!;
      if (nested.kind !== "frame") {
        throw new Error("Expected nested Frame.");
      }
      input.components[0] = {
        ...entry,
        structure: {
          ...entry.structure,
          root: {
            ...root,
            root: {
              ...root.root,
              children: [
                {
                  ...nested,
                  style: {
                    ...nested.style,
                    border: { color: { alpha: 0, blue: 0, green: 0, red: 0 }, radius, width: 2 },
                    clip: true,
                  },
                },
              ],
            },
          },
        } as ComponentStructure,
      };
      return input;
    };
    const flat = await compileDeclarationProject(withRadius(0), options());
    const rounded = await compileDeclarationProject(withRadius(3), options());
    const repeated = await compileDeclarationProject(withRadius(3), options());
    expect(flat.valid ? [] : flat.diagnostics).toEqual([]);
    expect(rounded.valid ? [] : rounded.diagnostics).toEqual([]);
    expect(repeated.valid ? [] : repeated.diagnostics).toEqual([]);
    if (!flat.valid || !rounded.valid || !repeated.valid) {
      return;
    }
    const flatIds = flat.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds;
    const roundedIds =
      rounded.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds;
    expect(flatIds).toHaveLength(2);
    expect(flatIds[0]).toBe(roundedIds[0]);
    expect(flatIds[1]).not.toBe(roundedIds[1]);
    expect(repeated.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds).toEqual(
      roundedIds,
    );
  }, 15_000);

  it("fails the whole build when a later partition renderer call fails", async () => {
    let calls = 0;
    const failing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        if (calls === 2) {
          return {
            diagnostics: [
              { code: "test-renderer-failure", message: "Second partition failed.", path: [] },
            ],
            ok: false,
          };
        }
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(partitionedInput(), {
      ...options(),
      renderers: [failing],
    });
    expect(calls).toBe(2);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("test-renderer-failure");
    }
  });

  it("clips partition bounds to the Surface cover window", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("Expected standard Surface.");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: { ...root, fit: "cover", physicalSizeMeters: [1, 1] },
      } as ComponentStructure,
    };
    let bounds: { height: number; width: number; x: number; y: number } | undefined;
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        bounds = value.plan.logicalBounds;
        return {
          diagnostics: [{ code: "test-stop", message: "Observed plan.", path: [] }],
          ok: false,
        };
      },
    };
    await compileDeclarationProject(input, { ...options(), renderers: [probe] });
    expect(bounds).toEqual({ height: 1080, width: 1080, x: 420, y: 0 });
  });

  it("clips a button region once by its ancestor Frame", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame") {
      throw new Error("Expected standard Surface.");
    }
    const text = root.root.children[0]!;
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          baseSemanticTree: {
            nodes: {
              "semantic-text": {
                id: "semantic-text",
                interactionId: "open",
                order: 0,
                parentId: null,
                role: "button",
                text: "Open",
              },
            },
            rootNodeIds: ["semantic-text"],
          },
          interactions: { open: { event: "open", hitPriority: 2, id: "open", kind: "click" } },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
          root: {
            ...root.root,
            children: [
              { ...text, layout: { height: 100, kind: "absolute", width: 240, x: 1800, y: 0 } },
            ],
            style: { clip: true },
          },
          states: {
            default: { enabledInteractionIds: ["open"], id: "default", semanticOverrides: [] },
          },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProject(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(
      result.value.renderBundle.surfaces["instance:surface-root"]?.interactionsByState[
        "instance:default"
      ],
    ).toEqual([
      {
        bounds: { height: 100 / 1080, width: 0.0625, x: 0.9375, y: 0 },
        coordinateSpace: "normalized",
        interactionId: "instance:open",
        priority: 2,
        semanticNodeId: "instance:semantic-text",
      },
    ]);
  });

  it("owns a Frame that paints only through a State override", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("Expected standard Surface.");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          states: {
            default: {
              contentOverrides: {
                "frame-root": {
                  backgroundColor: { alpha: 1, blue: 0, green: 0, red: 1 },
                  kind: "frame",
                },
              },
              enabledInteractionIds: [],
              id: "default",
              semanticOverrides: [],
            },
          },
        },
      } as ComponentStructure,
    };
    let owned: ReadonlyArray<string> = [];
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        owned =
          value.plan.ownership.kind === "structured"
            ? value.plan.ownership.ownedContentNodeIds
            : [];
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(input, { ...options(), renderers: [probe] });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(owned).toEqual(["instance:frame-root", "instance:text-content"]);
  });

  it("keeps a transparent button clickable without a paint partition", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    input.presentation.assets = [];
    input.assets = {};
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame") {
      throw new Error("Expected standard Surface.");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          baseSemanticTree: {
            nodes: {
              button: {
                id: "button",
                interactionId: "open",
                order: 0,
                parentId: null,
                role: "button",
                text: "Open",
              },
            },
            rootNodeIds: ["button"],
          },
          interactions: { open: { event: "open", hitPriority: 3, id: "open", kind: "click" } },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
          root: { ...root.root, children: [], semanticNodeId: "button" },
          states: {
            default: { enabledInteractionIds: ["open"], id: "default", semanticOverrides: [] },
          },
        },
      } as ComponentStructure,
    };
    let calls = 0;
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(input, { ...options(), renderers: [observing] });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(calls).toBe(0);
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toEqual([]);
    expect(compiled.interactionsByState["instance:default"]).toEqual([
      {
        bounds: { height: 1, width: 1, x: 0, y: 0 },
        coordinateSpace: "normalized",
        interactionId: "instance:open",
        priority: 3,
        semanticNodeId: "instance:button",
      },
    ]);
  });

  it("keeps a non-painting semantic Frame as renderer context", async () => {
    const input = project() as StructuredProject & {
      components: Array<StructuredProject["components"][number]>;
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") {
      throw new Error("fixture must be a surface");
    }
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          baseSemanticTree: {
            nodes: {
              ...root.baseSemanticTree.nodes,
              "frame-button": {
                id: "frame-button",
                interactionId: "open",
                order: 1,
                parentId: null,
                role: "button",
                text: "Open",
              },
            },
            rootNodeIds: ["semantic-text", "frame-button"],
          },
          interactions: { open: { event: "open", hitPriority: 1, id: "open", kind: "click" } },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
          root: { ...root.root, semanticNodeId: "frame-button" },
          states: {
            default: { enabledInteractionIds: ["open"], id: "default", semanticOverrides: [] },
          },
        } as SurfaceDeclaration,
      } as ComponentStructure,
    };
    let owned: ReadonlyArray<string> = [];
    let context: ReadonlyArray<string> = [];
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        if (value.plan.ownership.kind !== "structured") {
          throw new Error("Expected structured ownership");
        }
        owned = value.plan.ownership.ownedContentNodeIds;
        context = value.plan.ownership.contextNodeIds;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProject(input, { ...options(), renderers: [probe] });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(owned).not.toContain("instance:frame-root");
    expect(context).toContain("instance:frame-root");
    expect(
      result.value.renderBundle.surfaces["instance:surface-root"]?.interactionsByState[
        "instance:default"
      ],
    ).toEqual([
      {
        bounds: { height: 1, width: 1, x: 0, y: 0 },
        coordinateSpace: "normalized",
        interactionId: "instance:open",
        priority: 1,
        semanticNodeId: "instance:frame-button",
      },
    ]);
  });

  it("reports every preflight texture budget violation before invoking a renderer", async () => {
    const input = project();
    const states = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => {
        const id = index === 0 ? "default" : `state-${index}`;
        return [id, { enabledInteractionIds: [], id, semanticOverrides: [] }];
      }),
    );
    const manifestStates = Object.fromEntries(
      Object.keys(states).map((id) => [
        id,
        { kind: "state" as const, ...(id === "default" ? { initial: true } : {}) },
      ]),
    );
    input.components[0]!.manifest = {
      ...input.components[0]!.manifest,
      states: manifestStates as never,
    };
    input.components[0]!.structure = {
      ...input.components[0]!.structure,
      root: {
        ...input.components[0]!.structure.root,
        logicalSize: [1, 1] as never,
        states: states as never,
      },
    };
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProject(input, {
      ...options(),
      renderers: [countingRenderer],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        "compiler-budget-rendered-pixels-exceeded",
        "compiler-budget-capture-bytes-exceeded",
        "compiler-budget-state-count-exceeded",
      ]);
    }
    expect(calls).toBe(0);
  });
  it("rejects opaque stability and encoded output budgets before invoking a renderer", async () => {
    const states = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [
        `state-${index}`,
        { enabledInteractionIds: [], semanticOverrides: [] },
      ]),
    );
    const metadata = validateStaticComponentMetadata({
      actions: {},
      id: "large",
      initialState: "state-0",
      interactions: {},
      outputs: {},
      props: {},
      semantics: {
        nodes: { title: { level: 1, order: 0, parentId: null, role: "heading", text: "Hello" } },
        rootNodeIds: ["title"],
      },
      states,
      surface: { logicalSize: [2048, 2048] },
      version: 1,
    });
    const input = project();
    const { theme: _theme, ...header } = input.presentation;
    const scene = [
      {
        audience: { kind: "all" },
        component: { id: "large", version: 1 },
        fit: "contain",
        id: "large-one",
        owner: { kind: "presentation" },
        parent: { kind: "stage" },
        physicalSizeMeters: [1, 1],
        props: {},
        transform: { position: [0, 0, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ];
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProject(
      {
        assets: {},
        components: [
          {
            lock: {
              manifestHash: "sha256:manifest",
              mode: "opaque",
              origin: {
                entryFile: "large.component.tsx",
                files: [],
                kind: "local",
                sourceHash: "sha256:source",
              },
              rendererInputHash: "sha256:renderer",
            },
            manifest: buildOpaqueComponentManifest(metadata, "large.component.tsx#render"),
            metadata,
            rendererEntry: "large.component.tsx#render",
            rendererSource: "export default () => null",
          },
        ],
        presentation: { ...header, assets: [], scene },
        themes: [],
      },
      { ...options(), renderers: [countingRenderer] },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const codes = result.diagnostics.map((item) => item.code);
      expect(codes).toContain("compiler-budget-output-bytes-exceeded");
      expect(codes).toContain("compiler-budget-accounted-peak-exceeded");
    }
    expect(calls).toBe(0);
  });

  it("counts Structured PNG output before a mixed opaque capture", async () => {
    const input = project();
    const entry = input.components[0]!;
    const largeStructure = {
      ...entry.structure,
      root: { ...entry.structure.root, logicalSize: [2048, 2048] },
    } as unknown as ComponentStructure;
    const states = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `state-${index}`,
        { enabledInteractionIds: [], semanticOverrides: [] },
      ]),
    );
    const metadata = validateStaticComponentMetadata({
      actions: {},
      id: "large",
      initialState: "state-0",
      interactions: {},
      outputs: {},
      props: {},
      semantics: {
        nodes: { title: { level: 1, order: 0, parentId: null, role: "heading", text: "Hello" } },
        rootNodeIds: ["title"],
      },
      states,
      surface: { logicalSize: [2048, 2048] },
      version: 1,
    });
    const reactItem = {
      audience: { kind: "all" },
      component: { id: "large", version: 1 },
      fit: "contain",
      id: "large-one",
      owner: { kind: "presentation" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1, 1],
      props: {},
      transform: { position: [0, 0, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    };
    const mixed = {
      ...input,
      components: [
        { ...entry, structure: largeStructure },
        {
          lock: {
            manifestHash: "sha256:manifest",
            mode: "opaque",
            origin: {
              entryFile: "large.component.tsx",
              files: [],
              kind: "local",
              sourceHash: "sha256:source",
            },
            rendererInputHash: "sha256:renderer",
          },
          manifest: buildOpaqueComponentManifest(metadata, "large.component.tsx#render"),
          metadata,
          rendererEntry: "large.component.tsx#render",
          rendererSource: "export default () => null",
        },
      ],
      presentation: {
        ...input.presentation,
        scene: {
          ...input.presentation.scene,
          components: [
            ...input.presentation.scene.components,
            {
              ...input.presentation.scene.components[0]!,
              id: "instance-two",
              spatialNodeId: "spatial-two",
            },
            reactItem,
          ],
          spatial: [
            ...input.presentation.scene.spatial,
            { ...input.presentation.scene.spatial[0]!, id: "spatial-two", order: 1 },
          ],
        },
      },
    };
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProject(mixed, {
      ...options(),
      renderers: [countingRenderer],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.diagnostics.map((item) => item.code),
        JSON.stringify(result.diagnostics),
      ).toContain("compiler-budget-output-bytes-exceeded");
    }
    expect(calls).toBe(0);
  });

  it("renders every Surface state into a canonical valid RenderBundle without changing check", async () => {
    const before = checkDeclarationProject(project());
    const result = await compileDeclarationProject(project(), options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) {
      return;
    }
    expect(result.value.renderBundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.renderBundleJson).toBeTruthy();
    expect(Object.keys(result.value.assets)).toHaveLength(2);
    expect(result.value.renderBundle.schemaVersion).toBe(2);
    expect(result.value.renderBundle.models).toEqual({});
    expect(result.value.renderBundle.buildContext.textureBuildPolicy.longEdgePixels).toBe(2048);
    expect(result.value.assetSet.assets["reference-font"]?.mediaType).toBe("font/ttf");
    expect(result.value.assetSetJson).toBeTruthy();
    expect(result.value.buildManifest).toMatchObject({
      assetSetHash: result.value.assetSetHash,
      definitionHash: result.value.definitionHash,
      renderBundleHash: result.value.renderBundleHash,
      schemaVersion: 2,
      sourceDraftRevision: 0,
    });
    expect(result.value.buildManifestJson).toBeTruthy();
    const surface = result.value.renderBundle.surfaces["instance:surface-root"]!;
    const renderSurfaceId = surface.renderSurfaceIds[0]!;
    const renderSurface = surface.renderSurfaces[renderSurfaceId]!;
    const artifactId = Object.keys(renderSurface.artifacts)[0]!;
    expect(renderSurface.artifacts[artifactId]).toHaveProperty("states.instance:default.texture");
    expect(renderSurface.partitionStrategyVersion).toBe(1);
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        artifactIds: [artifactId],
        kind: "artifacts",
      },
    });
    expect(checkDeclarationProject(project())).toEqual(before);
    const repeated = await compileDeclarationProject(project(), options());
    expect(repeated.valid).toBe(true);
    if (!repeated.valid) {
      return;
    }
    expect({ ...repeated.value, assets: undefined }).toEqual({
      ...result.value,
      assets: undefined,
    });
    expect(Object.keys(repeated.value.assets).sort()).toEqual(
      Object.keys(result.value.assets).sort(),
    );
    for (const [assetId, bytes] of Object.entries(result.value.assets)) {
      const repeatedBytes = repeated.value.assets[assetId]!;
      expect(
        repeatedBytes.length === bytes.length &&
          repeatedBytes.every((byte, index) => byte === bytes[index]),
      ).toBe(true);
    }
  });

  it("rejects accessor-backed build options without invoking the accessor", async () => {
    let accessed = false;
    const hostile = options() as Record<string, unknown>;
    Object.defineProperty(hostile, "compiler", {
      enumerable: true,
      get: () => {
        accessed = true;
        throw new Error("hostile");
      },
    });

    const result = await compileDeclarationProject(project(), hostile);

    expect(accessed).toBe(false);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map((item) => item.code)).toContain("compiler-invalid-options");
    }
  });

  it("binds bundle identity to compiler and build context", async () => {
    const baseline = await compileDeclarationProject(project(), options());
    const differentCompiler = await compileDeclarationProject(project(), {
      ...options(),
      compiler: { ...options().compiler, version: "2" },
    });
    const differentLocale = await compileDeclarationProject(project(), {
      ...options(),
      locale: "en-US",
    });
    expect(baseline.valid && differentCompiler.valid && differentLocale.valid).toBe(true);
    if (!baseline.valid || !differentCompiler.valid || !differentLocale.valid) {
      return;
    }
    expect(differentCompiler.value.renderBundle.bundleId).not.toBe(
      baseline.value.renderBundle.bundleId,
    );
    expect(differentLocale.value.renderBundle.bundleId).not.toBe(
      baseline.value.renderBundle.bundleId,
    );
  });

  it("renders surfaces in locale-independent UTF-16 lexical order", async () => {
    const value = project();
    const originalSpatial = value.presentation.scene.spatial[0]!;
    const originalInstance = value.presentation.scene.components[0]!;
    value.presentation.scene.spatial = [
      { ...originalSpatial, id: "spatial-a", order: 1 },
      { ...originalSpatial, id: "spatial-Z", order: 0 },
    ];
    value.presentation.scene.components = [
      { ...originalInstance, id: "a", spatialNodeId: "spatial-a" },
      { ...originalInstance, id: "Z", spatialNodeId: "spatial-Z" },
    ];
    const calls: Array<string> = [];
    const orderedRenderer: RendererPlugin = {
      ...renderer,
      build: (input) => {
        calls.push(input.surface.id);
        return renderer.build(input);
      },
    };

    const result = await compileDeclarationProject(value, {
      ...options(),
      renderers: [orderedRenderer],
    });

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(calls).toEqual(["Z:surface-root", "a:surface-root"]);
  });

  it("keeps renderer and encoder failures on the diagnostic boundary", async () => {
    const noRenderer = await compileDeclarationProject(project(), { ...options(), renderers: [] });
    expect(noRenderer.valid && noRenderer.value).toBeFalsy();
    if (!noRenderer.valid) {
      expect(noRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-not-found",
      );
    }
    const duplicateRenderer = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [renderer, { ...renderer }],
    });
    expect(duplicateRenderer.valid).toBe(false);
    if (!duplicateRenderer.valid) {
      expect(duplicateRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-ambiguous",
      );
    }
    const invalidRenderer = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [{ ...renderer, build: undefined } as never],
    });
    expect(invalidRenderer.valid).toBe(false);
    if (!invalidRenderer.valid) {
      expect(invalidRenderer.diagnostics.map((item) => item.code)).toContain(
        "invalid-renderer-plugin",
      );
    }
    const throwing = {
      ...renderer,
      build: () => {
        throw new Error("nope");
      },
    };
    const failure = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [throwing],
    });
    expect(failure.valid).toBe(false);
    if (!failure.valid) {
      expect(failure.diagnostics.map((item) => item.code)).toContain("renderer-threw");
    }
    const mutating = {
      ...renderer,
      build: (input: Parameters<RendererPlugin["build"]>[0]) => {
        (input.plan.states as Record<string, unknown>).mutated = { kind: "capture" };
        return renderer.build(input);
      },
    };
    const mutation = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [mutating],
    });
    expect(mutation.valid).toBe(false);
    if (!mutation.valid) {
      expect(mutation.diagnostics.map((item) => item.code)).toContain("renderer-mutated-input");
    }
    const encoding = await compileDeclarationProject(project(), {
      ...options(),
      encodeLimits: { ...PNG_ABSOLUTE_LIMITS, maxWidth: 1 },
    });
    expect(encoding.valid).toBe(false);
    if (!encoding.valid) {
      expect(encoding.diagnostics.map((item) => item.code)).toContain("encode-limit-exceeded");
    }
  });

  it("does not invoke renderers from the check-only API", () => {
    let calls = 0;
    const unused = {
      ...renderer,
      build: (input: Parameters<RendererPlugin["build"]>[0]) => {
        calls++;
        return renderer.build(input);
      },
    };
    expect(checkDeclarationProject(project()).valid).toBe(true);
    expect(calls).toBe(0);
    expect(unused).toBeDefined();
  });
});
