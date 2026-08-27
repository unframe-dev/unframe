import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
  type BrowserCaptureRequest,
  type FixedBrowserAdapter,
  type WebRendererConfig,
} from "../src/index.js";
import {
  createRendererFingerprint,
  runRendererConformance,
  type CompilerResolvedSurfaceInput,
} from "@unframe/presentation-renderer-api";

const config = {
  documentBackground: [0, 0, 0, 255],
  fontFamily: "Unframe Fixed",
} as const satisfies WebRendererConfig;

const environment = {
  browser: { id: "test-browser", version: "1", fontFingerprint: "sha256:fonts" },
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  colorSpace: "srgb",
  deviceScaleFactor: 1,
  network: "deny",
  filesystem: "deny",
  clock: "fixed",
  random: "fixed",
} as const;
const adapterIdentity = { id: "test-adapter", implementationHash: "sha256:adapter" } as const;

const inputFor = (rendererConfigHash: string): CompilerResolvedSurfaceInput => {
  const identity = {
    id: "baked-web",
    version: "1",
    contractVersion: "1",
    implementationHash: "unused",
  };
  return {
    surface: {
      id: "surface",
      hostNodeId: "host",
      physicalSizeMeters: [1, 1],
      logicalSize: [100, 50],
      fit: "contain",
      rootFrameId: "root",
      contentNodes: {
        root: {
          id: "root",
          kind: "frame",
          parentId: null,
          order: 0,
          layout: { kind: "absolute" },
          children: ["text"],
        },
        text: {
          id: "text",
          kind: "text",
          parentId: "root",
          order: 0,
          placement: { kind: "absolute", x: 10, y: 5, width: 40, height: 20 },
          text: "<&>\"'",
        },
      },
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      interactions: {},
      initialStateId: "a",
      states: {
        a: { id: "a", semanticOverrides: [], enabledInteractionIds: [] },
        z: { id: "z", semanticOverrides: [], enabledInteractionIds: [] },
      },
      renderIntent: {
        updateModel: { kind: "static" },
        interaction: { kind: "none" },
        internalAnimation: { kind: "none" },
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      },
    },
    sourceIntent: {
      updateModel: { kind: "static" },
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
    resolvedIntent: {
      updateModel: { kind: "static" },
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      selectedRendererId: "baked-web",
      fallbackPolicy: "reject",
    },
    semanticsByState: { a: { rootNodeIds: [], nodes: {} }, z: { rootNodeIds: [], nodes: {} } },
    plan: {
      id: "render",
      semanticSurfaceId: "surface",
      logicalBounds: { x: 0, y: 0, width: 100, height: 50 },
      layer: 0,
      contentNodeIds: ["root", "text"],
      states: { z: { kind: "capture" }, a: { kind: "capture" } },
    },
    entry: { kind: "structured" },
    context: {
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      colorScheme: "dark",
      themeId: "theme",
      themeHash: "sha256:theme",
      inputHash: "sha256:input",
      buildContextHash: "sha256:context",
      environmentHash: "sha256:environment",
      rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(identity, rendererConfigHash),
      pixelTarget: [2, 1],
    },
  } as CompilerResolvedSurfaceInput;
};

const adapter = (requests: BrowserCaptureRequest[] = []): FixedBrowserAdapter => ({
  identity: adapterIdentity,
  environment,
  async capture(request) {
    requests.push(request);
    return {
      rgba: new Uint8Array([0, 1, 2, 255, 3, 4, 5, 255]),
      pixelSize: request.pixelTarget,
      colorSpace: "srgb",
      alphaMode: "opaque",
    };
  },
});

const withRendererFingerprint = (
  input: CompilerResolvedSurfaceInput,
  renderer: ReturnType<typeof createBakedWebRenderer>,
): CompilerResolvedSurfaceInput => ({
  ...input,
  context: {
    ...input.context,
    rendererFingerprint: createRendererFingerprint(
      renderer.identity,
      input.context.rendererConfigHash,
    ),
  },
});

describe("baked web renderer", () => {
  it("固定環境と設定から決定論的な plugin を作り、capture を状態順に生成する", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const hash = createWebRendererConfigHash(config);
    expect(hash).toBe("sha256:e3a9a16a67ed2193c6871e66fafe5f506a833e7f667d3c80ce69215669921d23");
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const input = withRendererFingerprint(inputFor(hash), renderer);
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requests.map((request) => request.stateId)).toEqual(["a", "z"]);
    const firstRequest = requests[0];
    expect(firstRequest).toMatchObject({
      pixelTarget: [2, 1],
      colorScheme: "dark",
      capabilities: { network: "deny", filesystem: "deny", clock: "fixed", random: "fixed" },
    });
    expect(firstRequest?.document).toBe(
      '<!doctype html><html lang="ja-JP"><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#surface{position:relative;width:2px;height:1px;background:rgba(0,0,0,1);font-family:"Unframe Fixed";color-scheme:dark}.text{position:absolute;overflow:hidden;white-space:pre-wrap;box-sizing:border-box}</style></head><body><main id="surface"><div class="text" data-node-id="text" style="left:0.2px;top:0.1px;width:0.8px;height:0.4px">&lt;&amp;&gt;&quot;&#39;</div></main></body></html>',
    );
    expect(result.captures.map((capture) => capture.stateId)).toEqual(["a", "z"]);
    expect(result.hitRegionsByState).toEqual({ a: [], z: [] });
    expect(result.provenance.implementationHash).toMatch(/^sha256:/);
    expect(await runRendererConformance(renderer, [{ name: "web", input }])).toMatchObject({
      valid: true,
    });
  });

  it("adapter へ渡す request を固定し、Compiler input を変更させない", async () => {
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture(request) {
          expect(Object.isFrozen(request)).toBe(true);
          expect(Object.isFrozen(request.pixelTarget)).toBe(true);
          expect(Object.isFrozen(request.environment)).toBe(true);
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: request.pixelTarget,
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const before = JSON.stringify(input);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("作成時の Browser environment と frozen receiver を capture に渡す", async () => {
    const mutableEnvironment = {
      browser: { id: "test-browser", version: "1", fontFingerprint: "sha256:fonts" },
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      colorSpace: "srgb" as const,
      deviceScaleFactor: 1 as const,
      network: "deny" as const,
      filesystem: "deny" as const,
      clock: "fixed" as const,
      random: "fixed" as const,
    };
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment: mutableEnvironment,
        async capture(this: unknown) {
          const receiver = this as { readonly environment: FixedBrowserAdapter["environment"] };
          expect(Object.isFrozen(receiver)).toBe(true);
          expect(receiver.environment.browser.version).toBe("1");
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: [2, 1],
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    mutableEnvironment.browser.version = "changed";
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
  });

  it("visual state 差分と unsafe font config を fail closed にする", async () => {
    expect(() =>
      createWebRendererConfigHash({ documentBackground: [0, 0, 0, 255], fontFamily: "x</style>" }),
    ).toThrow();
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      semanticsByState: {
        ...source.semanticsByState,
        z: {
          rootNodeIds: ["changed"],
          nodes: {
            changed: {
              id: "changed",
              parentId: null,
              order: 0,
              role: "paragraph",
              text: "changed",
            },
          },
        },
      },
    };
    await expect(renderer.build(input)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "unsupported-state-visual-variation" }],
    });
  });

  it("factory config と capture bytes の所有権を固定し、cross-realm Uint8Array を受け取る", async () => {
    const mutableConfig = {
      documentBackground: [0, 0, 0, 255] as [number, number, number, number],
      fontFamily: "Unframe Fixed",
    };
    const requests: BrowserCaptureRequest[] = [];
    const foreignBytes = runInNewContext(
      "new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255])",
    ) as Uint8Array;
    const foreignPixelSize: [number, number] = [2, 1];
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture(request) {
          requests.push(request);
          return {
            rgba: foreignBytes,
            pixelSize: foreignPixelSize,
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config: mutableConfig,
    });
    mutableConfig.documentBackground[0] = 255;
    const input = withRendererFingerprint(
      inputFor(
        createWebRendererConfigHash({
          documentBackground: [0, 0, 0, 255],
          fontFamily: "Unframe Fixed",
        } as const),
      ),
      renderer,
    );
    const result = await renderer.build(input);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(requests[0]?.document).toContain("background:rgba(0,0,0,1)");
    foreignBytes[0] = 99;
    foreignPixelSize[0] = 99;
    expect(result.captures[0]?.rgba[0]).toBe(1);
    expect(result.captures[0]?.pixelSize).toEqual([2, 1]);
  });

  it("factory 作成時の capture 実装を固定し、premultiplied output を拒否する", async () => {
    const mutableAdapter: FixedBrowserAdapter = {
      identity: adapterIdentity,
      environment,
      async capture(request) {
        return {
          rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          pixelSize: request.pixelTarget,
          colorSpace: "srgb",
          alphaMode: "opaque",
        };
      },
    };
    const renderer = createBakedWebRenderer({ adapter: mutableAdapter, config });
    mutableAdapter.capture = async () => {
      throw new Error("replacement must not run");
    };
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    const premultiplied = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture(request) {
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: request.pixelTarget,
            colorSpace: "srgb",
            alphaMode: "premultiplied",
          };
        },
      },
      config,
    });
    await expect(
      premultiplied.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), premultiplied),
      ),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "invalid-browser-capture" }] });
  });

  it("capture の mutable call property を参照せず、非有限 scale を拒否する", async () => {
    const capture: FixedBrowserAdapter["capture"] = async (request) => ({
      rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
      pixelSize: request.pixelTarget,
      colorSpace: "srgb",
      alphaMode: "opaque",
    });
    Object.defineProperty(capture, "call", {
      value: () => Promise.reject(new Error("mutable call must not run")),
    });
    const renderer = createBakedWebRenderer({
      adapter: { identity: adapterIdentity, environment, capture },
      config,
    });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    await expect(
      renderer.build({
        ...input,
        surface: {
          ...input.surface,
          logicalSize: [Number.MIN_VALUE, 50],
          contentNodes: {
            ...input.surface.contentNodes,
            text: {
              id: "text",
              kind: "text",
              parentId: "root",
              order: 0,
              placement: {
                kind: "absolute",
                x: 0,
                y: 0,
                width: Number.MIN_VALUE,
                height: 20,
              },
              text: "scaled",
            },
          },
        },
        plan: {
          ...input.plan,
          logicalBounds: { x: 0, y: 0, width: Number.MIN_VALUE, height: 50 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "invalid-render-scale" }] });
  });

  it("semantic record の挿入順だけが異なる capture states を同値として扱う", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const first = {
      rootNodeIds: ["a", "b"],
      nodes: {
        a: { id: "a", parentId: null, order: 0, role: "paragraph" as const, text: "A" },
        b: { id: "b", parentId: null, order: 1, role: "paragraph" as const, text: "B" },
      },
    };
    const second = {
      rootNodeIds: ["a", "b"],
      nodes: {
        b: { id: "b", parentId: null, order: 1, role: "paragraph" as const, text: "B" },
        a: { id: "a", parentId: null, order: 0, role: "paragraph" as const, text: "A" },
      },
    };
    await expect(
      renderer.build({ ...source, semanticsByState: { a: first, z: second } }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("設定 hash の不一致、adapter failure、hostile capture を診断に変換する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const mismatch = await renderer.build(inputFor("sha256:other"));
    expect(mismatch).toMatchObject({ ok: false });
    if (!mismatch.ok) expect(mismatch.diagnostics[0]?.code).toBe("renderer-fingerprint-mismatch");
    const fails = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture() {
          throw new Error("no");
        },
      },
      config,
    });
    const failedInput = withRendererFingerprint(
      inputFor(createWebRendererConfigHash(config)),
      fails,
    );
    await expect(fails.build(failedInput)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "browser-capture-failed" }],
    });
    const hostile = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture() {
          return {
            rgba: new Uint8Array(1),
            pixelSize: [2, 1],
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    const hostileInput = withRendererFingerprint(
      inputFor(createWebRendererConfigHash(config)),
      hostile,
    );
    await expect(hostile.build(hostileInput)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-browser-capture" }],
    });
  });

  it("直接 build の capability と compiler input 境界を検証する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(
      renderer.build({ ...input, entry: { kind: "opaque", entryId: "x", moduleHash: "x" } }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "unsupported-input-kind" }],
    });
    await expect(
      renderer.build({ ...input, context: { ...input.context, rendererFingerprint: "bad" } }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "renderer-fingerprint-mismatch" }],
    });
    await expect(
      renderer.build({
        ...input,
        plan: { ...input.plan, logicalBounds: { x: 0, y: 0, width: 0, height: 1 } },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "invalid-logical-bounds" }] });
    await expect(
      renderer.build({ ...input, plan: { ...input.plan, semanticSurfaceId: "other" } }),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "surface-plan-mismatch" }] });
  });

  it("adapter identity を implementation hash に含め、固定する", async () => {
    const first = createBakedWebRenderer({ adapter: adapter(), config });
    const second = createBakedWebRenderer({
      adapter: {
        identity: { id: "test-adapter", implementationHash: "sha256:other" },
        environment,
        async capture(request) {
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: request.pixelTarget,
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    expect(first.identity.implementationHash).not.toBe(second.identity.implementationHash);
    const invalid = createBakedWebRenderer({
      adapter: { environment, capture: async () => ({}) } as unknown as FixedBrowserAdapter,
      config,
    });
    await expect(
      invalid.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), invalid),
      ),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-browser-environment" }],
    });
  });

  it("任意の own state ID に空 hit region を作成する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    expect(Object.isFrozen(renderer)).toBe(true);
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const states = Object.create(null);
    const surfaceStates = Object.create(null);
    const semantics = Object.create(null);
    Object.defineProperty(states, "__proto__", { value: { kind: "capture" }, enumerable: true });
    Object.defineProperty(surfaceStates, "__proto__", {
      value: { id: "__proto__", semanticOverrides: [], enabledInteractionIds: [] },
      enumerable: true,
    });
    Object.defineProperty(semantics, "__proto__", {
      value: { rootNodeIds: [], nodes: {} },
      enumerable: true,
    });
    const result = await renderer.build({
      ...input,
      surface: { ...input.surface, initialStateId: "__proto__", states: surfaceStates },
      plan: { ...input.plan, states },
      semanticsByState: semantics,
    } as CompilerResolvedSurfaceInput);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(Object.hasOwn(result.hitRegionsByState, "__proto__")).toBe(true);
  });

  it("config と opaque capture の厳格な byte 境界を検証する", async () => {
    const sparse = Object.assign([], { length: 4, 0: 0, 2: 0, 3: 255 }) as number[];
    expect(() =>
      createWebRendererConfigHash({
        documentBackground: sparse,
        fontFamily: "x",
      } as unknown as WebRendererConfig),
    ).toThrow();
    expect(
      createWebRendererConfigHash({ documentBackground: [0, 0, 0, 255], fontFamily: " x " }),
    ).toBe(createWebRendererConfigHash({ documentBackground: [0, 0, 0, 255], fontFamily: "x" }));
    const opaque = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture(request) {
          return {
            rgba: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 255]),
            pixelSize: request.pixelTarget,
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    await expect(
      opaque.build(withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), opaque)),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-browser-capture" }],
    });
  });

  it("config、environment、pixel size の descriptor snapshot で TOCTOU を遮断する", async () => {
    let configReads = 0;
    const hostileConfig = new Proxy(config, {
      get(target, property, receiver) {
        configReads++;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() =>
      createWebRendererConfigHash(hostileConfig as unknown as WebRendererConfig),
    ).not.toThrow();
    expect(configReads).toBe(0);

    let environmentReads = 0;
    const hostileEnvironment = new Proxy(environment, {
      get(target, property, receiver) {
        environmentReads++;
        return Reflect.get(target, property, receiver);
      },
    });
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment: hostileEnvironment,
        async capture() {
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: new Proxy([2, 1], {
              get() {
                throw new Error("pixel size must not be read as a value");
              },
            }),
            colorSpace: "srgb",
            alphaMode: "opaque",
          } as unknown as import("../src/index.js").BrowserRgbaCapture;
        },
      },
      config,
    });
    expect(environmentReads).toBe(0);
    await expect(
      renderer.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("intrinsic RGBA copy は byteLength と iterator の shadow を実行しない", async () => {
    let byteLengthReads = 0;
    let iteratorReads = 0;
    class HostileBytes extends Uint8Array {
      override get byteLength(): number {
        byteLengthReads++;
        return super.byteLength;
      }

      override [Symbol.iterator](): ArrayIterator<number> {
        iteratorReads++;
        return super[Symbol.iterator]();
      }
    }
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        capture: () => ({
          rgba: new HostileBytes([0, 0, 0, 255, 0, 0, 0, 255]),
          pixelSize: [2, 1],
          colorSpace: "srgb",
          alphaMode: "opaque",
        }),
      },
      config,
    });
    await expect(
      renderer.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(byteLengthReads).toBe(0);
    expect(iteratorReads).toBe(0);
  });

  it("Uint8Array 以外の ArrayBuffer view を RGBA として拒否する", async () => {
    for (const rgba of [
      new Uint8ClampedArray(8),
      new Uint16Array(4),
      new DataView(new ArrayBuffer(8)),
    ]) {
      const renderer = createBakedWebRenderer({
        adapter: {
          identity: adapterIdentity,
          environment,
          capture: () =>
            ({ rgba, pixelSize: [2, 1], colorSpace: "srgb", alphaMode: "opaque" }) as never,
        },
        config,
      });
      await expect(
        renderer.build(
          withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer),
        ),
      ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: "invalid-browser-capture" }] });
    }
  });

  it("malformed Text node は Browser capture 前に shared validator が拒否する", async () => {
    let captures = 0;
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        capture: () => {
          captures++;
          return {
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
            pixelSize: [2, 1],
            colorSpace: "srgb" as const,
            alphaMode: "opaque" as const,
          };
        },
      },
      config,
    });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const malformed = {
      ...source,
      surface: {
        ...source.surface,
        contentNodes: {
          ...source.surface.contentNodes,
          text: { ...source.surface.contentNodes.text, text: 1 },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;
    await expect(renderer.build(malformed)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-renderer-input" }],
    });
    expect(captures).toBe(0);
  });

  it("capabilities を deep freeze し、capture getter を読まずに拒否する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    expect(Object.isFrozen(renderer.capabilities)).toBe(true);
    expect(Object.isFrozen(renderer.capabilities.inputKinds)).toBe(true);
    let reads = 0;
    const hostile = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        async capture() {
          return Object.defineProperty({}, "rgba", {
            get() {
              reads++;
              return new Uint8Array(8);
            },
          }) as unknown as import("../src/index.js").BrowserRgbaCapture;
        },
      },
      config,
    });
    await expect(
      hostile.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), hostile),
      ),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-browser-capture" }],
    });
    expect(reads).toBe(0);
  });

  it("inherited または getter の Browser environment を安全に拒否する", async () => {
    const inheritedEnvironment = Object.create(environment);
    const inherited = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment: inheritedEnvironment,
        async capture() {
          throw new Error("must not run");
        },
      } as unknown as FixedBrowserAdapter,
      config,
    });
    await expect(
      inherited.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), inherited),
      ),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "invalid-browser-environment" }],
    });
    const hostileAdapter = Object.defineProperty(
      { identity: adapterIdentity, capture: async () => ({}) },
      "environment",
      {
        get() {
          throw new Error("getter");
        },
      },
    ) as unknown as FixedBrowserAdapter;
    expect(() => createBakedWebRenderer({ adapter: hostileAdapter, config })).not.toThrow();
  });

  it("公開型を固定する", () => {
    expectTypeOf(createWebRendererConfigHash).returns.toEqualTypeOf<string>();
    expectTypeOf(createBakedWebRenderer).returns.toMatchTypeOf<{ build: Function }>();
  });
});
