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
  adapter,
  adapterIdentity,
  config,
  environment,
  fontMain,
  inputFor,
  nestedInputFor,
  testFontAsset,
  withRendererFingerprint,
} from "./fixtures/static-renderer.js";
import {
  executeRendererPlugin,
  runRendererConformance,
  type CompilerResolvedSurfaceInput,
} from "@unframe/unframe-renderer-api";

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

  it("absolute Frame/Textを任意depthで親相対・children順にlowerする", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: adapterIdentity,
        environment,
        capture(request) {
          requests.push(request);
          return Promise.resolve({
            rgba: new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(255),
            pixelSize: request.pixelTarget,
            colorSpace: "srgb" as const,
            alphaMode: "opaque" as const,
          });
        },
      },
      config,
    });
    const input = nestedInputFor(createWebRendererConfigHash(config), renderer);

    const result = await renderer.build(input);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const document = requests[0]?.document ?? "";
    expect(document).toContain(
      'data-node-id="nested" style="left:20px;top:10px;width:120px;height:60px;display:block;opacity:0.75;background:rgba(255,0,0,0.5);border:4px solid rgba(0,255,0,1);border-radius:6px;overflow:hidden"',
    );
    expect(document).toContain(
      'data-node-id="text-second" style="left:14px;top:6px;width:40px;height:16px;',
    );
    expect(document.indexOf('data-node-id="text-first"')).toBeLessThan(
      document.indexOf('data-node-id="text-second"'),
    );
    expect(document).toContain('<div class="frame" data-node-id="nested"');
    expect(document).toContain("</div></div></main>");
  });

  it("nested Stack layoutを引き続き拒否する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const input = nestedInputFor(createWebRendererConfigHash(config), renderer);
    const nested = input.surface.contentNodes.nested;
    if (!nested || nested.kind !== "frame") throw new Error("expected nested Frame fixture");

    await expect(
      renderer.build({
        ...input,
        surface: {
          ...input.surface,
          contentNodes: {
            ...input.surface.contentNodes,
            nested: {
              ...nested,
              layout: {
                kind: "stack",
                direction: "horizontal",
                gap: 0,
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                alignItems: "start",
                justifyContent: "start",
              },
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "unsupported-structured-tree" }],
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

  it("状態別 Semantic Tree と未知 config を処理する", async () => {
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
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
  });

  it("State ごとの Text override を各 capture の document に反映する", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      surface: {
        ...source.surface,
        states: {
          ...source.surface.states,
          z: {
            ...source.surface.states.z!,
            contentOverrides: { text: { kind: "text", value: { kind: "literal", value: ">" } } },
          },
        },
      },
    };
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    expect(requests[0]?.document).toContain("&lt;&amp;&gt;&quot;&#39;");
    expect(requests[1]?.document).toContain(">&gt;</div>");
  });

  it("State ごとの Frame override を capture に反映する", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      surface: {
        ...source.surface,
        states: {
          ...source.surface.states,
          z: {
            ...source.surface.states.z!,
            contentOverrides: { root: { kind: "frame", visible: false } },
          },
        },
      },
    };
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    expect(requests[0]?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0px;top:0px;width:2px;height:1px;display:block",
    );
    expect(requests[1]?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0px;top:0px;width:2px;height:1px;display:none",
    );
  });

  it("Frame/Text visual override の全対象 field を State ごとに適用する", async () => {
    const requests: BrowserCaptureRequest[] = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = source.surface.contentNodes.text;
    if (!text || text.kind !== "text") throw new Error("expected Text");
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      surface: {
        ...source.surface,
        states: {
          ...source.surface.states,
          z: {
            ...source.surface.states.z!,
            contentOverrides: {
              root: {
                kind: "frame",
                visible: true,
                opacity: 0.5,
                placement: { kind: "absolute", x: 5, y: 2, width: 90, height: 45 },
                layout: { kind: "absolute" },
                backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 },
                border: { color: { red: 0, green: 1, blue: 0, alpha: 1 }, width: 2, radius: 3 },
                clip: true,
              },
              text: {
                kind: "text",
                visible: true,
                opacity: 0.25,
                placement: { kind: "absolute", x: 12, y: 6, width: 30, height: 15 },
                value: { kind: "literal", value: ">" },
                style: {
                  ...text.style,
                  fontSize: 12,
                  lineHeight: 14,
                  color: { red: 0, green: 1, blue: 0, alpha: 1 },
                  weight: "bold",
                  align: "end",
                  overflow: "ellipsis",
                },
              },
            },
          },
        },
      },
    };
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    expect(requests[0]?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0px;top:0px;width:2px;height:1px",
    );
    expect(requests[1]?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0.1px;top:0.04px;width:1.8px;height:0.9px;display:block;opacity:0.5;background:rgba(255,0,0,1);border:0.04px solid rgba(0,255,0,1);border-radius:0.06px;overflow:hidden}",
    );
    expect(requests[1]?.document).toContain(
      'data-node-id="text" style="left:0.24px;top:0.12px;width:0.6px;height:0.3px;display:block;opacity:0.25;',
    );
    expect(requests[1]?.document).toContain(
      'font-size:0.24px;line-height:0.28px;color:rgba(0,255,0,1);font-weight:700;text-align:end;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">&gt;</div>',
    );
  });

  it("owned root Frame の button から private region を生成する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const root = source.surface.contentNodes.root;
    if (!root || root.kind !== "frame") throw new Error("expected Frame");
    const interaction = { kind: "regions" as const, events: ["click"] };
    const semantic = {
      id: "root-button",
      parentId: null,
      order: 0,
      role: "button" as const,
      text: "Open",
      interactionId: "tap",
      stateEnabled: true,
    };
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      surface: {
        ...source.surface,
        contentNodes: {
          ...source.surface.contentNodes,
          root: { ...root, semanticNodeId: "root-button" },
        },
        baseSemanticTree: {
          rootNodeIds: ["root-button"],
          nodes: {
            "root-button": {
              id: "root-button",
              parentId: null,
              order: 0,
              role: "button",
              text: "Open",
              interactionId: "tap",
            },
          },
        },
        interactions: { tap: { id: "tap", kind: "click", event: "click", hitPriority: 4 } },
        states: {
          a: { ...source.surface.states.a!, enabledInteractionIds: ["tap"] },
          z: { ...source.surface.states.z!, enabledInteractionIds: ["tap"] },
        },
        renderIntent: { ...source.surface.renderIntent, interaction },
      },
      sourceIntent: { ...source.sourceIntent, interaction },
      resolvedIntent: { ...source.resolvedIntent, interaction },
      semanticsByState: {
        a: { rootNodeIds: ["root-button"], nodes: { "root-button": semantic } },
        z: { rootNodeIds: ["root-button"], nodes: { "root-button": semantic } },
      },
      plan: {
        ...source.plan,
        ownedContentNodeIds: ["root", "text"],
        contextNodeIds: [],
        hitPriorityByInteractionId: { tap: 4 },
      },
    };
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hitRegionsByState.a).toEqual([
      {
        interactionId: "tap",
        semanticNodeId: "root-button",
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        priority: 4,
      },
    ]);
    expect((await executeRendererPlugin(renderer, input)).valid).toBe(true);
    for (const contentOverride of [
      { kind: "frame" as const, visible: false },
      { kind: "frame" as const, opacity: 0 },
    ]) {
      const hiddenInput: CompilerResolvedSurfaceInput = {
        ...input,
        surface: {
          ...input.surface,
          states: {
            ...input.surface.states,
            z: { ...input.surface.states.z!, contentOverrides: { root: contentOverride } },
          },
        },
      };
      const hiddenResult = await renderer.build(hiddenInput);
      expect(hiddenResult).toMatchObject({
        ok: false,
        diagnostics: [{ code: "missing-enabled-interaction-region" }],
      });
      expect((await executeRendererPlugin(renderer, hiddenInput)).valid).toBe(false);
      const partitionResult = await renderer.build({
        ...hiddenInput,
        plan: {
          ...hiddenInput.plan,
          clipWindow: { x: 0, y: 0, width: 99, height: 50 },
        },
      });
      expect(partitionResult.ok).toBe(true);
      if (partitionResult.ok) expect(partitionResult.hitRegionsByState.z).toEqual([]);
    }
  });

  it("明示 semantic binding の visible geometry を partition-local region にする", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = source.surface.contentNodes.text;
    if (!text || text.kind !== "text") throw new Error("expected Text");
    const interaction = { kind: "regions" as const, events: ["click"] };
    const semantic = {
      id: "button",
      parentId: null,
      order: 0,
      role: "button" as const,
      text: "Button",
      interactionId: "tap",
      stateEnabled: true,
    };
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      surface: {
        ...source.surface,
        contentNodes: {
          ...source.surface.contentNodes,
          text: { ...text, semanticNodeId: "button" },
        },
        baseSemanticTree: {
          rootNodeIds: ["button"],
          nodes: {
            button: {
              id: "button",
              parentId: null,
              order: 0,
              role: "button",
              text: "Button",
              interactionId: "tap",
            },
          },
        },
        interactions: { tap: { id: "tap", kind: "click", event: "click", hitPriority: 7 } },
        states: {
          a: { ...source.surface.states.a!, enabledInteractionIds: ["tap"] },
          z: {
            ...source.surface.states.z!,
            enabledInteractionIds: ["tap"],
            contentOverrides: {
              text: {
                kind: "text",
                placement: { kind: "absolute", x: 30, y: 5, width: 40, height: 20 },
              },
            },
          },
        },
        renderIntent: { ...source.surface.renderIntent, interaction },
      },
      sourceIntent: { ...source.sourceIntent, interaction },
      resolvedIntent: { ...source.resolvedIntent, interaction },
      semanticsByState: {
        a: { rootNodeIds: ["button"], nodes: { button: semantic } },
        z: { rootNodeIds: ["button"], nodes: { button: semantic } },
      },
      plan: {
        ...source.plan,
        clipWindow: { x: 20, y: 0, width: 30, height: 50 },
        hitPriorityByInteractionId: { tap: 7 },
      },
    };
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hitRegionsByState).toEqual({
      a: [
        {
          interactionId: "tap",
          semanticNodeId: "button",
          bounds: { x: 20, y: 5, width: 30, height: 20 },
          priority: 7,
        },
      ],
      z: [
        {
          interactionId: "tap",
          semanticNodeId: "button",
          bounds: { x: 30, y: 5, width: 20, height: 20 },
          priority: 7,
        },
      ],
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
          clipWindow: { x: 0, y: 0, width: Number.MIN_VALUE, height: 50 },
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
