import { describe, expect, expectTypeOf, it } from "vitest";
import {
  action,
  after,
  assetRef,
  booleanProp,
  componentOutput,
  componentInstance,
  cue,
  defineComponentManifest,
  defineComponentStructure,
  definePresentation,
  defineTheme,
  detach,
  frame,
  invokeComponentAction,
  namedStyleRef,
  numberProp,
  output,
  part,
  playTimeline,
  semanticOverride,
  setSurfaceState,
  slot,
  spatial,
  state,
  stringProp,
  surface,
  surfaceState,
  text,
  timelineCompleted,
  tokenRef,
  variant,
} from "../src/index.js";

const absolute = { kind: "absolute" as const, x: 0, y: 0, width: 1920, height: 1080 };
const title = text({ id: "text-title", value: "Hello", layout: absolute });
const root = frame({ id: "frame-root", layout: absolute, children: [title] });
const defaultState = {
  id: "state-default",
  semanticOverrides: [],
  enabledInteractionIds: [],
} as const;
const titleSurface = surface({
  id: "surface-title",
  physicalSizeMeters: [1.6, 0.9],
  logicalSize: [1920, 1080],
  fit: "contain",
  root,
  baseSemanticTree: {
    rootNodeIds: ["semantic-title"],
    nodes: {
      "semantic-title": {
        id: "semantic-title",
        parentId: null,
        order: 0,
        role: "heading",
        text: "Hello",
      },
    },
  },
  interactions: {},
  initialStateId: defaultState.id,
  states: { [defaultState.id]: defaultState },
  renderIntent: {
    updateModel: "static",
    interaction: "none",
    internalAnimation: "none",
    rendererPreference: "baked-web",
    fallbackPolicy: "reject",
  },
});
const surfaceNode = spatial({
  id: "surface-node-title",
  name: "Title surface",
  owner: { kind: "presentation" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  order: 0,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  active: true,
  visible: true,
  opacity: 1,
});

const surfaceManifest = defineComponentManifest({
  componentId: "@unframe/components/Surface",
  version: 1,
  authoring: { mode: "structured", structure: "./Surface.structure.ts" },
  props: {
    width: numberProp({ required: true }),
    height: numberProp({ required: true }),
  },
  slots: { content: slot({ accepts: ["frame", "text"], cardinality: "many" }) },
  parts: { root: part({ overridable: ["placement", "style"] }) },
  variants: { fit: variant({ values: ["contain", "cover", "stretch"], default: "contain" }) },
  states: { hidden: state(), shown: state({ initial: true }) },
  actions: {
    show: action({
      inputs: {},
      preconditions: [surfaceState("root", "hidden")],
      effects: [
        setSurfaceState("root", "shown"),
        playTimeline("reveal", { completion: "blocking" }),
      ],
    }),
  },
  outputs: {
    completed: output({
      payload: { reason: { type: "string", value: "timeline" } },
      producer: timelineCompleted("reveal"),
    }),
  },
  renderers: ["baked-web"],
});
const surfaceStructure = defineComponentStructure({
  id: "surface-structure",
  componentId: surfaceManifest.componentId,
  root: titleSurface,
  partBindings: { root: titleSurface.id },
  slotPlacements: { content: root.id },
  timelines: [{ id: "reveal" }],
});
const titleInstance = componentInstance({
  id: "title-component",
  componentId: surfaceManifest.componentId,
  version: 1,
  packageLock: {
    packageVersion: "1.0.0",
    packageIntegrity: "sha256-package",
    manifestHash: "sha256-manifest",
    structureHash: "sha256-structure",
  },
  owner: { kind: "presentation" },
  spatialNodeId: surfaceNode.id,
  props: { width: 1920, height: 1080, logo: assetRef({ assetId: "logo" }) },
  slots: { content: [title.id] },
  variants: { fit: "contain" },
  partOverrides: [{ partId: "root", style: { opacity: 1 } }],
});

const referencePresentation = {
  id: "presentation-intro",
  source: { file: "presentation.unframe.tsx", range: [0, 42] as const },
  metadata: { title: "Intro" },
  stage: {
    coordinateSystem: {
      unit: "meter" as const,
      handedness: "right" as const,
      upAxis: "+Y" as const,
      forwardAxis: "-Z" as const,
    },
    size: [4, 3, 2] as const,
  },
  scene: { spatial: [surfaceNode], components: [titleInstance] },
  assets: [assetRef({ assetId: "logo" })],
  flow: {
    initialGroupId: "group-intro",
    groups: {
      "group-intro": {
        id: "group-intro",
        initialStepId: "step-intro",
        steps: { "step-intro": { id: "step-intro", cues: [] } },
      },
    },
    variables: {
      "optional-subtitle": {
        id: "optional-subtitle",
        owner: { kind: "presentation" as const },
        type: "null" as const,
        initialValue: null,
      },
    },
  },
  operations: [],
} as const;

describe("reference authoring project", () => {
  it("carries every source field needed by the canonical first-milestone fixture", () => {
    const presentation = definePresentation(referencePresentation);

    expect(presentation).toBe(referencePresentation);
    expect(presentation.stage.size).toEqual([4, 3, 2]);
    expect(presentation.scene.spatial[0]?.id).toBe("surface-node-title");
    expect(presentation.scene.components[0]?.componentId).toBe("@unframe/components/Surface");
    expect(presentation.flow.groups["group-intro"]?.steps["step-intro"]?.cues).toEqual([]);
    expect(surfaceStructure.root.baseSemanticTree.nodes["semantic-title"]?.role).toBe("heading");
    expect(surfaceStructure.root.initialStateId).toBe("state-default");
    expectTypeOf(presentation.id).toEqualTypeOf<"presentation-intro">();
    expect(JSON.parse(JSON.stringify({ presentation, surfaceManifest, surfaceStructure }))).toEqual(
      {
        presentation,
        surfaceManifest,
        surfaceStructure,
      },
    );
  });

  it("keeps source correlation optional and does not mutate identity declarations", () => {
    const presentation = definePresentation(referencePresentation);
    expect(presentation.source.file).toBe("presentation.unframe.tsx");
    expect(presentation).toBe(referencePresentation);
  });
});

describe("component contract", () => {
  it("represents structured Manifest actions, outputs, Parts, Slots, and local semantics", () => {
    expect(surfaceManifest.actions.show.effects).toEqual([
      { kind: "setSurfaceState", surfaceId: "root", stateId: "shown" },
      { kind: "playTimeline", timelineId: "reveal", completion: "blocking" },
    ]);
    expect(surfaceManifest.outputs.completed.producer).toEqual({
      kind: "timelineCompleted",
      timelineId: "reveal",
    });
    expect(surfaceStructure.partBindings.root).toBe("surface-title");
    expect(surfaceStructure.timelines[0]?.id).toBe("reveal");
  });

  it("represents Opaque renderer entries only through declared binding keys and semantics", () => {
    const manifest = defineComponentManifest({
      componentId: "@example/opaque-chart",
      version: 1,
      authoring: { mode: "opaque" },
      props: { interactive: booleanProp({ default: false }) },
      slots: {},
      parts: {},
      variants: {},
      states: {},
      actions: {},
      outputs: { refresh: output({ payload: {}, producer: after(1000) }) },
      renderers: {
        "baked-web": { entry: "./Chart.web.tsx", bindingKeys: ["chart-root"] },
      },
      semantics: {
        targets: [],
        surfaces: [
          {
            id: "root",
            bindingKey: "chart-root",
            baseSemanticTree: titleSurface.baseSemanticTree,
            interactions: titleSurface.interactions,
            initialStateId: titleSurface.initialStateId,
            states: titleSurface.states,
          },
        ],
      },
    });

    expect(manifest.authoring.mode).toBe("opaque");
    expect(manifest.semantics.surfaces[0]?.bindingKey).toBe("chart-root");
  });

  it("carries owner, package lock, variants, slots, and bounded Part overrides on instances", () => {
    expect(titleInstance.owner).toEqual({ kind: "presentation" });
    expect(titleInstance.packageLock.structureHash).toBe("sha256-structure");
    expect(titleInstance.partOverrides).toEqual([{ partId: "root", style: { opacity: 1 } }]);
  });

  it("limits semantic overrides and detach to explicit structured operations", () => {
    const changed = semanticOverride({
      id: "rename-title",
      targetId: "semantic-title",
      text: "Welcome",
      included: true,
    });
    const detached = detach({
      id: "detach-title",
      mode: "structured",
      instanceId: titleInstance.id,
      provenance: { componentId: surfaceManifest.componentId, version: 1 },
    });

    expect(changed).toEqual({
      kind: "semantic-override",
      id: "rename-title",
      targetId: "semantic-title",
      text: "Welcome",
      included: true,
    });
    expect(detached.mode).toBe("structured");
  });

  it("connects Component Outputs and typed Action invocations to Flow cues", () => {
    const completed = componentOutput({
      componentInstanceId: titleInstance.id,
      outputId: "completed",
    });
    const show = invokeComponentAction({
      componentInstanceId: titleInstance.id,
      actionId: "show",
      arguments: {},
    });
    const transition = cue({
      id: "show-after-complete",
      trigger: completed,
      actions: [show],
      toStepId: "step-shown",
    });

    expect(transition.trigger.kind).toBe("component.output");
    expect(transition.actions[0]?.kind).toBe("component.action");
  });

  it("uses null semantic override fields to remove inherited values", () => {
    expect(
      semanticOverride({
        id: "remove-alt",
        targetId: "semantic-title",
        alt: null,
        language: null,
      }),
    ).toMatchObject({ alt: null, language: null });
  });
});

describe("theme and reference vocabulary", () => {
  it("creates typed Theme, Prop, State, and reference declarations", () => {
    const theme = defineTheme({
      id: "default-theme",
      tokens: { accent: "#ff00ff", spacing: 8 },
      namedStyles: { heading: { color: "#ff00ff", fontSize: 64 } },
    });

    expect(theme.tokens.accent).toBe("#ff00ff");
    expect(stringProp({ required: true })).toEqual({ kind: "string", required: true });
    expect(tokenRef({ tokenId: "accent" })).toEqual({ kind: "token-ref", tokenId: "accent" });
    expect(namedStyleRef({ styleId: "heading" })).toEqual({
      kind: "named-style-ref",
      styleId: "heading",
    });
  });

  it("does not mutate builder inputs or retain registry state", () => {
    const input = { id: "copy", value: "Copy", layout: absolute } as const;
    const first = text(input);
    const second = text(input);

    expect(input).toEqual({ id: "copy", value: "Copy", layout: absolute });
    expect(first).not.toBe(input);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("preserves unresolved cross-declaration references for Compiler validation", () => {
    const unresolved = defineComponentStructure({
      id: "unresolved-structure",
      componentId: "@example/missing-manifest",
      root,
      partBindings: { missingPart: "missing-node" },
      slotPlacements: { missingSlot: "missing-node" },
      timelines: [],
    });

    expect(unresolved.partBindings.missingPart).toBe("missing-node");
    expect(tokenRef({ tokenId: "missing-token" }).tokenId).toBe("missing-token");
  });
});

describe("local declaration boundary", () => {
  it.each([
    ["function", () => undefined],
    ["undefined", undefined],
    ["bigint", 1n],
    ["symbol", Symbol("value")],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["Date", new Date(0)],
  ])("rejects non-JSON %s values", (_label, invalid) => {
    expect(() =>
      defineTheme({ id: "theme", tokens: { invalid }, namedStyles: {} } as never),
    ).toThrow(TypeError);
  });

  it("rejects empty references, invalid source ranges, and invalid local geometry", () => {
    expect(() => assetRef({ assetId: "" })).toThrow(/assetId/);
    expect(() =>
      defineTheme({
        id: "theme",
        source: { file: "theme.ts", range: [2, 1] },
        tokens: {},
        namedStyles: {},
      }),
    ).toThrow(/source.range/);
    expect(() => text({ id: "bad", value: "bad", layout: { ...absolute, width: 0 } })).toThrow(
      /layout size/,
    );
    expect(() =>
      spatial({
        ...surfaceNode,
        id: "bad-scale",
        transform: { ...surfaceNode.transform, scale: [1, 0, 1] },
      }),
    ).toThrow(/transform.scale/);
    expect(() => action({ inputs: {}, preconditions: [], effects: [] })).toThrow(
      /at least one effect/,
    );
    expect(() =>
      spatial({
        ...surfaceNode,
        id: "bad-position",
        transform: { ...surfaceNode.transform, position: [0, 0] as never },
      }),
    ).toThrow(/exactly 3/);
  });

  it("rejects nested empty ids and interactions in the non-interactive milestone", () => {
    expect(() =>
      defineComponentStructure({
        id: "bad-structure",
        componentId: surfaceManifest.componentId,
        root,
        partBindings: {},
        slotPlacements: {},
        timelines: [{ id: "" }],
      }),
    ).toThrow(/timeline id/);
    expect(() =>
      surface({
        ...titleSurface,
        id: "interactive-surface",
        interactions: {
          click: { id: "click", kind: "click", event: "clicked" },
        },
      } as never),
    ).toThrow(/non-interactive Surface/);
    expect(() =>
      surface({
        ...titleSurface,
        id: "semantic-interaction-surface",
        baseSemanticTree: {
          ...titleSurface.baseSemanticTree,
          nodes: {
            "semantic-title": {
              ...titleSurface.baseSemanticTree.nodes["semantic-title"],
              interactionId: "undeclared-click",
            },
          },
        },
      } as never),
    ).toThrow(/semantic interactionId/);
  });

  it("rejects cycles, sparse arrays, and accessor properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => defineTheme({ id: "theme", tokens: cyclic, namedStyles: {} } as never)).toThrow(
      /cycles/,
    );

    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(() =>
      defineTheme({ id: "theme", tokens: { sparse }, namedStyles: {} } as never),
    ).toThrow(/sparse arrays/);

    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => "hidden" });
    expect(() => defineTheme({ id: "theme", tokens: accessor, namedStyles: {} } as never)).toThrow(
      /data properties/,
    );
  });

  it("rejects builder accessors before execution and invalid action completion enums", () => {
    let reads = 0;
    const reference = {} as { assetId: string };
    Object.defineProperty(reference, "assetId", {
      enumerable: true,
      get() {
        reads++;
        return "logo";
      },
    });

    expect(() => assetRef(reference)).toThrow(/data properties/);
    expect(reads).toBe(0);
    expect(() => playTimeline("reveal", { completion: "eventually" } as never)).toThrow(
      /completion/,
    );
    expect(() => stringProp({ default: 1 } as never)).toThrow(/string prop/);
    expect(() => slot({ accepts: ["frame"], cardinality: "optional" } as never)).toThrow(
      /slot declaration/,
    );
  });
});

const typeContractChecks = () => {
  // @ts-expect-error component manifests use componentId as their stable public identity
  defineComponentManifest({ id: "legacy" });
  // @ts-expect-error string prop defaults must be strings
  stringProp({ default: 1 });
  // @ts-expect-error slot cardinality is explicit and closed
  slot({ accepts: [], cardinality: "optional" });
  // @ts-expect-error semantic overrides cannot alter topology or roles
  semanticOverride({ id: "bad", targetId: "node", parentId: "other" });
  // @ts-expect-error a Surface is a Structure root and cannot be nested inside Frame content
  frame({ id: "bad-frame", layout: absolute, children: [titleSurface] });
  surface({
    ...titleSurface,
    // @ts-expect-error the initial milestone cannot declare Surface interactions
    interactions: { click: { id: "click", kind: "click", event: "clicked" } },
  });
  // @ts-expect-error output payload types and fixed scalar values must agree
  output({ payload: { count: { type: "number", value: "one" } }, producer: after(1) });
  // @ts-expect-error opaque manifests must declare semantic bindings
  defineComponentManifest({
    componentId: "@example/opaque",
    version: 1,
    authoring: { mode: "opaque" },
    props: {},
    slots: {},
    parts: {},
    variants: {},
    states: {},
    actions: {},
    outputs: {},
    renderers: {},
  });
};

expectTypeOf(typeContractChecks).toBeFunction();
