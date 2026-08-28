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

const identity = {
  id: "baked-web",
  version: "1.0.0",
  contractVersion: "1",
  implementationHash: "sha256:renderer",
} as const;

const rendererConfigHash = "sha256:renderer-config";

const capabilities = {
  inputKinds: ["structured"],
  updateModels: ["static"],
  interactions: ["none"],
  internalAnimations: ["none"],
  rendererPreferences: ["baked-web"],
  fallbackPolicies: ["reject"],
  deterministic: true,
} as const satisfies RendererCapabilities;

const input = {
  surface: {
    id: "surface-title",
    hostNodeId: "surface-node-title",
    physicalSizeMeters: [1.6, 0.9],
    logicalSize: [1920, 1080],
    fit: "contain",
    rootFrameId: "frame-root",
    contentNodes: {
      "frame-root": {
        id: "frame-root",
        kind: "frame",
        parentId: null,
        order: 0,
        layout: { kind: "absolute" },
        children: ["text-title"],
      },
      "text-title": {
        id: "text-title",
        kind: "text",
        parentId: "frame-root",
        order: 0,
        placement: { kind: "absolute", x: 120, y: 80, width: 1680, height: 200 },
        text: "Hello",
      },
    },
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
    initialStateId: "state-default",
    states: {
      "state-default": {
        id: "state-default",
        semanticOverrides: [],
        enabledInteractionIds: [],
      },
    },
    renderIntent: {
      updateModel: { kind: "static" },
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      rendererPreference: "auto",
      fallbackPolicy: "reject",
    },
  },
  sourceIntent: {
    updateModel: { kind: "static" },
    interaction: { kind: "none" },
    internalAnimation: { kind: "none" },
    rendererPreference: "auto",
    fallbackPolicy: "reject",
  },
  resolvedIntent: {
    updateModel: { kind: "static" },
    interaction: { kind: "none" },
    internalAnimation: { kind: "none" },
    selectedRendererId: "baked-web",
    fallbackPolicy: "reject",
  },
  semanticsByState: {
    "state-default": {
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
  },
  plan: {
    id: "render-surface-title",
    semanticSurfaceId: "surface-title",
    logicalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    layer: 0,
    contentNodeIds: ["frame-root", "text-title"],
    states: { "state-default": { kind: "capture" } },
  },
  entry: { kind: "structured" },
  context: {
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    colorScheme: "dark",
    themeId: "theme-default",
    themeHash: "sha256:theme",
    inputHash: "sha256:input",
    buildContextHash: "sha256:context",
    environmentHash: "sha256:environment",
    rendererConfigHash,
    rendererFingerprint: createRendererFingerprint(identity, rendererConfigHash),
    pixelTarget: [2, 1],
  },
} as const satisfies CompilerResolvedSurfaceInput;

const fixture = (value: CompilerResolvedSurfaceInput = input): RendererConformanceFixture => ({
  name: "title-surface",
  input: value,
});

const provenance = (value: CompilerResolvedSurfaceInput) => ({
  ...identity,
  inputHash: value.context.inputHash,
  buildContextHash: value.context.buildContextHash,
  environmentHash: value.context.environmentHash,
  rendererConfigHash: value.context.rendererConfigHash,
  rendererFingerprint: value.context.rendererFingerprint,
});

const renderSurface = (value: CompilerResolvedSurfaceInput) => ({
  id: value.plan.id,
  semanticSurfaceId: value.plan.semanticSurfaceId,
  logicalBounds: value.plan.logicalBounds,
  layer: value.plan.layer,
});

const successfulResult = (value: CompilerResolvedSurfaceInput): RendererBuildResult => ({
  ok: true,
  renderSurface: renderSurface(value),
  captures: Object.entries(value.plan.states)
    .filter(([, statePlan]) => statePlan.kind === "capture")
    .map(([stateId]) => ({
      id: `capture-${stateId}`,
      stateId,
      rgba: new Uint8Array(value.context.pixelTarget[0] * value.context.pixelTarget[1] * 4),
      pixelSize: value.context.pixelTarget,
      colorSpace: "srgb" as const,
      alphaMode: "straight" as const,
    })),
  hitRegionsByState: Object.fromEntries(
    Object.keys(value.plan.states).map((stateId) => [stateId, []]),
  ),
  provenance: provenance(value),
  diagnostics: [],
});

const goodPlugin = defineRendererPlugin({
  identity,
  capabilities,
  support: evaluateFirstMilestoneSupport,
  build: (value) => {
    const support = evaluateFirstMilestoneSupport({
      entry: value.entry,
      resolvedIntent: value.resolvedIntent,
    });
    return support.supported
      ? successfulResult(value)
      : { ok: false, diagnostics: support.diagnostics };
  },
});

describe("first-milestone plugin contract", () => {
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
    const textTarget = { ...source.surface.contentNodes["text-title"] } as { text?: unknown };
    const contentNodesTarget = {
      ...source.surface.contentNodes,
      "text-title": denyGet(textTarget),
    };
    const surfaceTarget = {
      ...source.surface,
      contentNodes: denyGet(contentNodesTarget),
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
      textTarget.text = "Mutated after preparation";
      expect(prepared.value.context.locale).toBe("ja-JP");
      const preparedText = prepared.value.surface.contentNodes["text-title"];
      expect(preparedText?.kind).toBe("text");
      if (preparedText?.kind === "text") expect(preparedText.text).toBe("Hello");
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

  it.each([
    [
      "frame children is missing",
      () => ({
        ...input,
        surface: {
          ...input.surface,
          contentNodes: {
            ...input.surface.contentNodes,
            "frame-root": (() => {
              const { children: _children, ...frame } = input.surface.contentNodes["frame-root"];
              return frame;
            })(),
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
          contentNodes: {
            ...input.surface.contentNodes,
            "frame-root": { ...input.surface.contentNodes["frame-root"], children: ["unknown"] },
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
          contentNodes: {
            ...input.surface.contentNodes,
            "text-title": {
              ...input.surface.contentNodes["text-title"],
              placement: { kind: "absolute", x: 120, y: 80, width: 1680 },
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
          contentNodes: {
            ...input.surface.contentNodes,
            "text-title": {
              ...input.surface.contentNodes["text-title"],
              placement: { x: 120, y: 80, width: 1680, height: 200 },
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
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-renderer-input", path: [] }),
      );
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
      valid: false,
      diagnostics: [expect.objectContaining({ code: "invalid-renderer-input" })],
    });
  });

  it.each([
    ["invalid color scheme", { ...input, context: { ...input.context, colorScheme: "invalid" } }],
    ["empty surface host", { ...input, surface: { ...input.surface, hostNodeId: "" } }],
    [
      "duplicate finite states",
      {
        ...input,
        surface: {
          ...input.surface,
          renderIntent: {
            ...input.surface.renderIntent,
            updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
          },
        },
        sourceIntent: {
          ...input.sourceIntent,
          updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
        },
        resolvedIntent: {
          ...input.resolvedIntent,
          updateModel: { kind: "finite-state", stateIds: ["state-default", "state-default"] },
        },
      },
    ],
    [
      "semantic cycle",
      {
        ...input,
        semanticsByState: {
          "state-default": {
            rootNodeIds: [],
            nodes: {
              a: { id: "a", parentId: "b", order: 0, role: "paragraph" },
              b: { id: "b", parentId: "a", order: 0, role: "paragraph" },
            },
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
          interactions: { tap: { id: "tap", kind: "click", event: "advance" } },
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
          contentNodes: {
            ...input.surface.contentNodes,
            detached: {
              id: "detached",
              kind: "frame",
              parentId: null,
              order: 1,
              layout: { kind: "absolute" },
              children: [],
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
          contentNodes: {
            ...input.surface.contentNodes,
            "text-title": {
              ...input.surface.contentNodes["text-title"],
              parentId: null,
              order: 2,
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

  it("RGBA output の偽装 brand と iterator を実行せず拒否する", async () => {
    let iteratorCalls = 0;
    const bytes = new Uint8ClampedArray(8);
    Object.defineProperties(bytes, {
      [Symbol.toStringTag]: { value: "Uint8Array" },
      [Symbol.iterator]: {
        value() {
          iteratorCalls++;
          throw new Error("must not iterate hostile bytes");
        },
      },
    });
    const hostile = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) return result;
        return {
          ...result,
          captures: [{ ...result.captures[0]!, rgba: bytes as unknown as Uint8Array }],
        };
      },
    });
    const result = await runRendererConformance(hostile, [fixture()]);
    expect(result.valid).toBe(false);
    expect(iteratorCalls).toBe(0);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
  });

  it("sparse failure diagnostics と不透明でない opaque capture を拒否する", async () => {
    const sparseFailure = defineRendererPlugin({
      ...goodPlugin,
      build: () =>
        ({
          ok: false,
          diagnostics: Object.assign([], { length: 1 }),
        }) as RendererBuildResult,
    });
    const sparseResult = await runRendererConformance(sparseFailure, [fixture()]);
    expect(sparseResult.valid).toBe(false);
    if (!sparseResult.valid)
      expect(sparseResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-renderer-output",
      );

    const invalidOpaque = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) return result;
        const rgba = new Uint8Array(result.captures[0]!.rgba);
        rgba[3] = 1;
        return {
          ...result,
          captures: [{ ...result.captures[0]!, rgba, alphaMode: "opaque" as const }],
        };
      },
    });
    const opaqueResult = await runRendererConformance(invalidOpaque, [fixture()]);
    expect(opaqueResult.valid).toBe(false);
    if (!opaqueResult.valid)
      expect(opaqueResult.diagnostics.map(({ code }) => code)).toContain("invalid-opaque-alpha");
  });

  it("sparse または非有限な diagnostic path を拒否する", async () => {
    const sparsePath = Object.assign([], { length: 1 }) as unknown as (string | number)[];
    for (const path of [sparsePath, [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      const plugin = defineRendererPlugin({
        ...goodPlugin,
        build: () => ({
          ok: false as const,
          diagnostics: [{ code: "failure", message: "failure", path }],
        }),
      });
      const result = await runRendererConformance(plugin, [fixture()]);
      expect(result.valid).toBe(false);
      if (!result.valid)
        expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
    }
  });

  it("Zod boundary は build output の accessor と未知 field を実行せず拒否する", async () => {
    let accessorReads = 0;
    const hostileOutput = defineRendererPlugin({
      ...goodPlugin,
      build(value: CompilerResolvedSurfaceInput): RendererBuildResult {
        const result = successfulResult(value);
        if (!result.ok) return result;
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
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
  });

  it("固定した method の mutable call property を参照しない", async () => {
    const support = (request: Parameters<typeof goodPlugin.support>[0]) =>
      evaluateFirstMilestoneSupport(request);
    const build = (value: CompilerResolvedSurfaceInput) => successfulResult(value);
    Object.defineProperty(support, "call", { value: () => Promise.reject(new Error("unused")) });
    Object.defineProperty(build, "call", { value: () => Promise.reject(new Error("unused")) });
    const plugin = defineRendererPlugin({ ...goodPlugin, support, build });
    await expect(executeRendererPlugin(plugin, input)).resolves.toMatchObject({ valid: true });
  });

  it("公開入力validatorは hostile input を実行せず診断化する", () => {
    expect(validateRendererBuildInput(null, {})).toMatchObject([
      { code: "invalid-renderer-plugin" },
    ]);
    expect(validateRendererBuildInput({ plan: {} }, { identity, capabilities })).toMatchObject([
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
    const sparsePixelTarget = [2, undefined] as unknown as number[];
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
        contentNodes: {
          ...input.surface.contentNodes,
          "text-title": { ...input.surface.contentNodes["text-title"], text: 1 },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;
    expect(validateRendererBuildInput(malformedText, goodPlugin)).toContainEqual(
      expect.objectContaining({ code: "invalid-renderer-input", path: [] }),
    );
    const malformedFixture = await runRendererConformance(goodPlugin, [
      { name: "malformed-fixture", input: malformedText },
    ]);
    expect(malformedFixture.valid).toBe(false);
    if (!malformedFixture.valid)
      expect(malformedFixture.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "invalid-renderer-input",
          path: ["malformed-fixture", "input"],
        }),
      );
    const sparseCapabilities = [undefined] as unknown as string[];
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
    if (!execution.valid)
      expect(execution.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "source-render-intent-mismatch",
          path: ["single", "input", "sourceIntent"],
        }),
      );
    const result = await runRendererConformance(goodPlugin, [
      { name: "fixture-a", input: invalid },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "source-render-intent-mismatch",
          path: ["fixture-a", "input", "sourceIntent"],
        }),
      );
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
      support: () => {
        throw new Error("no");
      },
      build: () => {
        calls++;
        return successfulResult(input);
      },
    };
    expect((await executeRendererPlugin(plugin, input)).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it("stops before build when support mutates input", async () => {
    let calls = 0;
    const plugin = {
      ...goodPlugin,
      support: () => {
        (input.plan.states as Record<string, unknown>).changed = {};
        return evaluateFirstMilestoneSupport({
          entry: input.entry,
          resolvedIntent: input.resolvedIntent,
        });
      },
      build: () => {
        calls++;
        return successfulResult(input);
      },
    };
    const result = await executeRendererPlugin(plugin, input);
    delete (input.plan.states as Record<string, unknown>).changed;
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).not.toContain("renderer-mutated-input");
    expect(calls).toBe(1);
  });
  it("does not build unsupported input", async () => {
    let calls = 0;
    const unsupported = {
      ...input,
      entry: { kind: "opaque" as const, entryId: "x", moduleHash: "h" },
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
      support: () => {
        calls++;
        return { supported: true, diagnostics: [] } as const;
      },
      build: () => successfulResult(input),
    };
    expect((await executeRendererPlugin(plugin, invalid)).valid).toBe(false);
    expect(calls).toBe(0);
  });
  it("does not invoke conformance plugins for invalid inputs", async () => {
    let supportCalls = 0;
    let buildCalls = 0;
    const invalid = {
      ...input,
      plan: { ...input.plan, contentNodeIds: ["missing-node"] },
    } as const satisfies CompilerResolvedSurfaceInput;
    const plugin = {
      ...goodPlugin,
      support: () => {
        supportCalls++;
        return { supported: true, diagnostics: [] } as const;
      },
      build: () => {
        buildCalls++;
        return successfulResult(input);
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
        renderSurface: { id: "render-surface-title", semanticSurfaceId: "surface-title" },
        provenance: identity,
      });
    }
  });

  it("rejects unsupported input and intent variants with stable decisions", () => {
    expect(
      evaluateFirstMilestoneSupport({
        entry: { kind: "opaque", entryId: "chart", moduleHash: "h" },
        resolvedIntent: input.resolvedIntent,
      }),
    ).toMatchObject({ supported: false, diagnostics: [{ code: "unsupported-input-kind" }] });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: {
          ...input.resolvedIntent,
          interaction: { kind: "regions", events: ["click"] },
        },
      }),
    ).toMatchObject({ supported: false, diagnostics: [{ code: "unsupported-interaction" }] });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: {
          ...input.resolvedIntent,
          updateModel: { kind: "continuous", source: "timeline" },
        },
      }),
    ).toMatchObject({ supported: false, diagnostics: [{ code: "unsupported-update-model" }] });
    expect(
      evaluateFirstMilestoneSupport({
        entry: input.entry,
        resolvedIntent: { ...input.resolvedIntent, selectedRendererId: "video" },
      }),
    ).toMatchObject({
      supported: false,
      diagnostics: [{ code: "unsupported-renderer" }],
    });
  });

  it("conforms when unsupported inputs return diagnostic failures", async () => {
    const opaque = {
      ...input,
      entry: { kind: "opaque", entryId: "chart", moduleHash: "sha256:module" },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await runRendererConformance(goodPlugin, [fixture(opaque)]);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value[0]).toMatchObject({ ok: false });
  });

  it("rejects implicit fallback from an explicit renderer preference", async () => {
    const explicitNative = {
      ...input,
      surface: {
        ...input.surface,
        renderIntent: { ...input.surface.renderIntent, rendererPreference: "native-ui" },
      },
      sourceIntent: { ...input.sourceIntent, rendererPreference: "native-ui" },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await runRendererConformance(goodPlugin, [fixture(explicitNative)]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("renderer-preference-mismatch");
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

  it("rejects inherited state, content, and Hit Region entries", async () => {
    const inheritedSemantics = Object.create({
      "state-default": input.semanticsByState["state-default"],
    }) as CompilerResolvedSurfaceInput["semanticsByState"];
    const inheritedContentNodes = Object.create({
      "text-title": input.surface.contentNodes["text-title"],
    }) as CompilerResolvedSurfaceInput["surface"]["contentNodes"];
    const inheritedInput = {
      ...input,
      surface: { ...input.surface, contentNodes: inheritedContentNodes },
      semanticsByState: inheritedSemantics,
    } as const satisfies CompilerResolvedSurfaceInput;
    const inputResult = await executeRendererPlugin(goodPlugin, inheritedInput);
    expect(inputResult.valid).toBe(false);
    if (!inputResult.valid)
      expect(inputResult.diagnostics.map(({ code }) => code)).toContain("invalid-renderer-input");

    const inheritedHitRegions = withBuild((value) => ({
      ...successfulResult(value),
      hitRegionsByState: Object.create({ "state-default": [] }),
    }));
    const outputResult = await runRendererConformance(inheritedHitRegions, [fixture()]);
    expect(outputResult.valid).toBe(false);
    if (!outputResult.valid)
      expect(outputResult.diagnostics.map(({ code }) => code)).toContain(
        "missing-state-hit-regions",
      );
  });

  it("detects RGBA length, state completeness, duplicate IDs, and provenance drift", async () => {
    const invalid = withBuild((value) => ({
      ok: true,
      renderSurface: renderSurface(value),
      captures: [
        {
          id: "duplicate",
          stateId: "state-default",
          rgba: new Uint8Array(1),
          pixelSize: [2, 1],
          colorSpace: "srgb",
          alphaMode: "straight",
        },
        {
          id: "duplicate",
          stateId: "state-default",
          rgba: new Uint8Array(8),
          pixelSize: [2, 1],
          colorSpace: "srgb",
          alphaMode: "straight",
        },
      ],
      hitRegionsByState: {},
      provenance: { ...provenance(value), environmentHash: "wrong" },
      diagnostics: [],
    }));

    const result = await runRendererConformance(invalid, [fixture()]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "duplicate-capture-id",
          "invalid-rgba-length",
          "invalid-renderer-provenance",
          "missing-state-hit-regions",
          "state-capture-mismatch",
        ]),
      );
  });

  it("detects input mutation, thrown errors, and support/build disagreement", async () => {
    const mutable = structuredClone(input) as unknown as CompilerResolvedSurfaceInput;
    const mutating = withBuild((value) => {
      (value.plan as { layer: number }).layer = 2;
      return successfulResult(value);
    });
    const mutation = await runRendererConformance(mutating, [fixture(mutable)]);
    expect(mutation.valid).toBe(false);
    if (!mutation.valid)
      expect(mutation.diagnostics.map(({ code }) => code)).toContain("renderer-mutated-input");

    const throwing = withBuild(() => {
      throw new Error("browser crashed");
    });
    const thrown = await runRendererConformance(throwing, [fixture()]);
    expect(thrown.valid).toBe(false);
    if (!thrown.valid)
      expect(thrown.diagnostics.map(({ code }) => code)).toContain("renderer-threw");

    const supportThrowing: RendererPlugin = {
      ...goodPlugin,
      support: () => {
        throw new Error("support crashed");
      },
    };
    const supportThrown = await runRendererConformance(supportThrowing, [fixture()]);
    expect(supportThrown.valid).toBe(false);
    if (!supportThrown.valid)
      expect(supportThrown.diagnostics.map(({ code }) => code)).toContain("renderer-support-threw");

    const disagreeing = withBuild(() => ({ ok: false, diagnostics: [] }));
    const disagreement = await runRendererConformance(disagreeing, [fixture()]);
    expect(disagreement.valid).toBe(false);
    if (!disagreement.valid)
      expect(disagreement.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(["missing-failure-diagnostic", "support-build-mismatch"]),
      );
  });

  it("reports malformed support and build values without throwing", async () => {
    const malformedSupport: RendererPlugin = {
      ...goodPlugin,
      support: () => null as never,
    };
    const supportResult = await runRendererConformance(malformedSupport, [fixture()]);
    expect(supportResult.valid).toBe(false);
    if (!supportResult.valid)
      expect(supportResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-support-decision",
      );

    const malformedBuild = withBuild(() => null as never);
    const buildResult = await runRendererConformance(malformedBuild, [fixture()]);
    expect(buildResult.valid).toBe(false);
    if (!buildResult.valid)
      expect(buildResult.diagnostics.map(({ code }) => code)).toContain(
        "malformed-renderer-output",
      );

    const nonByteCapture = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) return result;
      return {
        ...result,
        captures: [{ ...result.captures[0], rgba: Array(8).fill(0) }],
      } as never;
    });
    const byteResult = await runRendererConformance(nonByteCapture, [fixture()]);
    expect(byteResult.valid).toBe(false);
    if (!byteResult.valid)
      expect(byteResult.diagnostics.map(({ code }) => code)).toContain("malformed-renderer-output");
  });

  it("accepts Uint8Array bytes restored from another JavaScript realm", async () => {
    const crossRealmBytes = runInNewContext("new Uint8Array(8)") as Uint8Array;
    expect(crossRealmBytes).not.toBeInstanceOf(Uint8Array);
    const crossRealmRenderer = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) return result;
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
    if (!staleResult.valid)
      expect(staleResult.diagnostics.map(({ code }) => code)).toContain(
        "renderer-fingerprint-mismatch",
      );

    const upgradedPlugin = defineRendererPlugin({
      ...goodPlugin,
      identity: { ...identity, version: "2.0.0" },
    });
    const upgradedResult = await runRendererConformance(upgradedPlugin, [fixture()]);
    expect(upgradedResult.valid).toBe(false);
    if (!upgradedResult.valid)
      expect(upgradedResult.diagnostics.map(({ code }) => code)).toContain(
        "renderer-fingerprint-mismatch",
      );
  });

  it("detects non-deterministic bytes and produces stable diagnostic ordering", async () => {
    let byte = 0;
    const nondeterministic = withBuild((value) => {
      const result = successfulResult(value);
      if (result.ok) result.captures[0]?.rgba.fill(byte++);
      return result;
    });

    const first = await runRendererConformance(nondeterministic, [fixture()]);
    byte = 0;
    const second = await runRendererConformance(nondeterministic, [fixture()]);
    expect(first.valid).toBe(false);
    expect(second).toEqual(first);
    if (!first.valid)
      expect(first.diagnostics.map(({ code }) => code)).toContain(
        "non-deterministic-renderer-output",
      );
  });

  it("detects non-determinism when builds reuse and mutate the same byte buffer", async () => {
    const sharedBytes = new Uint8Array(8);
    let byte = 0;
    const sharedBufferRenderer = withBuild((value) => {
      sharedBytes.fill(byte++);
      const result = successfulResult(value);
      if (!result.ok) return result;
      return {
        ...result,
        captures: [{ ...result.captures[0], rgba: sharedBytes }],
      } as RendererBuildResult;
    });

    const result = await runRendererConformance(sharedBufferRenderer, [fixture()]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "non-deterministic-renderer-output",
      );
  });

  it("validates normalized Hit Region geometry and semantic references", async () => {
    const invalidHitRegion = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) return result;
      return {
        ...result,
        hitRegionsByState: {
          "state-default": [
            {
              interactionId: "missing-interaction",
              semanticNodeId: "missing-node",
              bounds: { x: 0.9, y: 0, width: 0.2, height: 1 },
              coordinateSpace: "normalized",
              event: "missing-event",
              priority: -1,
            },
          ],
        },
      };
    });

    const result = await runRendererConformance(invalidHitRegion, [fixture()]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid-hit-region-bounds",
          "invalid-hit-region-interaction",
          "invalid-hit-region-priority",
          "invalid-hit-region-semantic-node",
        ]),
      );
  });

  it("requires exact enabled-interaction coverage and semantic binding", async () => {
    const interactiveSurface = {
      ...input,
      surface: {
        ...input.surface,
        interactions: {
          tap: { id: "tap", kind: "click", event: "advance" },
          other: { id: "other", kind: "click", event: "other" },
        },
        baseSemanticTree: {
          rootNodeIds: ["semantic-title"],
          nodes: {
            "semantic-title": {
              ...input.surface.baseSemanticTree.nodes["semantic-title"],
              interactionId: "other",
            },
          },
        },
        states: {
          "state-default": {
            ...input.surface.states["state-default"],
            enabledInteractionIds: [],
          },
        },
      },
      semanticsByState: {
        "state-default": {
          rootNodeIds: ["semantic-title"],
          nodes: {
            "semantic-title": {
              ...input.semanticsByState["state-default"].nodes["semantic-title"],
              interactionId: "other",
            },
          },
        },
      },
    } as const satisfies CompilerResolvedSurfaceInput;
    const invalidBinding = withBuild((value) => {
      const result = successfulResult(value);
      if (!result.ok) return result;
      return {
        ...result,
        hitRegionsByState: {
          "state-default": [
            {
              interactionId: "tap",
              semanticNodeId: "semantic-title",
              bounds: { x: 0, y: 0, width: 1, height: 1 },
              coordinateSpace: "normalized",
              event: "advance",
              priority: 0,
            },
          ],
        },
      };
    });

    const bindingResult = await runRendererConformance(invalidBinding, [
      fixture(interactiveSurface),
    ]);
    expect(bindingResult.valid).toBe(false);
    if (!bindingResult.valid)
      expect(bindingResult.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid-hit-region-interaction",
          "invalid-hit-region-semantic-node",
          "unexpected-hit-region",
        ]),
      );

    const enabledWithoutRegion = {
      ...interactiveSurface,
      surface: {
        ...interactiveSurface.surface,
        states: {
          "state-default": {
            ...interactiveSurface.surface.states["state-default"],
            enabledInteractionIds: ["tap"],
          },
        },
      },
    } as const satisfies CompilerResolvedSurfaceInput;
    const coverageResult = await runRendererConformance(goodPlugin, [
      fixture(enabledWithoutRegion),
    ]);
    expect(coverageResult.valid).toBe(false);
    if (!coverageResult.valid)
      expect(coverageResult.diagnostics.map(({ code }) => code)).toContain(
        "missing-enabled-interaction-region",
      );
  });

  it("validates Compiler plans before accepting renderer output", async () => {
    const invalidInput = {
      ...input,
      plan: {
        ...input.plan,
        semanticSurfaceId: "other-surface",
        contentNodeIds: ["missing-node"],
        states: { "missing-state": { kind: "capture" } },
      },
      context: { ...input.context, pixelTarget: [0, 1] },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await runRendererConformance(goodPlugin, [fixture(invalidInput)]);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid-pixel-target",
          "missing-content-node",
          "missing-state-semantics",
          "surface-state-set-mismatch",
          "surface-plan-mismatch",
        ]),
      );
  });

  it("rejects duplicate content nodes in Compiler plans", async () => {
    const duplicateContent = {
      ...input,
      plan: {
        ...input.plan,
        contentNodeIds: ["frame-root", "frame-root"],
      },
    } as const satisfies CompilerResolvedSurfaceInput;

    const result = await executeRendererPlugin(goodPlugin, duplicateContent);

    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("duplicate-content-node");
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
