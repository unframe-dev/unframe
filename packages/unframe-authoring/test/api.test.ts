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
  isComponentManifest,
  isComponentStructure,
  isPresentationDeclaration,
  isThemeDeclaration,
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
  validateStaticBuilderResult,
  variant,
} from "../src/index.js";

const absolute = { height: 1080, kind: "absolute" as const, width: 1920, x: 0, y: 0 };
const title = text({ id: "text-title", layout: absolute, maxCodePoints: 64, value: "Hello" });
const root = frame({ children: [title], id: "frame-root", layout: absolute });
const defaultState = {
  enabledInteractionIds: [],
  id: "state-default",
  semanticOverrides: [],
} as const;
const titleSurface = surface({
  baseSemanticTree: {
    nodes: {
      "semantic-title": {
        id: "semantic-title",
        level: 1,
        order: 0,
        parentId: null,
        role: "heading",
        text: "Hello",
      },
    },
    rootNodeIds: ["semantic-title"],
  },
  fit: "contain",
  id: "surface-title",
  initialStateId: defaultState.id,
  interactions: {},
  logicalSize: [1920, 1080],
  physicalSizeMeters: [1.6, 0.9],
  renderIntent: {
    fallbackPolicy: "reject",
    interaction: "none",
    internalAnimation: "none",
    rendererPreference: "baked-web",
    updateModel: "static",
  },
  root,
  states: { [defaultState.id]: defaultState },
});
const surfaceNode = spatial({
  active: true,
  audience: { kind: "all" },
  id: "surface-node-title",
  name: "Title surface",
  opacity: 1,
  order: 0,
  owner: { kind: "presentation" },
  parent: { kind: "stage" },
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  visible: true,
});

const surfaceManifest = defineComponentManifest({
  actions: {
    show: action({
      effects: [
        setSurfaceState("root", "shown"),
        playTimeline("reveal", { completion: "blocking" }),
      ],
      inputs: {},
      preconditions: [surfaceState("root", "hidden")],
    }),
  },
  authoring: { mode: "structured", structure: "./Surface.structure.ts" },
  componentId: "@unframe/components/Surface",
  outputs: {
    completed: output({
      payload: { reason: { type: "string", value: "timeline" } },
      producer: timelineCompleted("reveal"),
    }),
  },
  parts: { root: part({}) },
  props: {
    height: numberProp({ required: true }),
    width: numberProp({ required: true }),
  },
  renderers: ["baked-web"],
  slots: { content: slot({}) },
  states: { hidden: state(), shown: state({ initial: true }) },
  variants: { fit: variant({ default: "contain", values: ["contain", "cover", "stretch"] }) },
  version: 1,
});
const surfaceStructure = defineComponentStructure({
  componentId: surfaceManifest.componentId,
  id: "surface-structure",
  partBindings: { root: titleSurface.id },
  root: titleSurface,
  timelines: [
    {
      durationMilliseconds: 100,
      id: "reveal",
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
  variantStyles: {},
});
const titleInstance = componentInstance({
  componentId: surfaceManifest.componentId,
  id: "title-component",
  owner: { kind: "presentation" },
  partOverrides: [
    {
      partId: "root",
      style: { backgroundColor: { alpha: 1, blue: 1, green: 1, red: 1 } },
      targetKind: "frame",
    },
  ],
  props: { height: 1080, logo: "logo", width: 1920 },
  slots: { content: [title.id] },
  spatialNodeId: surfaceNode.id,
  variants: { fit: "contain" },
  version: 1,
});

const referencePresentation = {
  assets: [assetRef({ assetId: "logo" })],
  flow: {
    groups: {
      "group-intro": {
        id: "group-intro",
        initialStepId: "step-intro",
        steps: { "step-intro": { cues: [], id: "step-intro" } },
      },
    },
    initialGroupId: "group-intro",
    variables: {
      "optional-subtitle": {
        id: "optional-subtitle",
        initialValue: null,
        owner: { kind: "presentation" as const },
        type: "null" as const,
      },
    },
  },
  id: "presentation-intro",
  metadata: { title: "Intro" },
  operations: [],
  scene: { components: [titleInstance], spatial: [surfaceNode] },
  source: { file: "presentation.unframe.tsx", range: [0, 42] as const },
  stage: {
    coordinateSystem: {
      forwardAxis: "-Z" as const,
      handedness: "right" as const,
      unit: "meter" as const,
      upAxis: "+Y" as const,
    },
    size: [4, 3, 2] as const,
  },
} as const;

describe("reference authoring project", () => {
  it("carries every source field needed by the canonical first-milestone fixture", () => {
    const presentation = definePresentation(referencePresentation);

    expect(presentation).toBe(referencePresentation);
    expect(presentation.stage.size).toEqual([4, 3, 2]);
    expect(presentation.scene.spatial[0]?.id).toBe("surface-node-title");
    expect(presentation.scene.components[0]?.componentId).toBe("@unframe/components/Surface");
    expect(presentation.flow.groups["group-intro"]?.steps["step-intro"]?.cues).toEqual([]);
    expect(titleSurface.baseSemanticTree.nodes["semantic-title"]?.role).toBe("heading");
    expect(titleSurface.initialStateId).toBe("state-default");
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
  it("validates a blocking Surface crossfade effect", () => {
    const transition = {
      completion: "blocking" as const,
      durationMilliseconds: 200,
      easing: "linear" as const,
      kind: "crossfade" as const,
    };
    expect(setSurfaceState("root", "shown", transition)).toEqual({
      kind: "setSurfaceState",
      stateId: "shown",
      surfaceId: "root",
      transition,
    });
    expect(() =>
      setSurfaceState("root", "shown", { ...transition, durationMilliseconds: 0 }),
    ).toThrow();
  });
  it("represents structured Manifest actions, outputs, Parts, Slots, and local semantics", () => {
    expect(surfaceManifest.actions.show.effects).toEqual([
      { kind: "setSurfaceState", stateId: "shown", surfaceId: "root" },
      { completion: "blocking", kind: "playTimeline", timelineId: "reveal" },
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
      actions: {},
      authoring: { mode: "opaque" },
      componentId: "@example/opaque-chart",
      outputs: { refresh: output({ payload: {}, producer: after(1000) }) },
      parts: {},
      props: { interactive: booleanProp({ default: false }) },
      renderers: {
        "baked-web": { bindingKeys: ["chart-root"], entry: "./Chart.web.tsx" },
      },
      semantics: {
        surfaces: [
          {
            baseSemanticTree: titleSurface.baseSemanticTree,
            bindingKey: "chart-root",
            id: "root",
            initialStateId: titleSurface.initialStateId,
            interactions: titleSurface.interactions,
            states: titleSurface.states,
          },
        ],
        targets: [],
      },
      slots: {},
      states: {},
      variants: {},
      version: 1,
    });

    expect(manifest.authoring.mode).toBe("opaque");
    expect(manifest.semantics.surfaces[0]?.bindingKey).toBe("chart-root");
  });

  it("carries owner, variants, slots, and bounded Part overrides on instances", () => {
    expect(titleInstance.owner).toEqual({ kind: "presentation" });
    expect(titleInstance.partOverrides[0]?.targetKind).toBe("frame");
  });

  it("limits semantic overrides and detach to explicit structured operations", () => {
    const changed = semanticOverride({
      id: "rename-title",
      included: true,
      targetId: "semantic-title",
      text: "Welcome",
    });
    const detached = detach({
      id: "detach-title",
      instanceId: titleInstance.id,
      mode: "structured",
      provenance: { componentId: surfaceManifest.componentId, version: 1 },
    });

    expect(changed).toEqual({
      id: "rename-title",
      included: true,
      kind: "semantic-override",
      targetId: "semantic-title",
      text: "Welcome",
    });
    expect(detached.mode).toBe("structured");
  });

  it("connects Component Outputs and typed Action invocations to Flow cues", () => {
    const completed = componentOutput({
      componentInstanceId: titleInstance.id,
      outputId: "completed",
    });
    const show = invokeComponentAction({
      actionId: "show",
      arguments: {},
      componentInstanceId: titleInstance.id,
    });
    const transition = cue({
      actions: [show],
      id: "show-after-complete",
      toStepId: "step-shown",
      trigger: completed,
    });

    expect(transition.trigger.kind).toBe("component.output");
    expect(transition.actions[0]?.kind).toBe("component.action");
  });

  it("accepts canonical cue controls and rejects conflicting transitions", () => {
    const value = cue({
      actions: [],
      firePolicy: { cooldownMilliseconds: 100, kind: "repeatable" },
      guard: {
        kind: "compare",
        left: { field: "accepted", kind: "eventPayload" },
        operator: "eq",
        right: true,
      },
      id: "advance",
      next: { kind: "step", stepId: "done" },
      order: 1,
      priority: 2,
      trigger: { event: "advance", kind: "event" },
    });
    expect(value.next).toEqual({ kind: "step", stepId: "done" });
    expect(() => cue({ ...value, toStepId: "other" })).toThrow(/Invalid cue declaration/);
  });

  it("uses null semantic override fields to remove inherited values", () => {
    expect(
      semanticOverride({
        alt: null,
        id: "remove-alt",
        language: null,
        targetId: "semantic-title",
      }),
    ).toMatchObject({ alt: null, language: null });
  });
});

describe("theme and reference vocabulary", () => {
  it("creates typed Theme, Prop, State, and reference declarations", () => {
    const theme = defineTheme({
      id: "default-theme",
      namedStyles: {
        heading: {
          kind: "text",
          style: { color: tokenRef({ category: "color", tokenId: "accent" }), fontSize: 64 },
        },
      },
      tokens: {
        accent: { category: "color", value: { alpha: 1, blue: 1, green: 0, red: 1 } },
        spacing: { category: "logicalLength", value: 8 },
      },
    });

    expect(theme.tokens.accent.category).toBe("color");
    expect(stringProp({ required: true })).toEqual({ kind: "string", required: true });
    expect(tokenRef({ category: "color", tokenId: "accent" })).toEqual({
      category: "color",
      kind: "token-ref",
      tokenId: "accent",
    });
    expect(namedStyleRef({ styleId: "heading" })).toEqual({
      kind: "named-style-ref",
      styleId: "heading",
    });
  });

  it("does not mutate builder inputs or retain registry state", () => {
    const input = { id: "copy", layout: absolute, maxCodePoints: 64, value: "Copy" } as const;
    const first = text(input);
    const second = text(input);

    expect(input).toEqual({ id: "copy", layout: absolute, maxCodePoints: 64, value: "Copy" });
    expect(first).not.toBe(input);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("preserves unresolved cross-declaration references for Compiler validation", () => {
    const unresolved = defineComponentStructure({
      baseSemanticTree: { nodes: {}, rootNodeIds: [] },
      componentId: "@example/missing-manifest",
      id: "unresolved-structure",
      partBindings: { missingPart: "missing-node" },
      root,
      timelines: [],
      variantStyles: {},
    });

    expect(unresolved.partBindings.missingPart).toBe("missing-node");
    expect(tokenRef({ category: "color", tokenId: "missing-token" }).tokenId).toBe("missing-token");
  });

  it("accepts concrete v2 primitive inputs without resolving Named Styles", () => {
    const styledText = text({
      id: "styled-text",
      layout: absolute,
      maxCodePoints: 64,
      namedStyle: namedStyleRef({ styleId: "heading" }),
      opacity: 0.5,
      semanticNodeId: "semantic-styled-text",
      style: {
        align: "start",
        color: { alpha: 1, blue: 0, green: 0, red: 0 },
        fallbackFonts: [],
        font: assetRef({ assetId: "reference-font" }),
        fontSize: 32,
        lineHeight: 40,
        overflow: "clip",
        weight: "regular",
      },
      value: "Unframe",
      visible: false,
    });
    const styledFrame = frame({
      children: [styledText],
      id: "styled-frame",
      layout: absolute,
      opacity: 1,
      semanticNodeId: "semantic-frame",
      style: {
        backgroundColor: { alpha: 1, blue: 1, green: 1, red: 1 },
        border: {
          color: { alpha: 1, blue: 0, green: 0, red: 0 },
          radius: 4,
          width: 1,
        },
        clip: true,
      },
      visible: true,
    });

    expect(styledText.style.font?.kind).toBe("asset-ref");
    expect(styledText.namedStyle?.styleId).toBe("heading");
    expect(styledFrame.style?.clip).toBe(true);
  });

  it("accepts v2 semantic role fields on Surface semantic nodes", () => {
    expect(() =>
      surface({
        ...titleSurface,
        baseSemanticTree: {
          nodes: {
            heading: {
              id: "heading",
              level: 1,
              order: 0,
              parentId: null,
              role: "heading",
              text: "Unframe",
            },
          },
          rootNodeIds: ["heading"],
        },
        id: "heading-surface",
      }),
    ).not.toThrow();
  });

  it("rejects invalid concrete primitive limits at the authoring boundary", () => {
    expect(() =>
      text({ id: "bad-limit", layout: absolute, maxCodePoints: 0, value: "Unframe" }),
    ).toThrow(/text declaration/);
    expect(() =>
      text({
        id: "bad-font-size",
        layout: absolute,
        maxCodePoints: 64,
        style: { fontSize: 0 },
        value: "Unframe",
      }),
    ).toThrow(/text declaration/);
    expect(() => frame({ children: [], id: "bad-opacity", layout: absolute, opacity: 2 })).toThrow(
      /frame declaration/,
    );
  });
});

describe("local declaration boundary", () => {
  it("keeps Presentation flow validation aligned across builder, guard, and static results", () => {
    const invalidFlow = {
      ...referencePresentation,
      flow: { ...referencePresentation.flow, initialGroupId: "" },
    };
    const invalidShape = { ...referencePresentation, unexpected: true };

    expect(isPresentationDeclaration(referencePresentation)).toBe(true);
    expect(validateStaticBuilderResult("definePresentation", referencePresentation)).toBe(true);
    expect(() => definePresentation(invalidFlow)).toThrow(
      "flow.initialGroupId must be a non-empty id.",
    );
    expect(isPresentationDeclaration(invalidFlow)).toBe(false);
    expect(validateStaticBuilderResult("definePresentation", invalidFlow)).toBe(false);
    expect(() => definePresentation(invalidShape as never)).toThrow(
      "Invalid Presentation declaration.",
    );
    expect(validateStaticBuilderResult("definePresentation", invalidShape)).toBe(false);
  });

  it("exposes non-mutating declaration guards with builder-equivalent acceptance", () => {
    const theme = {
      id: "default-theme",
      namedStyles: {},
      tokens: {
        accent: { category: "color" as const, value: { alpha: 1, blue: 1, green: 0, red: 1 } },
      },
    };
    const before = JSON.stringify({
      referencePresentation,
      surfaceManifest,
      surfaceStructure,
      theme,
    });

    expect(isPresentationDeclaration(referencePresentation)).toBe(true);
    expect(isComponentManifest(surfaceManifest)).toBe(true);
    expect(isComponentStructure(surfaceStructure)).toBe(true);
    expect(isThemeDeclaration(theme)).toBe(true);
    expect(() => definePresentation(referencePresentation)).not.toThrow();
    expect(() => defineComponentManifest(surfaceManifest)).not.toThrow();
    expect(() => defineComponentStructure(surfaceStructure)).not.toThrow();
    expect(() => defineTheme(theme)).not.toThrow();
    expect(isThemeDeclaration({})).toBe(false);
    expect(() => defineTheme({} as never)).toThrow(TypeError);
    expect(
      JSON.stringify({ referencePresentation, surfaceManifest, surfaceStructure, theme }),
    ).toBe(before);
  });

  it("returns false without evaluating malformed declaration accessors", () => {
    let reads = 0;
    const accessor = Object.defineProperty({ id: "theme", namedStyles: {}, tokens: {} }, "tokens", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    const cyclic: Record<string, unknown> = { id: "theme", namedStyles: {}, tokens: {} };
    cyclic.self = cyclic;

    expect(isThemeDeclaration(accessor)).toBe(false);
    expect(reads).toBe(0);
    expect(isThemeDeclaration(cyclic)).toBe(false);
    expect(
      isThemeDeclaration({
        id: "theme",
        namedStyles: {},
        tokens: { invalid: Number.POSITIVE_INFINITY },
      }),
    ).toBe(false);
  });

  it("accepts descriptor-backed Proxy declarations without reading caller values", () => {
    let reads = 0;
    const proxy = <T extends object>(value: T): T =>
      new Proxy(value, {
        get() {
          reads++;
          throw new Error("must not read caller data");
        },
      });

    expect(() => stringProp(proxy({ required: true }))).not.toThrow();
    expect(() => assetRef(proxy({ assetId: "logo" }))).not.toThrow();
    expect(() => semanticOverride(proxy({ id: "override", targetId: "target" }))).not.toThrow();
    expect(() =>
      cue(proxy({ actions: [], id: "cue", trigger: { event: "ready", kind: "event" } })),
    ).not.toThrow();
    expect(isThemeDeclaration(proxy({ id: "theme", namedStyles: {}, tokens: {} }))).toBe(true);
    expect(reads).toBe(0);
  });

  it("does not read length through a nested Array Proxy", () => {
    let reads = 0;
    const values = new Proxy(["primary"], {
      get() {
        reads++;
        throw new Error("must not read array length");
      },
    });

    expect(() => variant({ default: "primary", values })).not.toThrow();
    expect(reads).toBe(0);
  });

  it("does not inherit Object.prototype accessors during validation", () => {
    let reads = 0;
    Object.defineProperty(Object.prototype, "required", {
      configurable: true,
      get() {
        reads++;
        throw new Error("must not inherit caller data");
      },
    });

    try {
      expect(() => slot({})).not.toThrow();
      expect(isThemeDeclaration({ id: "theme", namedStyles: {}, tokens: {} })).toBe(true);
      expect(reads).toBe(0);
    } finally {
      delete (Object.prototype as { required?: unknown }).required;
    }
  });

  it("accepts normalized null-prototype declarations", () => {
    const theme = Object.assign(Object.create(null), {
      id: "theme",
      namedStyles: Object.create(null),
      tokens: Object.assign(Object.create(null), {
        accent: { category: "color", value: { alpha: 1, blue: 1, green: 0, red: 1 } },
      }),
    });

    expect(isThemeDeclaration(theme)).toBe(true);
  });

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
      defineTheme({ id: "theme", namedStyles: {}, tokens: { invalid } } as never),
    ).toThrow(TypeError);
  });

  it("rejects empty references, invalid source ranges, and invalid local geometry", () => {
    expect(() => assetRef({ assetId: "" })).toThrow(/assetId/);
    expect(() =>
      defineTheme({
        id: "theme",
        namedStyles: {},
        source: { file: "theme.ts", range: [2, 1] },
        tokens: {},
      }),
    ).toThrow(/source.range/);
    expect(() =>
      text({ id: "bad", layout: { ...absolute, width: 0 }, maxCodePoints: 64, value: "bad" }),
    ).toThrow(/layout size/);
    expect(() =>
      spatial({
        ...surfaceNode,
        id: "bad-scale",
        transform: { ...surfaceNode.transform, scale: [1, 0, 1] },
      }),
    ).toThrow(/transform.scale/);
    expect(() => action({ effects: [], inputs: {}, preconditions: [] })).toThrow(
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

  it("rejects nested empty ids and malformed interactions", () => {
    expect(() =>
      defineComponentStructure({
        baseSemanticTree: { nodes: {}, rootNodeIds: [] },
        componentId: surfaceManifest.componentId,
        id: "bad-structure",
        partBindings: {},
        root,
        timelines: [
          {
            durationMilliseconds: 100,
            id: "",
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
        variantStyles: {},
      }),
    ).toThrow(/timeline id/);
    expect(() =>
      surface({
        ...titleSurface,
        id: "interactive-surface",
        interactions: {
          click: { event: "clicked", id: "click", kind: "click" },
        },
      } as never),
    ).toThrow(/Invalid Surface declaration/);
    expect(() =>
      surface({
        ...titleSurface,
        baseSemanticTree: {
          ...titleSurface.baseSemanticTree,
          nodes: {
            "semantic-title": {
              ...titleSurface.baseSemanticTree.nodes["semantic-title"],
              interactionId: "undeclared-click",
            },
          },
        },
        id: "semantic-interaction-surface",
      } as never),
    ).toThrow(/Invalid Surface declaration/);
  });

  it("rejects cycles, sparse arrays, and accessor properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => defineTheme({ id: "theme", namedStyles: {}, tokens: cyclic } as never)).toThrow(
      /cycles/,
    );

    const sparse: Array<unknown> = [];
    sparse.length = 2;
    expect(() =>
      defineTheme({ id: "theme", namedStyles: {}, tokens: { sparse } } as never),
    ).toThrow(/sparse arrays/);

    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => "hidden" });
    expect(() => defineTheme({ id: "theme", namedStyles: {}, tokens: accessor } as never)).toThrow(
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
    expect(() => slot({ accepts: ["frame"], cardinality: "many" } as never)).toThrow(
      /slot declaration/,
    );
  });

  it("enforces the same Prop, Slot, Part, and Variant contract at builders and Manifest guards", () => {
    expect(() => stringProp({ default: "fallback", required: true } as never)).toThrow(
      /string prop/,
    );
    expect(() => numberProp({} as never)).toThrow(/number prop/);
    expect(() => booleanProp({ required: false } as never)).toThrow(/boolean prop/);
    expect(() => slot({})).not.toThrow();
    expect(() => slot({ accepts: ["frame"], cardinality: "many" } as never)).toThrow(
      /slot declaration/,
    );
    expect(() => part({})).not.toThrow();
    expect(() => part({ overridable: ["style"] } as never)).toThrow(/part declaration/);
    expect(() => variant({ default: "secondary", values: ["primary"] })).toThrow(
      /variant declaration/,
    );

    expect(
      isComponentManifest({
        ...surfaceManifest,
        parts: { root: { kind: "part", overridable: ["style"] } },
        props: { title: { default: 1, kind: "string" } },
        slots: { content: { accepts: ["frame"], cardinality: "many", kind: "slot" } },
        variants: { tone: { default: "secondary", kind: "variant", values: ["primary"] } },
      }),
    ).toBe(false);
  });

  it("rejects malformed Theme style records and Structure nodes through public guards", () => {
    expect(isThemeDeclaration({ id: "theme", namedStyles: { heading: "bold" }, tokens: {} })).toBe(
      false,
    );
    expect(
      isComponentStructure({
        ...surfaceStructure,
        root: {
          children: [{ id: "title", kind: "text", layout: absolute, maxCodePoints: 64, value: 42 }],
          id: "root",
          kind: "frame",
          layout: absolute,
        },
      }),
    ).toBe(false);
    expect(() =>
      text({ id: "title", layout: absolute, maxCodePoints: 64, value: 42 } as never),
    ).toThrow(/text declaration/);
  });

  it("rejects Presentation members that do not match their public declaration types", () => {
    expect(
      isPresentationDeclaration({
        ...referencePresentation,
        metadata: { title: 42 },
        scene: {
          ...referencePresentation.scene,
          spatial: [{ ...surfaceNode, kind: "frame" }],
        },
      }),
    ).toBe(false);
  });

  it("rejects an empty Presentation title through the builder and public guard", () => {
    const emptyTitle = { ...referencePresentation, metadata: { title: "" } };

    expect(() => definePresentation(emptyTitle)).toThrow(/Presentation declaration/);
    expect(isPresentationDeclaration(emptyTitle)).toBe(false);
  });

  it("rejects unknown fields before a builder result reaches a strict declaration guard", () => {
    expect(() => tokenRef({ fallback: "red", tokenId: "accent" } as never)).toThrow(
      /Token reference/,
    );
    expect(() => namedStyleRef({ className: "title", styleId: "heading" } as never)).toThrow(
      /Named Style reference/,
    );
    expect(() => assetRef({ assetId: "logo", url: "logo.png" } as never)).toThrow(
      /Asset reference/,
    );
  });
});

const typeContractChecks = () => {
  // @ts-expect-error component manifests use componentId as their stable public identity
  defineComponentManifest({ id: "legacy" });
  // @ts-expect-error string prop defaults must be strings
  stringProp({ default: 1 });
  // @ts-expect-error Props must be either required or supply a default
  numberProp({});
  // @ts-expect-error required Props cannot also supply a default
  booleanProp({ default: false, required: true });
  // @ts-expect-error required must be the literal true
  stringProp({ required: false });
  // @ts-expect-error Slot declarations do not constrain placement cardinality or accepted kinds
  slot({ accepts: [], cardinality: "many" });
  // @ts-expect-error Part declarations do not expose a property permission list
  part({ overridable: ["style"] });
  // @ts-expect-error Text bounds require an explicit positive code point limit
  text({ id: "missing-limit", layout: absolute, value: "Unframe" });
  text({
    id: "legacy-text-style",
    layout: absolute,
    maxCodePoints: 64,
    value: "Unframe",
    // @ts-expect-error style is a concrete Text Style; Named Style references use namedStyle
    style: namedStyleRef({ styleId: "heading" }),
  });
  surface({
    ...titleSurface,
    baseSemanticTree: {
      nodes: {
        // @ts-expect-error heading semantic nodes require a level
        heading: {
          id: "heading",
          order: 0,
          parentId: null,
          role: "heading",
          text: "Unframe",
        },
      },
      rootNodeIds: ["heading"],
    },
  });
  // @ts-expect-error semantic overrides cannot alter topology or roles
  semanticOverride({ id: "bad", parentId: "other", targetId: "node" });
  // @ts-expect-error a Surface is a Structure root and cannot be nested inside Frame content
  frame({ children: [titleSurface], id: "bad-frame", layout: absolute });
  surface({
    ...titleSurface,
    // @ts-expect-error the initial milestone cannot declare Surface interactions
    interactions: { click: { event: "clicked", id: "click", kind: "click" } },
  });
  // @ts-expect-error output payload types and fixed scalar values must agree
  output({ payload: { count: { type: "number", value: "one" } }, producer: after(1) });
  // @ts-expect-error opaque manifests must declare semantic bindings
  defineComponentManifest({
    actions: {},
    authoring: { mode: "opaque" },
    componentId: "@example/opaque",
    outputs: {},
    parts: {},
    props: {},
    renderers: {},
    slots: {},
    states: {},
    variants: {},
    version: 1,
  });
};

expectTypeOf(typeContractChecks).toBeFunction();
