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
  variant,
} from "../src/index.js";

const absolute = { kind: "absolute" as const, x: 0, y: 0, width: 1920, height: 1080 };
const title = text({ id: "text-title", value: "Hello", layout: absolute, maxCodePoints: 64 });
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
        level: 1,
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
  slots: { content: slot({}) },
  parts: { root: part({}) },
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
  variantStyles: {},
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
  props: { width: 1920, height: 1080, logo: "logo" },
  slots: { content: [title.id] },
  variants: { fit: "contain" },
  partOverrides: [
    {
      partId: "root",
      targetKind: "frame",
      style: { backgroundColor: { red: 1, green: 1, blue: 1, alpha: 1 } },
    },
  ],
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
    expect(titleInstance.partOverrides[0]?.targetKind).toBe("frame");
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
      tokens: {
        accent: { category: "color", value: { red: 1, green: 0, blue: 1, alpha: 1 } },
        spacing: { category: "logicalLength", value: 8 },
      },
      namedStyles: {
        heading: {
          kind: "text",
          style: { color: tokenRef({ category: "color", tokenId: "accent" }), fontSize: 64 },
        },
      },
    });

    expect(theme.tokens.accent.category).toBe("color");
    expect(stringProp({ required: true })).toEqual({ kind: "string", required: true });
    expect(tokenRef({ category: "color", tokenId: "accent" })).toEqual({
      kind: "token-ref",
      category: "color",
      tokenId: "accent",
    });
    expect(namedStyleRef({ styleId: "heading" })).toEqual({
      kind: "named-style-ref",
      styleId: "heading",
    });
  });

  it("does not mutate builder inputs or retain registry state", () => {
    const input = { id: "copy", value: "Copy", layout: absolute, maxCodePoints: 64 } as const;
    const first = text(input);
    const second = text(input);

    expect(input).toEqual({ id: "copy", value: "Copy", layout: absolute, maxCodePoints: 64 });
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
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      variantStyles: {},
      timelines: [],
    });

    expect(unresolved.partBindings.missingPart).toBe("missing-node");
    expect(tokenRef({ category: "color", tokenId: "missing-token" }).tokenId).toBe("missing-token");
  });

  it("accepts concrete v2 primitive inputs without resolving Named Styles", () => {
    const styledText = text({
      id: "styled-text",
      value: "Unframe",
      layout: absolute,
      visible: false,
      opacity: 0.5,
      semanticNodeId: "semantic-styled-text",
      maxCodePoints: 64,
      style: {
        font: assetRef({ assetId: "reference-font" }),
        fallbackFonts: [],
        fontSize: 32,
        lineHeight: 40,
        color: { red: 0, green: 0, blue: 0, alpha: 1 },
        weight: "regular",
        align: "start",
        overflow: "clip",
      },
      namedStyle: namedStyleRef({ styleId: "heading" }),
    });
    const styledFrame = frame({
      id: "styled-frame",
      layout: absolute,
      children: [styledText],
      visible: true,
      opacity: 1,
      semanticNodeId: "semantic-frame",
      style: {
        backgroundColor: { red: 1, green: 1, blue: 1, alpha: 1 },
        border: {
          color: { red: 0, green: 0, blue: 0, alpha: 1 },
          width: 1,
          radius: 4,
        },
        clip: true,
      },
    });

    expect(styledText.style.font?.kind).toBe("asset-ref");
    expect(styledText.namedStyle?.styleId).toBe("heading");
    expect(styledFrame.style?.clip).toBe(true);
  });

  it("accepts v2 semantic role fields on Surface semantic nodes", () => {
    expect(() =>
      surface({
        ...titleSurface,
        id: "heading-surface",
        baseSemanticTree: {
          rootNodeIds: ["heading"],
          nodes: {
            heading: {
              id: "heading",
              parentId: null,
              order: 0,
              role: "heading",
              level: 1,
              text: "Unframe",
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects invalid concrete primitive limits at the authoring boundary", () => {
    expect(() =>
      text({ id: "bad-limit", value: "Unframe", layout: absolute, maxCodePoints: 0 }),
    ).toThrow(/text declaration/);
    expect(() =>
      text({
        id: "bad-font-size",
        value: "Unframe",
        layout: absolute,
        maxCodePoints: 64,
        style: { fontSize: 0 },
      }),
    ).toThrow(/text declaration/);
    expect(() => frame({ id: "bad-opacity", layout: absolute, children: [], opacity: 2 })).toThrow(
      /frame declaration/,
    );
  });
});

describe("local declaration boundary", () => {
  it("exposes non-mutating declaration guards with builder-equivalent acceptance", () => {
    const theme = {
      id: "default-theme",
      tokens: {
        accent: { category: "color" as const, value: { red: 1, green: 0, blue: 1, alpha: 1 } },
      },
      namedStyles: {},
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
    const accessor = Object.defineProperty({ id: "theme", tokens: {}, namedStyles: {} }, "tokens", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    const cyclic: Record<string, unknown> = { id: "theme", tokens: {}, namedStyles: {} };
    cyclic.self = cyclic;

    expect(isThemeDeclaration(accessor)).toBe(false);
    expect(reads).toBe(0);
    expect(isThemeDeclaration(cyclic)).toBe(false);
    expect(
      isThemeDeclaration({
        id: "theme",
        tokens: { invalid: Number.POSITIVE_INFINITY },
        namedStyles: {},
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
      cue(proxy({ id: "cue", trigger: { kind: "event", event: "ready" }, actions: [] })),
    ).not.toThrow();
    expect(isThemeDeclaration(proxy({ id: "theme", tokens: {}, namedStyles: {} }))).toBe(true);
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

    expect(() => variant({ values, default: "primary" })).not.toThrow();
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
      expect(isThemeDeclaration({ id: "theme", tokens: {}, namedStyles: {} })).toBe(true);
      expect(reads).toBe(0);
    } finally {
      delete (Object.prototype as { required?: unknown }).required;
    }
  });

  it("accepts normalized null-prototype declarations", () => {
    const theme = Object.assign(Object.create(null), {
      id: "theme",
      tokens: Object.assign(Object.create(null), {
        accent: { category: "color", value: { red: 1, green: 0, blue: 1, alpha: 1 } },
      }),
      namedStyles: Object.create(null),
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
    expect(() =>
      text({ id: "bad", value: "bad", layout: { ...absolute, width: 0 }, maxCodePoints: 64 }),
    ).toThrow(/layout size/);
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

  it("rejects nested empty ids and malformed interactions", () => {
    expect(() =>
      defineComponentStructure({
        id: "bad-structure",
        componentId: surfaceManifest.componentId,
        root,
        baseSemanticTree: { rootNodeIds: [], nodes: {} },
        partBindings: {},
        variantStyles: {},
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
    ).toThrow(/Invalid Surface declaration/);
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
    ).toThrow(/Invalid Surface declaration/);
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
    expect(() => slot({ accepts: ["frame"], cardinality: "many" } as never)).toThrow(
      /slot declaration/,
    );
  });

  it("enforces the same Prop, Slot, Part, and Variant contract at builders and Manifest guards", () => {
    expect(() => stringProp({ required: true, default: "fallback" } as never)).toThrow(
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
    expect(() => variant({ values: ["primary"], default: "secondary" })).toThrow(
      /variant declaration/,
    );

    expect(
      isComponentManifest({
        ...surfaceManifest,
        props: { title: { kind: "string", default: 1 } },
        slots: { content: { kind: "slot", accepts: ["frame"], cardinality: "many" } },
        parts: { root: { kind: "part", overridable: ["style"] } },
        variants: { tone: { kind: "variant", values: ["primary"], default: "secondary" } },
      }),
    ).toBe(false);
  });

  it("rejects malformed Theme style records and Structure nodes through public guards", () => {
    expect(isThemeDeclaration({ id: "theme", tokens: {}, namedStyles: { heading: "bold" } })).toBe(
      false,
    );
    expect(
      isComponentStructure({
        ...surfaceStructure,
        root: {
          id: "root",
          kind: "frame",
          layout: absolute,
          children: [{ id: "title", kind: "text", value: 42, layout: absolute, maxCodePoints: 64 }],
        },
      }),
    ).toBe(false);
    expect(() =>
      text({ id: "title", value: 42, layout: absolute, maxCodePoints: 64 } as never),
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
    expect(() => tokenRef({ tokenId: "accent", fallback: "red" } as never)).toThrow(
      /Token reference/,
    );
    expect(() => namedStyleRef({ styleId: "heading", className: "title" } as never)).toThrow(
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
  booleanProp({ required: true, default: false });
  // @ts-expect-error required must be the literal true
  stringProp({ required: false });
  // @ts-expect-error Slot declarations do not constrain placement cardinality or accepted kinds
  slot({ accepts: [], cardinality: "many" });
  // @ts-expect-error Part declarations do not expose a property permission list
  part({ overridable: ["style"] });
  // @ts-expect-error Text bounds require an explicit positive code point limit
  text({ id: "missing-limit", value: "Unframe", layout: absolute });
  text({
    id: "legacy-text-style",
    value: "Unframe",
    layout: absolute,
    maxCodePoints: 64,
    // @ts-expect-error style is a concrete Text Style; Named Style references use namedStyle
    style: namedStyleRef({ styleId: "heading" }),
  });
  surface({
    ...titleSurface,
    baseSemanticTree: {
      rootNodeIds: ["heading"],
      nodes: {
        // @ts-expect-error heading semantic nodes require a level
        heading: {
          id: "heading",
          parentId: null,
          order: 0,
          role: "heading",
          text: "Unframe",
        },
      },
    },
  });
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
