import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createRendererFingerprint,
  defineRendererPlugin,
  evaluateFirstMilestoneSupport,
  runRendererConformance,
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
      expect(upgradedResult.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(["invalid-renderer-provenance", "renderer-fingerprint-mismatch"]),
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
        interactions: { tap: { id: "tap", kind: "click", event: "advance" } },
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
