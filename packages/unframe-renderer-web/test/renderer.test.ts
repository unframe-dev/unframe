import { runInNewContext } from "node:vm";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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
  executeRendererPlugin,
  runRendererConformance,
  type CompilerResolvedSurfaceInput,
} from "@unframe/unframe-renderer-api";

const config = {
  documentBackground: [0, 0, 0, 255],
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

const testFontAsset = (characters: string) => {
  const codePoints = [...new Set(Array.from(characters, (value) => value.codePointAt(0)!))].sort(
    (left, right) => left - right,
  );
  const cmapLength = 12 + 16 + codePoints.length * 12;
  const bytes = new Uint8Array(28 + cmapLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x0001_0000);
  view.setUint16(4, 1);
  bytes.set(new TextEncoder().encode("cmap"), 12);
  view.setUint32(20, 28);
  view.setUint32(24, cmapLength);
  view.setUint16(30, 1);
  view.setUint16(32, 3);
  view.setUint16(34, 10);
  view.setUint32(36, 12);
  view.setUint16(40, 12);
  view.setUint32(44, 16 + codePoints.length * 12);
  view.setUint32(52, codePoints.length);
  codePoints.forEach((codePoint, index) => {
    const offset = 56 + index * 12;
    view.setUint32(offset, codePoint);
    view.setUint32(offset + 4, codePoint);
    view.setUint32(offset + 8, index + 1);
  });
  return {
    mediaType: "font/ttf" as const,
    dataBase64: Buffer.from(bytes).toString("base64"),
    checksum: `sha256:${bytesToHex(sha256(bytes))}`,
  };
};

const fontMain = testFontAsset("<&>\"'");

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
          visible: true,
          opacity: 1,
          placement: { kind: "absolute", x: 0, y: 0, width: 100, height: 50 },
          layout: { kind: "absolute" },
          children: ["text"],
          backgroundColor: { red: 0, green: 0, blue: 0, alpha: 1 },
          border: {
            color: { red: 0, green: 0, blue: 0, alpha: 0 },
            width: 0,
            radius: 0,
          },
          clip: false,
        },
        text: {
          id: "text",
          kind: "text",
          parentId: "root",
          order: 0,
          visible: true,
          opacity: 1,
          placement: { kind: "absolute", x: 10, y: 5, width: 40, height: 20 },
          value: { kind: "literal", value: "<&>\"'" },
          maxCodePoints: 100,
          style: {
            fontAssetId: "font-main",
            fallbackFontAssetIds: [],
            fontSize: 10,
            lineHeight: 12,
            color: { red: 1, green: 1, blue: 1, alpha: 1 },
            weight: "regular",
            align: "start",
            overflow: "clip",
          },
        },
      },
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      interactions: {},
      initialStateId: "a",
      states: {
        a: { id: "a", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
        z: { id: "z", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
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
    fontAssets: {
      "font-main": fontMain,
    },
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
  it("2K static captureを通常実行境界でbounded memoryのcaller-owned RGBAとして返す", async () => {
    let adapterBytes: Uint8Array | undefined;
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        capture(request) {
          adapterBytes = new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(
            255,
          );
          return {
            rgba: adapterBytes,
            pixelSize: request.pixelTarget,
            colorSpace: "srgb",
            alphaMode: "opaque",
          };
        },
      },
      config,
    });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      context: { ...source.context, pixelTarget: [2048, 2048] },
    };

    const result = await executeRendererPlugin(renderer, input);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const rgba = result.value.captures[0]?.rgba;
    expect(rgba !== undefined).toBe(true);
    expect(rgba !== adapterBytes).toBe(true);
    expect(rgba?.byteLength === 16 * 1024 * 1024).toBe(true);
    expect(rgba?.[0] === 255).toBe(true);
    expect(rgba?.at(-1) === 255).toBe(true);
    expect(input.context.pixelTarget).toEqual([2048, 2048]);
  });

  it("固定環境と設定から決定論的な plugin を作り、capture を状態順に生成する", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const hash = createWebRendererConfigHash(config);
    expect(hash).toBe("sha256:3a5eb53c58755df665e1be21fe56d96f4f63c2cfda60a9b7203c3c869ad54075");
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const input = withRendererFingerprint(inputFor(hash), renderer);
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requests.map((request) => request.stateId)).toEqual(["a", "z"]);
    const firstRequest = requests[0];
    expect(firstRequest).toMatchObject({
      pixelTarget: [2, 1],
      fontFaceCount: 1,
      colorScheme: "dark",
      capabilities: { network: "deny", filesystem: "deny", clock: "fixed", random: "fixed" },
    });
    expect(firstRequest?.document).toContain('@font-face{font-family:"unframe-font-');
    expect(firstRequest?.document).toContain("data:font/ttf;base64,");
    expect(firstRequest?.document).toMatch(
      /data-node-id="text"[^>]+style="[^"]*font-family:unframe-font-[0-9a-f]+;font-size:0\.2px;/,
    );
    expect(firstRequest?.document).not.toMatch(/style="[^"]*font-family:"unframe-font-/);
    expect(firstRequest?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0px;top:0px;width:2px;height:1px;display:block;opacity:1;background:rgba(0,0,0,1);border:0px solid rgba(0,0,0,0);border-radius:0px;overflow:visible}",
    );
    expect(firstRequest?.document).toContain(
      'font-size:0.2px;line-height:0.24px;color:rgba(255,255,255,1);font-weight:400;text-align:start;overflow:hidden;white-space:pre-wrap">&lt;&amp;&gt;&quot;&#39;',
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

  it.each([
    ["canonical base64", { ...fontMain, dataBase64: "AAEAAA" }, "invalid-font-asset"],
    [
      "checksum",
      { ...fontMain, checksum: `sha256:${"0".repeat(64)}` },
      "font-asset-checksum-mismatch",
    ],
    [
      "media signature",
      { ...fontMain, mediaType: "font/otf" as const },
      "font-asset-signature-mismatch",
    ],
    ["glyph coverage", testFontAsset("x"), "font-glyph-missing"],
  ])("Font Assetの%s違反をcapture前に拒否する", async (_name, fontAsset, code) => {
    let captures = 0;
    const renderer = createBakedWebRenderer({
      adapter: {
        ...adapter(),
        capture: () => {
          captures++;
          throw new Error("must not capture");
        },
      },
      config,
    });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(
      renderer.build({ ...source, fontAssets: { "font-main": fontAsset } }),
    ).resolves.toMatchObject({ ok: false, diagnostics: [{ code }] });
    expect(captures).toBe(0);
  });

  it("primaryと明示fallbackのcmapだけでliteral Textを覆う", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = source.surface.contentNodes.text;
    if (!text || text.kind !== "text") throw new Error("expected Text fixture");
    const result = await renderer.build({
      ...source,
      surface: {
        ...source.surface,
        contentNodes: {
          ...source.surface.contentNodes,
          text: {
            ...text,
            style: { ...text.style, fallbackFontAssetIds: ["font-fallback"] },
          },
        },
      },
      fontAssets: {
        "font-main": testFontAsset("<"),
        "font-fallback": testFontAsset("&>\"'"),
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect(requests[0]).toMatchObject({ fontFaceCount: 2 });
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

  it("visual state 差分と未知 config を fail closed にする", async () => {
    expect(() =>
      createWebRendererConfigHash({
        documentBackground: [0, 0, 0, 255],
        fontFamily: "unexpected",
      } as unknown as WebRendererConfig),
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
    const text = input.surface.contentNodes.text;
    if (!text || text.kind !== "text") throw new Error("expected Text fixture");
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
              ...text,
              placement: {
                kind: "absolute",
                x: 0,
                y: 0,
                width: Number.MIN_VALUE,
                height: 20,
              },
              value: { kind: "literal", value: "scaled" },
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
    Object.defineProperty(states, "constructor", { value: { kind: "capture" }, enumerable: true });
    Object.defineProperty(surfaceStates, "constructor", {
      value: {
        id: "constructor",
        contentOverrides: {},
        semanticOverrides: [],
        enabledInteractionIds: [],
      },
      enumerable: true,
    });
    Object.defineProperty(semantics, "constructor", {
      value: { rootNodeIds: [], nodes: {} },
      enumerable: true,
    });
    const result = await renderer.build({
      ...input,
      surface: { ...input.surface, initialStateId: "constructor", states: surfaceStates },
      plan: { ...input.plan, states },
      semanticsByState: semantics,
    } as CompilerResolvedSurfaceInput);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(Object.hasOwn(result.hitRegionsByState, "constructor")).toBe(true);
  });

  it("config と opaque capture の厳格な byte 境界を検証する", async () => {
    const sparse = Object.assign([], { length: 4, 0: 0, 2: 0, 3: 255 }) as number[];
    expect(() =>
      createWebRendererConfigHash({
        documentBackground: sparse,
      } as unknown as WebRendererConfig),
    ).toThrow();
    expect(() =>
      createWebRendererConfigHash({
        documentBackground: [0, 0, 0, 255],
        fontFamily: "unexpected",
      } as unknown as WebRendererConfig),
    ).toThrow();
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
          text: { ...source.surface.contentNodes.text, value: 1 },
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

  it("factory optionsをZod境界の前にsnapshotし、accessorを実行しない", () => {
    let reads = 0;
    const hostileOptions = Object.defineProperty({ config }, "adapter", {
      enumerable: true,
      get() {
        reads++;
        return adapter();
      },
    });

    expect(() => createBakedWebRenderer(null as never)).not.toThrow();
    expect(() => createBakedWebRenderer(hostileOptions as never)).not.toThrow();
    expect(reads).toBe(0);
  });

  it("公開型を固定する", () => {
    expectTypeOf(createWebRendererConfigHash).returns.toEqualTypeOf<string>();
    expectTypeOf(createBakedWebRenderer).returns.toMatchTypeOf<{ build: Function }>();
  });
});
