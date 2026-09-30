import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createRendererFingerprint,
  defineRendererPlugin,
  executeRendererPlugin,
  evaluateFirstMilestoneSupport,
  prepareRendererBuildInput,
  runRendererConformance,
  validateRendererBuildInput,
  validateRendererPlugin,
  type CompilerResolvedSurfaceInput,
  type RendererBuildResult,
  type RendererCapabilities,
  type RendererConformanceFixture,
  type RendererPlugin,
} from "../src/index.js";

const structuredContent = (surface: CompilerResolvedSurfaceInput["surface"]) => {
  if (surface.content.kind !== "structured") {
    throw new TypeError("Expected structured fixture.");
  }
  return surface.content;
};

const identity = {
  contractVersion: "1",
  id: "baked-web",
  implementationHash: "sha256:renderer",
  version: "1.0.0",
} as const;

const rendererConfigHash = "sha256:renderer-config";

const capabilities = {
  deterministic: true,
  fallbackPolicies: ["reject"],
  inputKinds: ["structured"],
  interactions: ["none", "regions"],
  internalAnimations: ["none"],
  rendererPreferences: ["baked-web"],
  updateModels: ["static", "finite-state"],
} as const satisfies RendererCapabilities;

const input = {
  context: {
    buildContextHash: "sha256:context",
    colorScheme: "dark",
    environmentHash: "sha256:environment",
    inputHash: "sha256:input",
    locale: "ja-JP",
    pixelTarget: [2, 1],
    rendererConfigHash,
    rendererFingerprint: createRendererFingerprint(identity, rendererConfigHash),
    themeHash: "sha256:theme",
    themeId: "theme-default",
    timezone: "Asia/Tokyo",
  },
  entry: { kind: "structured" },
  fontAssets: {
    "font-main": {
      checksum: `sha256:${"0".repeat(64)}`,
      dataBase64: "AAEAAA==",
      mediaType: "font/ttf",
    },
  },
  plan: {
    clipWindow: { height: 1080, width: 1920, x: 0, y: 0 },
    id: "render-surface-title",
    layer: 0,
    logicalBounds: { height: 1080, width: 1920, x: 0, y: 0 },
    ownership: {
      contextNodeIds: ["frame-root"],
      kind: "structured",
      ownedContentNodeIds: ["text-title"],
    },
    semanticSurfaceId: "surface-title",
    states: { "state-default": { kind: "capture" } },
  },
  resolvedIntent: {
    fallbackPolicy: "reject",
    interaction: { kind: "none" },
    internalAnimation: { kind: "none" },
    selectedRendererId: "baked-web",
    updateModel: { kind: "static" },
  },
  semanticsByState: {
    "state-default": {
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
  },
  sourceIntent: {
    fallbackPolicy: "reject",
    interaction: { kind: "none" },
    internalAnimation: { kind: "none" },
    rendererPreference: "auto",
    updateModel: { kind: "static" },
  },
  surface: {
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
    content: {
      kind: "structured",
      nodes: {
        "frame-root": {
          backgroundColor: { alpha: 0, blue: 0, green: 0, red: 0 },
          border: {
            color: { alpha: 0, blue: 0, green: 0, red: 0 },
            radius: 0,
            width: 0,
          },
          children: ["text-title"],
          clip: false,
          id: "frame-root",
          kind: "frame",
          layout: { kind: "absolute" },
          opacity: 1,
          order: 0,
          parentId: null,
          placement: { height: 1080, kind: "absolute", width: 1920, x: 0, y: 0 },
          visible: true,
        },
        "text-title": {
          id: "text-title",
          kind: "text",
          maxCodePoints: 100,
          opacity: 1,
          order: 0,
          parentId: "frame-root",
          placement: { height: 200, kind: "absolute", width: 1680, x: 120, y: 80 },
          semanticNodeId: "semantic-title",
          style: {
            align: "start",
            color: { alpha: 1, blue: 1, green: 1, red: 1 },
            fallbackFontAssetIds: [],
            fontAssetId: "font-main",
            fontSize: 64,
            lineHeight: 80,
            overflow: "clip",
            weight: "regular",
          },
          value: { kind: "literal", value: "Hello" },
          visible: true,
        },
      },
      rootFrameId: "frame-root",
    },
    fit: "contain",
    hostNodeId: "surface-node-title",
    id: "surface-title",
    initialStateId: "state-default",
    interactions: {},
    logicalSize: [1920, 1080],
    physicalSizeMeters: [1.6, 0.9],
    renderIntent: {
      fallbackPolicy: "reject",
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      rendererPreference: "auto",
      updateModel: { kind: "static" },
    },
    states: {
      "state-default": {
        contentOverrides: {},
        enabledInteractionIds: [],
        id: "state-default",
        semanticOverrides: [],
      },
    },
  },
} as const satisfies CompilerResolvedSurfaceInput;

const opaqueInput: CompilerResolvedSurfaceInput = {
  ...input,
  entry: { entryId: "opaque-entry", kind: "opaque", moduleHash: "sha256:module" },
  plan: {
    ...input.plan,
    ownership: { bindingKeys: ["title"], kind: "opaque" },
  },
  surface: {
    ...input.surface,
    content: { bindings: { title: "semantic-title" }, kind: "opaque" },
  },
};

const fixture = (value: CompilerResolvedSurfaceInput = input): RendererConformanceFixture => ({
  input: value,
  name: "title-surface",
});

const provenance = (value: CompilerResolvedSurfaceInput) => ({
  ...identity,
  buildContextHash: value.context.buildContextHash,
  environmentHash: value.context.environmentHash,
  inputHash: value.context.inputHash,
  rendererConfigHash: value.context.rendererConfigHash,
  rendererFingerprint: value.context.rendererFingerprint,
});

const renderSurface = (value: CompilerResolvedSurfaceInput) => ({
  id: value.plan.id,
  layer: value.plan.layer,
  logicalBounds: value.plan.logicalBounds,
  semanticSurfaceId: value.plan.semanticSurfaceId,
});

const successfulResult = (value: CompilerResolvedSurfaceInput): RendererBuildResult => ({
  captures: Object.entries(value.plan.states)
    .filter(([, statePlan]) => statePlan.kind === "capture")
    .map(([stateId]) => ({
      alphaMode: "straight" as const,
      colorSpace: "srgb" as const,
      id: `capture-${stateId}`,
      pixelSize: value.context.pixelTarget,
      rgba: new Uint8Array(value.context.pixelTarget[0] * value.context.pixelTarget[1] * 4),
      stateId,
    })),
  diagnostics: [],
  ok: true,
  provenance: provenance(value),
  renderSurface: renderSurface(value),
});

const goodPlugin = defineRendererPlugin({
  build: (value) => {
    const support = evaluateFirstMilestoneSupport({
      entry: value.entry,
      resolvedIntent: value.resolvedIntent,
    });
    return support.supported
      ? successfulResult(value)
      : { diagnostics: support.diagnostics, ok: false };
  },
  capabilities,
  identity,
  support: evaluateFirstMilestoneSupport,
});

describe("first-milestone plugin contract", () => {
  it("accepts whole-Surface opaque binding ownership at the input boundary while support remains disabled", () => {
    const opaque = opaqueInput;
    expect(prepareRendererBuildInput(opaque, goodPlugin).valid).toBe(true);
    expect(
      evaluateFirstMilestoneSupport({ entry: opaque.entry, resolvedIntent: opaque.resolvedIntent }),
    ).toMatchObject({ supported: false });

    const malformed = [
      {
        ...opaque,
        plan: { ...opaque.plan, ownership: { bindingKeys: ["missing"], kind: "opaque" } },
      },
      {
        ...opaque,
        plan: { ...opaque.plan, ownership: { bindingKeys: ["title", "title"], kind: "opaque" } },
      },
      {
        ...opaque,
        plan: { ...opaque.plan, logicalBounds: { height: 100, width: 100, x: 0, y: 0 } },
      },
      {
        ...opaque,
        plan: {
          ...opaque.plan,
          ownership: { contextNodeIds: [], kind: "structured", ownedContentNodeIds: [] },
        },
      },
      {
        ...opaque,
        surface: {
          ...opaque.surface,
          states: {
            "state-default": {
              ...opaque.surface.states["state-default"]!,
              contentOverrides: { ghost: { kind: "text", visible: false } },
            },
          },
        },
      },
      {
        ...opaque,
        surface: {
          ...opaque.surface,
          content: { bindings: { title: "unknown-semantic" }, kind: "opaque" },
        },
      },
    ];
    for (const candidate of malformed) {
      expect(prepareRendererBuildInput(candidate, goodPlugin).valid).toBe(false);
    }
  });

  it("opaque bindings must cover base semantic nodes exactly once", () => {
    const duplicate = {
      ...opaqueInput,
      plan: {
        ...opaqueInput.plan,
        ownership: { bindingKeys: ["title", "copy"], kind: "opaque" },
      },
      surface: {
        ...opaqueInput.surface,
        content: { bindings: { copy: "semantic-title", title: "semantic-title" }, kind: "opaque" },
      },
    };
    expect(prepareRendererBuildInput(duplicate, goodPlugin).valid).toBe(false);

    const second = {
      id: "semantic-second",
      level: 2,
      order: 1,
      parentId: null,
      role: "heading",
      text: "Second",
    } as const;
    const missing = {
      ...opaqueInput,
      semanticsByState: {
        "state-default": {
          nodes: {
            ...opaqueInput.semanticsByState["state-default"]!.nodes,
            "semantic-second": second,
          },
          rootNodeIds: ["semantic-title", "semantic-second"],
        },
      },
      surface: {
        ...opaqueInput.surface,
        baseSemanticTree: {
          nodes: { ...opaqueInput.surface.baseSemanticTree.nodes, "semantic-second": second },
          rootNodeIds: ["semantic-title", "semantic-second"],
        },
      },
    };
    expect(prepareRendererBuildInput(missing, goodPlugin).valid).toBe(false);
  });

  it("renderer entry kind must match Surface content before support or build", async () => {
    let calls = 0;
    const plugin = {
      ...goodPlugin,
      build: (value: CompilerResolvedSurfaceInput) => {
        calls++;
        return successfulResult(value);
      },
      support: (request: Parameters<RendererPlugin["support"]>[0]) => {
        calls++;
        return evaluateFirstMilestoneSupport(request);
      },
    };
    for (const candidate of [
      { ...input, entry: opaqueInput.entry },
      { ...opaqueInput, entry: input.entry },
    ]) {
      expect(prepareRendererBuildInput(candidate, plugin).valid).toBe(false);
      expect((await executeRendererPlugin(plugin, candidate)).valid).toBe(false);
    }
    expect(calls).toBe(0);
  });
  it("prepared boundary は nested Proxy の get trap を実行せず入力を独立 snapshot 化する", async () => {
    const source = structuredClone(input) as unknown as CompilerResolvedSurfaceInput;
    let getTrapCalls = 0;
    const denyGet = <T extends object>(target: T): T =>
      new Proxy(target, {
        get() {
          getTrapCalls++;
          throw new Error("prepared boundary must not read through Proxy getters");
        },
      });
    const pixelTarget = [...source.context.pixelTarget];
    const contextTarget = { ...source.context, pixelTarget: denyGet(pixelTarget) };
    const textTarget = { ...structuredContent(source.surface).nodes["text-title"] } as {
      value?: unknown;
    };
    const contentNodesTarget = {
      ...structuredContent(source.surface).nodes,
      "text-title": denyGet(textTarget),
    };
    const surfaceTarget = {
      ...source.surface,
      content: { ...structuredContent(source.surface), nodes: denyGet(contentNodesTarget) },
    };
    const proxiedInput = {
      ...source,
      context: denyGet(contextTarget),
      surface: denyGet(surfaceTarget),
    } as unknown as CompilerResolvedSurfaceInput;

    const prepared = prepareRendererBuildInput(proxiedInput, goodPlugin);
    expect(prepared.valid).toBe(true);
    expect(getTrapCalls).toBe(0);
    if (prepared.valid) {
      contextTarget.locale = "en-US";
      textTarget.value = { kind: "literal", value: "Mutated after preparation" };
      expect(prepared.value.context.locale).toBe("ja-JP");
      const preparedText = structuredContent(prepared.value.surface).nodes["text-title"];
      expect(preparedText?.kind).toBe("text");
      if (preparedText?.kind === "text") {
        expect(preparedText.value).toEqual({ kind: "literal", value: "Hello" });
      }
    }

    const execution = await executeRendererPlugin(goodPlugin, proxiedInput);
    expect(execution.valid).toBe(true);
    expect(getTrapCalls).toBe(0);
  });

  it("prepared boundary は plugin Proxy の identity/capabilities/methods を descriptor から固定する", async () => {
    let getTrapCalls = 0;
    const proxiedPlugin = new Proxy(goodPlugin, {
      get() {
        getTrapCalls++;
        throw new Error("prepared boundary must not read through Proxy getters");
      },
    });

    const prepared = prepareRendererBuildInput(input, proxiedPlugin);
    expect(prepared.valid).toBe(true);
    expect(getTrapCalls).toBe(0);

    const execution = await executeRendererPlugin(proxiedPlugin, input);
    expect(execution.valid).toBe(true);
    expect(getTrapCalls).toBe(0);
  });

  it("2K opaque RGBAを線形copy・全alpha検証し、正確なcaller-owned bytesを返す", async () => {
    const pixelTarget = [2048, 2048] as const;
    const largeInput: CompilerResolvedSurfaceInput = {
      ...input,
      context: { ...input.context, pixelTarget },
    };
    let emittedBytes: Uint8Array | undefined;
    const plugin = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) {
          return result;
        }
        return {
          ...result,
          captures: result.captures.map((capture) => ({
            ...capture,
            alphaMode: "opaque" as const,
            rgba: (emittedBytes = new Uint8Array(capture.rgba.byteLength).fill(255)),
          })),
        };
      },
    });

    const result = await executeRendererPlugin(plugin, largeInput);

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const rgba = result.value.captures[0]?.rgba;
    expect(rgba !== undefined).toBe(true);
    expect(rgba !== emittedBytes).toBe(true);
    expect(rgba?.byteLength === 16 * 1024 * 1024).toBe(true);
    expect(rgba?.[0] === 255).toBe(true);
    expect(rgba?.at(-1) === 255).toBe(true);
    expect(largeInput.context.pixelTarget).toEqual(pixelTarget);
  });

  it.each([
    [
      "frame children is missing",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              "frame-root": (() => {
                const root = structuredContent(input.surface).nodes["frame-root"];
                if (root?.kind !== "frame") {
                  throw new TypeError("Expected Frame fixture.");
                }
                const { children: _children, ...frame } = root;
                return frame;
              })(),
            },
          },
        },
      }),
    ],
    [
      "frame children references an unknown node",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              "frame-root": {
                ...structuredContent(input.surface).nodes["frame-root"],
                children: ["unknown"],
              },
            },
          },
        },
      }),
    ],
    [
      "Text placement is missing a numeric field",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              "text-title": {
                ...structuredContent(input.surface).nodes["text-title"],
                placement: { kind: "absolute", width: 1680, x: 120, y: 80 },
              },
            },
          },
        },
      }),
    ],
    [
      "Text placement kind is missing",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              "text-title": {
                ...structuredContent(input.surface).nodes["text-title"],
                placement: { height: 200, width: 1680, x: 120, y: 80 },
              },
            },
          },
        },
      }),
    ],
    [
      "semantic node shape is malformed",
      () => ({
        ...input,
        semanticsByState: {
          ...input.semanticsByState,
          "state-default": {
            ...input.semanticsByState["state-default"],
            nodes: {
              ...input.semanticsByState["state-default"].nodes,
              "semantic-title": {
                ...input.semanticsByState["state-default"].nodes["semantic-title"],
                role: 42,
              },
            },
          },
        },
      }),
    ],
    [
      "surface required field is missing",
      () => {
        const { hostNodeId: _hostNodeId, ...surface } = input.surface;
        return { ...input, surface };
      },
    ],
    [
      "state shape is malformed",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          states: {
            "state-default": {
              ...input.surface.states["state-default"],
              enabledInteractionIds: [42],
            },
          },
        },
      }),
    ],
    [
      "interaction shape is malformed",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          interactions: { tap: { id: "tap" } },
        },
      }),
    ],
    [
      "opaque renderer entry fields are missing",
      () => ({
        ...input,
        entry: { kind: "opaque" },
      }),
    ],
  ] as const)("prepare rejects %s", (_name, createMalformedInput) => {
    const malformed = createMalformedInput() as unknown as CompilerResolvedSurfaceInput;
    const result = prepareRendererBuildInput(malformed, goodPlugin);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-renderer-input", path: [] }),
      );
    }
  });

  it.each([
    [
      "non-finite logical size",
      { ...input, surface: { ...input.surface, logicalSize: [Infinity, 1080] } },
    ],
    [
      "unknown enabled interaction",
      {
        ...input,
        surface: {
          ...input.surface,
          states: {
            "state-default": {
              ...input.surface.states["state-default"],
              enabledInteractionIds: ["missing"],
            },
          },
        },
      },
    ],
    [
      "unknown semantic override node",
      {
        ...input,
        surface: {
          ...input.surface,
          states: {
            "state-default": {
              ...input.surface.states["state-default"],
              semanticOverrides: [{ nodes: { missing: { text: "x" } } }],
            },
          },
        },
      },
    ],
    [
      "unsupported optional value",
      {
        ...input,
        semanticsByState: {
          ...input.semanticsByState,
          "state-default": {
            ...input.semanticsByState["state-default"],
            nodes: {
              ...input.semanticsByState["state-default"].nodes,
              "semantic-title": {
                ...input.semanticsByState["state-default"].nodes["semantic-title"],
                text: () => "not plain data",
              },
            },
          },
        },
      },
    ],
  ] as const)("prepare rejects %s", (_name, malformed) => {
    expect(
      prepareRendererBuildInput(malformed as unknown as CompilerResolvedSurfaceInput, goodPlugin),
    ).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "invalid-renderer-input" })],
      valid: false,
    });
  });

  it.each([
    ["invalid color scheme", { ...input, context: { ...input.context, colorScheme: "invalid" } }],
    ["empty surface host", { ...input, surface: { ...input.surface, hostNodeId: "" } }],
    [
      "duplicate finite states",
      {
        ...input,
        resolvedIntent: {
          ...input.resolvedIntent,
          updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
        },
        sourceIntent: {
          ...input.sourceIntent,
          updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
        },
        surface: {
          ...input.surface,
          renderIntent: {
            ...input.surface.renderIntent,
            updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
          },
        },
      },
    ],
    [
      "semantic cycle",
      {
        ...input,
        semanticsByState: {
          "state-default": {
            nodes: {
              a: { id: "a", order: 0, parentId: "b", role: "paragraph" },
              b: { id: "b", order: 0, parentId: "a", role: "paragraph" },
            },
            rootNodeIds: [],
          },
        },
      },
    ],
    [
      "empty semantic language",
      {
        ...input,
        semanticsByState: {
          "state-default": {
            ...input.semanticsByState["state-default"],
            nodes: {
              "semantic-title": {
                ...input.semanticsByState["state-default"].nodes["semantic-title"],
                language: "",
              },
            },
          },
        },
      },
    ],
    [
      "duplicate enabled interactions",
      {
        ...input,
        surface: {
          ...input.surface,
          interactions: { tap: { event: "advance", hitPriority: 0, id: "tap", kind: "click" } },
          states: {
            "state-default": {
              ...input.surface.states["state-default"],
              enabledInteractionIds: ["tap", "tap"],
            },
          },
        },
      },
    ],
    [
      "disconnected root frame",
      {
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              detached: {
                ...structuredContent(input.surface).nodes["frame-root"],
                children: [],
                id: "detached",
                kind: "frame",
                layout: { kind: "absolute" },
                order: 1,
                parentId: null,
              },
            },
          },
        },
      },
    ],
    [
      "parentless text",
      {
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              "text-title": {
                ...structuredContent(input.surface).nodes["text-title"],
                order: 2,
                parentId: null,
              },
            },
          },
        },
      },
    ],
  ] as const)("prepare rejects strict contract violation: %s", (_name, malformed) => {
    expect(
      prepareRendererBuildInput(malformed as unknown as CompilerResolvedSurfaceInput, goodPlugin),
    ).toMatchObject({ valid: false });
  });

  it("prepare rejects interactions whose record key differs from interaction.id", () => {
    const malformed = {
      ...input,
      surface: {
        ...input.surface,
        interactions: {
          tap: { event: "advance", hitPriority: 0, id: "different-id", kind: "click" },
        },
        states: {
          "state-default": {
            ...input.surface.states["state-default"],
            enabledInteractionIds: ["tap"],
          },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;

    expect(prepareRendererBuildInput(malformed, goodPlugin)).toMatchObject({ valid: false });
  });

  it("prepare rejects a Text font reference missing from fontAssets", () => {
    expect(prepareRendererBuildInput({ ...input, fontAssets: {} }, goodPlugin)).toMatchObject({
      diagnostics: [{ code: "invalid-renderer-input" }],
      valid: false,
    });
  });

  it("prepare rejects content-node cycles detached from the root frame", () => {
    const malformed = {
      ...input,
      surface: {
        ...input.surface,
        content: {
          ...structuredContent(input.surface),
          nodes: {
            ...structuredContent(input.surface).nodes,
            "detached-a": {
              ...structuredContent(input.surface).nodes["frame-root"],
              children: ["detached-b"],
              id: "detached-a",
              kind: "frame",
              layout: { kind: "absolute" },
              order: 0,
              parentId: "detached-b",
            },
            "detached-b": {
              ...structuredContent(input.surface).nodes["frame-root"],
              children: ["detached-a"],
              id: "detached-b",
              kind: "frame",
              layout: { kind: "absolute" },
              order: 0,
              parentId: "detached-a",
            },
          },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;

    expect(prepareRendererBuildInput(malformed, goodPlugin)).toMatchObject({ valid: false });
  });

  it("prepare rejects Frame children outside canonical sibling order", () => {
    const text = structuredContent(input.surface).nodes["text-title"];
    const root = structuredContent(input.surface).nodes["frame-root"];
    if (text?.kind !== "text" || root?.kind !== "frame") {
      throw new TypeError("Expected Frame/Text fixture.");
    }
    const malformed: CompilerResolvedSurfaceInput = {
      ...input,
      plan: {
        ...input.plan,
        ownership: { ...input.plan.ownership, ownedContentNodeIds: ["text-second", "text-title"] },
      },
      surface: {
        ...input.surface,
        content: {
          ...structuredContent(input.surface),
          nodes: {
            ...structuredContent(input.surface).nodes,
            "frame-root": {
              ...root,
              children: ["text-second", "text-title"],
            },
            "text-second": { ...text, id: "text-second", order: 1 },
          },
        },
      },
    };

    expect(prepareRendererBuildInput(malformed, goodPlugin)).toMatchObject({ valid: false });
  });

  it("RGBA output の偽装 brand と iterator を実行せず拒否する", async () => {
    let iteratorCalls = 0;
    const bytes = new Uint8ClampedArray(8);
    Object.defineProperties(bytes, {
      [Symbol.iterator]: {
        value() {
          iteratorCalls++;
          throw new Error("must not iterate hostile bytes");
        },
      },
      [Symbol.toStringTag]: { value: "Uint8Array" },
    });
    const hostile = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) {
          return result;
        }
        return {
          ...result,
          captures: [{ ...result.captures[0]!, rgba: bytes as unknown as Uint8Array }],
        };
      },
    });
    const result = await runRendererConformance(hostile, [fixture()]);
    expect(result.valid).toBe(false);
    expect(iteratorCalls).toBe(0);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
    }
  });

  it("sparse failure diagnostics と不透明でない opaque capture を拒否する", async () => {
    const sparseFailure = defineRendererPlugin({
      ...goodPlugin,
      build: () =>
        ({
          diagnostics: Object.assign([], { length: 1 }),
          ok: false,
        }) as RendererBuildResult,
    });
    const sparseResult = await runRendererConformance(sparseFailure, [fixture()]);
    expect(sparseResult.valid).toBe(false);
    if (!sparseResult.valid) {
      expect(sparseResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-renderer-output",
      );
    }

    const invalidOpaque = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) {
          return result;
        }
        const rgba = new Uint8Array(result.captures[0]!.rgba);
        rgba[3] = 1;
        return {
          ...result,
          captures: [{ ...result.captures[0]!, alphaMode: "opaque" as const, rgba }],
        };
      },
    });
    const opaqueResult = await runRendererConformance(invalidOpaque, [fixture()]);
    expect(opaqueResult.valid).toBe(false);
    if (!opaqueResult.valid) {
      expect(opaqueResult.diagnostics.map(({ code }) => code)).toContain("invalid-opaque-alpha");
    }
  });

  it("sparse または非有限な diagnostic path を拒否する", async () => {
    const sparsePath = Object.assign([], { length: 1 }) as unknown as Array<string | number>;
    for (const path of [sparsePath, [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      const plugin = defineRendererPlugin({
        ...goodPlugin,
        build: () => ({
          diagnostics: [{ code: "failure", message: "failure", path }],
          ok: false as const,
        }),
      });
      const result = await runRendererConformance(plugin, [fixture()]);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
      }
    }
  });

  it("Zod boundary は build output の accessor と未知 field を実行せず拒否する", async () => {
    let accessorReads = 0;
    const hostileOutput = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) {
          return result;
        }
        return Object.defineProperties(
          { ...result, unexpected: true },
          {
            captures: {
              get() {
                accessorReads++;
                throw new Error("renderer boundary must not execute accessors");
              },
            },
          },
        ) as RendererBuildResult;
      },
    });

    const result = await runRendererConformance(hostileOutput, [fixture()]);
    expect(accessorReads).toBe(0);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
    }
  });

  it("固定した method の mutable call property を参照しない", async () => {
    const support = (request: Parameters<typeof goodPlugin.support>[0]) =>
      evaluateFirstMilestoneSupport(request);
    const build = (value: CompilerResolvedSurfaceInput) => successfulResult(value);
    Object.defineProperty(support, "call", { value: () => Promise.reject(new Error("unused")) });
    Object.defineProperty(build, "call", { value: () => Promise.reject(new Error("unused")) });
    const plugin = defineRendererPlugin({ ...goodPlugin, build, support });
    await expect(executeRendererPlugin(plugin, input)).resolves.toMatchObject({ valid: true });
  });

  it("公開入力validatorは hostile input を実行せず診断化する", () => {
    expect(validateRendererBuildInput(null, {})).toMatchObject([
      { code: "invalid-renderer-plugin" },
    ]);
    expect(validateRendererBuildInput({ plan: {} }, { capabilities, identity })).toMatchObject([
      { code: "invalid-renderer-plugin" },
    ]);
    let contextReads = 0;
    const getterInput = Object.defineProperty({ ...input }, "context", {
      get() {
        contextReads++;
        return input.context;
      },
    });
    expect(validateRendererBuildInput(getterInput, goodPlugin)).toContainEqual(
      expect.objectContaining({ code: "invalid-renderer-input", path: [] }),
    );
    expect(contextReads).toBe(0);
  });
  it("sparse boundary values と malformed Text node を prefix 付きで拒否する", async () => {
    const sparsePixelTarget = [2, undefined] as unknown as Array<number>;
    delete sparsePixelTarget[1];
    expect(
      validateRendererBuildInput(
        { ...input, context: { ...input.context, pixelTarget: sparsePixelTarget } },
        goodPlugin,
      ),
    ).toContainEqual(expect.objectContaining({ code: "invalid-renderer-input", path: [] }));
    const malformedText = {
      ...input,
      surface: {
        ...input.surface,
        content: {
          ...structuredContent(input.surface),
          nodes: {
            ...structuredContent(input.surface).nodes,
            "text-title": { ...structuredContent(input.surface).nodes["text-title"], text: 1 },
          },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;
    expect(validateRendererBuildInput(malformedText, goodPlugin)).toContainEqual(
      expect.objectContaining({ code: "invalid-renderer-input", path: [] }),
    );
    const malformedFixture = await runRendererConformance(goodPlugin, [
      { input: malformedText, name: "malformed-fixture" },
    ]);
    expect(malformedFixture.valid).toBe(false);
    if (!malformedFixture.valid) {
      expect(malformedFixture.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "invalid-renderer-input",
          path: ["malformed-fixture", "input"],
        }),
      );
    }
    const sparseCapabilities = [undefined] as unknown as Array<string>;
    delete sparseCapabilities[0];
    expect(
      validateRendererPlugin({
        ...goodPlugin,
        capabilities: { ...capabilities, inputKinds: sparseCapabilities },
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-renderer-capabilities" })]),
    );
  });
  it("公開validatorは root path を二重にせず、conformance fixture 名は保持する", async () => {
    const invalid = {
      ...input,
      sourceIntent: { ...input.sourceIntent, rendererPreference: "native-ui" },
    } as const satisfies CompilerResolvedSurfaceInput;
    expect(validateRendererBuildInput(invalid, goodPlugin)).toContainEqual(
      expect.objectContaining({ code: "source-render-intent-mismatch", path: ["sourceIntent"] }),
    );
    const execution = await executeRendererPlugin(goodPlugin, invalid);
    expect(execution.valid).toBe(false);
    if (!execution.valid) {
      expect(execution.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "source-render-intent-mismatch",
          path: ["single", "input", "sourceIntent"],
        }),
      );
    }
    const result = await runRendererConformance(goodPlugin, [
      { input: invalid, name: "fixture-a" },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "source-render-intent-mismatch",
          path: ["fixture-a", "input", "sourceIntent"],
        }),
      );
    }
  });
  it("rejects malformed plugins before invoking them", async () => {
    const invalid = { ...goodPlugin, identity: { ...identity, id: "" } };
    expect(validateRendererPlugin(invalid).map(({ code }) => code)).toContain(
      "invalid-renderer-identity",
    );
    expect((await executeRendererPlugin(invalid as never, input)).valid).toBe(false);
  });
  it("rejects plugins without callable support and build methods", async () => {
    const withoutSupport = { ...goodPlugin, support: undefined };
    const withoutBuild = { ...goodPlugin, build: null };

    expect(validateRendererPlugin(withoutSupport).map(({ code }) => code)).toContain(
      "invalid-renderer-plugin",
    );
    expect(validateRendererPlugin(withoutBuild).map(({ code }) => code)).toContain(
      "invalid-renderer-plugin",
    );
    expect((await executeRendererPlugin(withoutSupport as never, input)).valid).toBe(false);
    expect((await executeRendererPlugin(withoutBuild as never, input)).valid).toBe(false);
  });
  it("executes build exactly once", async () => {
    let calls = 0;
    const plugin = {
      ...goodPlugin,
      build: (value: CompilerResolvedSurfaceInput) => {
        calls++;
        return successfulResult(value);
      },
    };
    expect((await executeRendererPlugin(plugin, input)).valid).toBe(true);
    expect(calls).toBe(1);
  });
  it("does not build after support failure", async () => {
    let calls = 0;
    const plugin = {
      ...goodPlugin,
      build: () => {
        calls++;
        return successfulResult(input);
      },
      support: () => {
        throw new Error("no");
      },
    };
    expect((await executeRendererPlugin(plugin, input)).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it("uses the prepared input when support mutates the caller input", async () => {
    let calls = 0;
    const plugin = {
      ...goodPlugin,
      build: () => {
        calls++;
        return successfulResult(input);
      },
      support: () => {
        (input.plan.states as Record<string, unknown>).changed = {};
        return evaluateFirstMilestoneSupport({
          entry: input.entry,
          resolvedIntent: input.resolvedIntent,
        });
      },
    };
    const result = await executeRendererPlugin(plugin, input);
    delete (input.plan.states as Record<string, unknown>).changed;
    expect(result.valid).toBe(true);
    expect(calls).toBe(1);
  });
  it("does not build unsupported input", async () => {
    let calls = 0;
    const unsupported = {
      ...input,
      entry: { entryId: "x", kind: "opaque" as const, moduleHash: "h" },
    };
    const plugin = {
      ...goodPlugin,
      build: () => {
        calls++;
        return successfulResult(input);
      },
    };
    expect((await executeRendererPlugin(plugin, unsupported)).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it("does not invoke plugins for invalid plans", async () => {
    let calls = 0;
    const invalid = {
      ...input,
      plan: { ...input.plan, states: { "state-default": { kind: "bad" } } },
    } as never as CompilerResolvedSurfaceInput;
    const plugin = {
      ...goodPlugin,
      build: () => successfulResult(input),
      support: () => {
        calls++;
        return { diagnostics: [], supported: true } as const;
      },
    };
    expect((await executeRendererPlugin(plugin, invalid)).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it("does not invoke conformance plugins for invalid inputs", async () => {
    let supportCalls = 0;
    let buildCalls = 0;
    const invalid = {
      ...input,
      plan: {
        ...input.plan,
        ownership: {
          contextNodeIds: [],
          kind: "structured",
          ownedContentNodeIds: ["missing-node"],
        },
      },
    } as const satisfies CompilerResolvedSurfaceInput;
    const plugin = {
      ...goodPlugin,
      build: () => {
        buildCalls++;
        return successfulResult(input);
      },
      support: () => {
        supportCalls++;
        return { diagnostics: [], supported: true } as const;
      },
    };

    expect((await runRendererConformance(plugin, [fixture(invalid)])).valid).toBe(false);
    expect(supportCalls).toBe(0);
    expect(buildCalls).toBe(0);
  });
  it("accepts a deterministic renderer after resolving an auto source preference", async () => {
    const result = await runRendererConformance(goodPlugin, [fixture()]);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value[0]).toMatchObject({
        ok: true,
        provenance: identity,
        renderSurface: { id: "render-surface-title", semanticSurfaceId: "surface-title" },
      });
    }
  });

  it("rejects unsupported input and intent variants with stable decisions", () => {
    expect(
      evaluateFirstMilestoneSupport({
        entry: { entryId: "chart", kind: "opaque", moduleHash: "h" },
        resolvedIntent: input.resolvedIntent,
      }),
    ).toMatchObject({ diagnostics: [{ code: "unsupported-input-kind" }], supported: false });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: {
          ...input.resolvedIntent,
          interaction: { events: ["click"], kind: "regions" },
        },
      }),
    ).toMatchObject({ diagnostics: [], supported: true });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: {
          ...input.resolvedIntent,
          updateModel: { kind: "continuous-native-text", maximumUpdateRateHz: 1 },
        },
      }),
    ).toMatchObject({ diagnostics: [{ code: "unsupported-update-model" }], supported: false });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: { ...input.resolvedIntent, selectedRendererId: "video" },
      }),
    ).toMatchObject({
      diagnostics: [{ code: "unsupported-renderer" }],
      supported: false,
    });
  });

  it("conforms when unsupported inputs return diagnostic failures", async () => {
    const result = await runRendererConformance(goodPlugin, [fixture(opaqueInput)]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value[0]).toMatchObject({ ok: false });
    }
  });

  it("rejects implicit fallback from an explicit renderer preference", async () => {
    const explicitNative = {
      ...input,
      sourceIntent: { ...input.sourceIntent, rendererPreference: "native-ui" },
      surface: {
        ...input.surface,
        renderIntent: { ...input.surface.renderIntent, rendererPreference: "native-ui" },
      },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await runRendererConformance(goodPlugin, [fixture(explicitNative)]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("renderer-preference-mismatch");
    }
  });

  it("rejects incomplete identity and capability declarations", () => {
    expect(() =>
      defineRendererPlugin({ ...goodPlugin, identity: { ...identity, id: "" } }),
    ).toThrow(/identity/);
    expect(() =>
      defineRendererPlugin({
        ...goodPlugin,
        capabilities: { ...capabilities, deterministic: false },
      } as never),
    ).toThrow(/capabilities/);
  });
});

describe("conformance diagnostics", () => {
  const withBuild = (build: RendererPlugin["build"]): RendererPlugin => ({ ...goodPlugin, build });

  it("rejects inherited state and content entries", async () => {
    const inheritedSemantics = Object.create({
      "state-default": input.semanticsByState["state-default"],
    }) as CompilerResolvedSurfaceInput["semanticsByState"];
    const inheritedContentNodes = Object.create({
      "text-title": structuredContent(input.surface).nodes["text-title"],
    }) as Extract<
      CompilerResolvedSurfaceInput["surface"]["content"],
      { kind: "structured" }
    >["nodes"];
    const inheritedInput = {
      ...input,
      semanticsByState: inheritedSemantics,
      surface: {
        ...input.surface,
        content: { ...structuredContent(input.surface), nodes: inheritedContentNodes },
      },
    } as const satisfies CompilerResolvedSurfaceInput;
    const inputResult = await executeRendererPlugin(goodPlugin, inheritedInput);
    expect(inputResult.valid).toBe(false);
    if (!inputResult.valid) {
      expect(inputResult.diagnostics.map(({ code }) => code)).toContain("invalid-renderer-input");
    }
  });

  it("detects RGBA length, state completeness, duplicate IDs, and provenance drift", async () => {
    const invalid = withBuild((value) => ({
      captures: [
        {
          alphaMode: "straight",
          colorSpace: "srgb",
          id: "duplicate",
          pixelSize: [2, 1],
          rgba: new Uint8Array(1),
          stateId: "state-default",
        },
        {
          alphaMode: "straight",
          colorSpace: "srgb",
          id: "duplicate",
          pixelSize: [2, 1],
          rgba: new Uint8Array(8),
          stateId: "state-default",
        },
      ],
      diagnostics: [],
      ok: true,
      provenance: { ...provenance(value), environmentHash: "wrong" },
      renderSurface: renderSurface(value),
    }));

    const result = await runRendererConformance(invalid, [fixture()]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "duplicate-capture-id",
          "invalid-rgba-length",
          "invalid-renderer-provenance",
          "state-capture-mismatch",
        ]),
      );
    }
  });

  it("detects input mutation, thrown errors, and support/build disagreement", async () => {
    const mutable = structuredClone(input) as unknown as CompilerResolvedSurfaceInput;
    const mutating = withBuild((value) => {
      (value.plan as { layer: number }).layer = 2;
      return successfulResult(value);
    });
    const mutation = await runRendererConformance(mutating, [fixture(mutable)]);
    expect(mutation.valid).toBe(false);
    if (!mutation.valid) {
      expect(mutation.diagnostics.map(({ code }) => code)).toContain("renderer-mutated-input");
    }

    const throwing = withBuild(() => {
      throw new Error("browser crashed");
    });
    const thrown = await runRendererConformance(throwing, [fixture()]);
    expect(thrown.valid).toBe(false);
    if (!thrown.valid) {
      expect(thrown.diagnostics.map(({ code }) => code)).toContain("renderer-threw");
    }

    const supportThrowing: RendererPlugin = {
      ...goodPlugin,
      support: () => {
        throw new Error("support crashed");
      },
    };
    const supportThrown = await runRendererConformance(supportThrowing, [fixture()]);
    expect(supportThrown.valid).toBe(false);
    if (!supportThrown.valid) {
      expect(supportThrown.diagnostics.map(({ code }) => code)).toContain("renderer-support-threw");
    }

    const disagreeing = withBuild(() => ({ diagnostics: [], ok: false }));
    const disagreement = await runRendererConformance(disagreeing, [fixture()]);
    expect(disagreement.valid).toBe(false);
    if (!disagreement.valid) {
      expect(disagreement.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(["missing-failure-diagnostic", "support-build-mismatch"]),
      );
    }
  });

  it("reports malformed support and build values without throwing", async () => {
    const malformedSupport: RendererPlugin = {
      ...goodPlugin,
      support: () => null as never,
    };
    const supportResult = await runRendererConformance(malformedSupport, [fixture()]);
    expect(supportResult.valid).toBe(false);
    if (!supportResult.valid) {
      expect(supportResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-support-decision",
      );
    }

    const malformedBuild = withBuild(() => null as never);
    const buildResult = await runRendererConformance(malformedBuild, [fixture()]);
    expect(buildResult.valid).toBe(false);
    if (!buildResult.valid) {
      expect(buildResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-renderer-output",
      );
    }

    const nonByteCapture = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) {
        return result;
      }
      return {
        ...result,
        captures: [{ ...result.captures[0], rgba: Array(8).fill(0) }],
      } as never;
    });
    const byteResult = await runRendererConformance(nonByteCapture, [fixture()]);
    expect(byteResult.valid).toBe(false);
    if (!byteResult.valid) {
      expect(byteResult.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
    }
  });

  it("accepts Uint8Array bytes restored from another JavaScript realm", async () => {
    const crossRealmBytes = runInNewContext("new Uint8Array(8)") as Uint8Array;
    expect(crossRealmBytes).not.toBeInstanceOf(Uint8Array);
    const crossRealmRenderer = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) {
        return result;
      }
      return {
        ...result,
        captures: [{ ...result.captures[0], rgba: crossRealmBytes }],
      } as RendererBuildResult;
    });

    const result = await runRendererConformance(crossRealmRenderer, [fixture()]);
    expect(result.valid).toBe(true);
  });

  it("binds renderer identity and configuration to the input fingerprint", async () => {
    const staleContext = {
      ...input,
      context: { ...input.context, rendererFingerprint: "stale" },
    } as const satisfies CompilerResolvedSurfaceInput;
    const staleResult = await runRendererConformance(goodPlugin, [fixture(staleContext)]);
    expect(staleResult.valid).toBe(false);
    if (!staleResult.valid) {
      expect(staleResult.diagnostics.map(({ code }) => code)).toContain(
        "renderer-fingerprint-mismatch",
      );
    }

    const upgradedPlugin = defineRendererPlugin({
      ...goodPlugin,
      identity: { ...identity, version: "2.0.0" },
    });
    const upgradedResult = await runRendererConformance(upgradedPlugin, [fixture()]);
    expect(upgradedResult.valid).toBe(false);
    if (!upgradedResult.valid) {
      expect(upgradedResult.diagnostics.map(({ code }) => code)).toContain(
        "renderer-fingerprint-mismatch",
      );
    }
  });

  it("detects non-deterministic bytes and produces stable diagnostic ordering", async () => {
    let byte = 0;
    const nondeterministic = withBuild((value) => {
      const result = successfulResult(value);
      if (result.ok) {
        result.captures[0]?.rgba.fill(byte++);
      }
      return result;
    });

    const first = await runRendererConformance(nondeterministic, [fixture()]);
    byte = 0;
    const second = await runRendererConformance(nondeterministic, [fixture()]);
    expect(first.valid).toBe(false);
    expect(second).toEqual(first);
    if (!first.valid) {
      expect(first.diagnostics.map(({ code }) => code)).toContain(
        "non-deterministic-renderer-output",
      );
    }
  });

  it("detects non-determinism when builds reuse and mutate the same byte buffer", async () => {
    const sharedBytes = new Uint8Array(8);
    let byte = 0;
    const sharedBufferRenderer = withBuild((value) => {
      sharedBytes.fill(byte++);
      const result = successfulResult(value);
      if (!result.ok) {
        return result;
      }
      return {
        ...result,
        captures: [{ ...result.captures[0], rgba: sharedBytes }],
      } as RendererBuildResult;
    });

    const result = await runRendererConformance(sharedBufferRenderer, [fixture()]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "non-deterministic-renderer-output",
      );
    }
  });

  it("validates Compiler plans before accepting renderer output", async () => {
    const invalidInput = {
      ...input,
      context: { ...input.context, pixelTarget: [0, 1] },
      plan: {
        ...input.plan,
        ownership: { ...input.plan.ownership, ownedContentNodeIds: ["missing-node"] },
        semanticSurfaceId: "other-surface",
        states: { "missing-state": { kind: "capture" } },
      },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await runRendererConformance(goodPlugin, [fixture(invalidInput)]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid-pixel-target",
          "missing-content-node",
          "missing-state-semantics",
          "surface-state-set-mismatch",
          "surface-plan-mismatch",
        ]),
      );
    }
  });

  it("rejects duplicate content nodes in Compiler plans", async () => {
    const duplicateContent = {
      ...input,
      plan: {
        ...input.plan,
        ownership: { ...input.plan.ownership, ownedContentNodeIds: ["frame-root", "frame-root"] },
      },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await executeRendererPlugin(goodPlugin, duplicateContent);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("duplicate-content-node");
    }
  });

  it("rejects context nodes that are not ancestor Frames", async () => {
    const invalid = {
      ...input,
      plan: {
        ...input.plan,
        ownership: {
          contextNodeIds: ["text-title"],
          kind: "structured",
          ownedContentNodeIds: ["frame-root"],
        },
      },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await executeRendererPlugin(goodPlugin, invalid);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toContain("invalid-context-node");
    }
  });
});

const typeContractChecks = (value: CompilerResolvedSurfaceInput) => {
  // @ts-expect-error Compiler-owned semantic input is read-only
  value.surface.id = "changed";
  const result = successfulResult(value);
  if (result.ok) {
    // @ts-expect-error raw captures are not encoded Texture/Asset descriptors
    result.captures[0].checksum = "sha256:encoded";
  }
};

expectTypeOf(typeContractChecks).toBeFunction();
