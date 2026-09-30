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

const structuredContent = (surface: CompilerResolvedSurfaceInput["surface"]) => {
  if (surface.content.kind !== "structured") {
    throw new TypeError("Expected structured fixture.");
  }
  return surface.content;
};

describe("baked web renderer", () => {
  it("nonzero boundsの部分partitionではcontext Frameのpaintを省き、owned childだけを描画する", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
    const renderer = createBakedWebRenderer({
      adapter: {
        capture(request) {
          requests.push(request);
          return {
            alphaMode: "straight" as const,
            colorSpace: "srgb" as const,
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const source = nestedInputFor(createWebRendererConfigHash(config), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      context: { ...source.context, pixelTarget: [40, 16] },
      plan: {
        ...source.plan,
        clipWindow: { x: 12, y: 6, width: 20, height: 8 },
        logicalBounds: { x: 12, y: 6, width: 20, height: 8 },
        ownership: {
          contextNodeIds: ["root", "nested"],
          kind: "structured",
          ownedContentNodeIds: ["text-first"],
        },
        states: { a: { kind: "capture" }, z: { kind: "empty" } },
      },
    };

    const result = await renderer.build(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pixelTarget).toEqual([40, 16]);
    const document = requests[0]?.document ?? "";
    expect(document).toContain('data-node-id="text-first"');
    expect(document).not.toContain('data-node-id="text-second"');
    expect(document).not.toContain('data-node-id="clipped"');
    expect(document).toMatch(/#surface\{[^}]*left:-24px;top:-12px/);
    expect(document).toMatch(
      /data-node-id="nested"[^>]*background:rgba\(0,0,0,0\);border:4px solid rgba\(0,0,0,0\)/,
    );
    expect(document).toContain(
      "body{margin:0;width:100%;height:100%;overflow:hidden;background:rgba(0,0,0,0)",
    );
    expect(result.captures.map(({ stateId }) => stateId)).toEqual(["a"]);
  });
  it("2K static captureを通常実行境界でbounded memoryのcaller-owned RGBAとして返す", async () => {
    let adapterBytes: Uint8Array | undefined;
    const renderer = createBakedWebRenderer({
      adapter: {
        capture(request) {
          adapterBytes = new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(
            255,
          );
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: request.pixelTarget,
            rgba: adapterBytes,
          };
        },
        environment,
        identity: adapterIdentity,
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
    if (!result.valid) {
      return;
    }
    const rgba = result.value.captures[0]?.rgba;
    expect(rgba !== undefined).toBe(true);
    expect(rgba !== adapterBytes).toBe(true);
    expect(rgba?.byteLength === 16 * 1024 * 1024).toBe(true);
    expect(rgba?.[0] === 255).toBe(true);
    expect(rgba?.at(-1) === 255).toBe(true);
    expect(input.context.pixelTarget).toEqual([2048, 2048]);
  });

  it("固定環境と設定から決定論的な plugin を作り、capture を状態順に生成する", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
    const hash = createWebRendererConfigHash(config);
    expect(hash).toBe("sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const input = withRendererFingerprint(inputFor(hash), renderer);
    const result = await renderer.build(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(requests.map((request) => request.stateId)).toEqual(["a", "z"]);
    const firstRequest = requests[0];
    expect(firstRequest).toMatchObject({
      capabilities: { clock: "fixed", filesystem: "deny", network: "deny", random: "fixed" },
      colorScheme: "dark",
      fontFaceCount: 1,
      pixelTarget: [2, 1],
    });
    expect(firstRequest?.document).toContain('@font-face{font-family:"unframe-font-');
    expect(firstRequest?.document).toContain("data:font/ttf;base64,");
    expect(firstRequest?.document).toContain(
      `@font-face{font-family:"unframe-font-${fontMain.checksum.slice(7, 23)}";src:url("data:font/ttf;base64,${fontMain.dataBase64}") format("truetype");font-style:normal;font-weight:400 700;font-display:block}`,
    );
    expect(firstRequest?.document).toMatch(
      /data-node-id="text"[^>]+style="[^"]*font-family:unframe-font-[0-9a-f]+;font-size:0\.2px;/,
    );
    expect(firstRequest?.document).not.toMatch(/style="[^"]*font-family:"unframe-font-/);
    expect(firstRequest?.document).toContain(
      "#surface{position:absolute;box-sizing:border-box;left:0px;top:0px;width:2px;height:1px;display:block;opacity:1;background:rgba(0,0,0,0);border:0px solid rgba(0,0,0,0);border-radius:0px;overflow:visible}",
    );
    expect(firstRequest?.document).toContain(
      'font-size:0.2px;line-height:0.24px;color:rgba(255,255,255,1);font-weight:400;text-align:start;overflow:hidden;white-space:pre-wrap">&lt;&amp;&gt;&quot;&#39;',
    );
    expect(result.captures.map((capture) => capture.stateId)).toEqual(["a", "z"]);
    expect(result.provenance.implementationHash).toMatch(/^sha256:/);
    expect(await runRendererConformance(renderer, [{ input, name: "web" }])).toMatchObject({
      valid: true,
    });
  });

  it("absolute Frame/Textを任意depthで親相対・children順にlowerする", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
    const renderer = createBakedWebRenderer({
      adapter: {
        capture(request) {
          requests.push(request);
          return Promise.resolve({
            alphaMode: "opaque" as const,
            colorSpace: "srgb" as const,
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(255),
          });
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const input = nestedInputFor(createWebRendererConfigHash(config), renderer);

    const result = await renderer.build(input);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.diagnostics));
    }
    const document = requests[0]?.document ?? "";
    expect(document).toContain(
      'data-node-id="nested" style="left:20px;top:10px;width:120px;height:60px;display:block;opacity:0.75;background:rgba(0,0,0,0);border:4px solid rgba(0,0,0,0);border-radius:6px;overflow:hidden"',
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
    const nested = structuredContent(input.surface).nodes.nested;
    if (!nested || nested.kind !== "frame") {
      throw new Error("expected nested Frame fixture");
    }

    await expect(
      renderer.build({
        ...input,
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
              nested: {
                ...nested,
                layout: {
                  alignItems: "start",
                  direction: "horizontal",
                  gap: 0,
                  justifyContent: "start",
                  kind: "stack",
                  padding: { bottom: 0, left: 0, right: 0, top: 0 },
                },
              },
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "unsupported-structured-tree" }],
      ok: false,
    });
  });

  it("adapter へ渡す request を固定し、Compiler input を変更させない", async () => {
    const renderer = createBakedWebRenderer({
      adapter: {
        async capture(request) {
          expect(Object.isFrozen(request)).toBe(true);
          expect(Object.isFrozen(request.pixelTarget)).toBe(true);
          expect(Object.isFrozen(request.environment)).toBe(true);
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const before = JSON.stringify(input);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    [
      "canonical base64",
      { ...fontMain, dataBase64: "AAEAAA" },
      "invalid-font-asset",
      ["fontAssets", "font-main", "dataBase64"],
    ],
    [
      "checksum",
      { ...fontMain, checksum: `sha256:${"0".repeat(64)}` },
      "font-asset-checksum-mismatch",
      ["fontAssets", "font-main", "checksum"],
    ],
    [
      "media signature",
      { ...fontMain, mediaType: "font/otf" as const },
      "font-asset-signature-mismatch",
      ["fontAssets", "font-main", "mediaType"],
    ],
    [
      "glyph coverage",
      testFontAsset("x"),
      "font-glyph-missing",
      ["surface", "content", "nodes", "text", "value"],
    ],
  ])("Font Assetの%s違反をcapture前に拒否する", async (_name, fontAsset, code, path) => {
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
    ).resolves.toMatchObject({ diagnostics: [{ code, path }], ok: false });
    expect(captures).toBe(0);
  });

  it("primaryと明示fallbackのcmapだけでliteral Textを覆う", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = structuredContent(source.surface).nodes.text;
    if (!text || text.kind !== "text") {
      throw new Error("expected Text fixture");
    }
    const result = await renderer.build({
      ...source,
      fontAssets: {
        "font-fallback": testFontAsset("&>\"'"),
        "font-main": testFontAsset("<"),
      },
      surface: {
        ...source.surface,
        content: {
          ...structuredContent(source.surface),
          nodes: {
            ...structuredContent(source.surface).nodes,
            text: {
              ...text,
              style: { ...text.style, fallbackFontAssetIds: ["font-fallback"] },
            },
          },
        },
      },
    });
    expect(result).toMatchObject({ ok: true });
    expect(requests[0]).toMatchObject({ fontFaceCount: 2 });
  });

  it("作成時の Browser environment と frozen receiver を capture に渡す", async () => {
    const mutableEnvironment = {
      browser: { fontFingerprint: "sha256:fonts", id: "test-browser", version: "1" },
      clock: "fixed" as const,
      colorSpace: "srgb" as const,
      deviceScaleFactor: 1 as const,
      filesystem: "deny" as const,
      locale: "ja-JP",
      network: "deny" as const,
      random: "fixed" as const,
      timezone: "Asia/Tokyo",
    };
    const renderer = createBakedWebRenderer({
      adapter: {
        async capture(this: unknown) {
          const receiver = this as { readonly environment: FixedBrowserAdapter["environment"] };
          expect(Object.isFrozen(receiver)).toBe(true);
          expect(receiver.environment.browser.version).toBe("1");
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: [2, 1],
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          };
        },
        environment: mutableEnvironment,
        identity: adapterIdentity,
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
      } as unknown as WebRendererConfig),
    ).toThrow();
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      semanticsByState: {
        ...source.semanticsByState,
        z: {
          nodes: {
            changed: {
              id: "changed",
              order: 0,
              parentId: null,
              role: "paragraph",
              text: "changed",
            },
          },
          rootNodeIds: ["changed"],
        },
      },
    };
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
  });

  it("State ごとの Text override を各 capture の document に反映する", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
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
    const requests: Array<BrowserCaptureRequest> = [];
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
    const requests: Array<BrowserCaptureRequest> = [];
    const renderer = createBakedWebRenderer({ adapter: adapter(requests), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = structuredContent(source.surface).nodes.text;
    if (!text || text.kind !== "text") {
      throw new Error("expected Text");
    }
    const input: CompilerResolvedSurfaceInput = {
      ...source,
      plan: {
        ...source.plan,
        ownership: {
          contextNodeIds: [],
          kind: "structured",
          ownedContentNodeIds: ["root", "text"],
        },
      },
      surface: {
        ...source.surface,
        states: {
          ...source.surface.states,
          z: {
            ...source.surface.states.z!,
            contentOverrides: {
              root: {
                backgroundColor: { alpha: 1, blue: 0, green: 0, red: 1 },
                border: { color: { alpha: 1, blue: 0, green: 1, red: 0 }, radius: 3, width: 2 },
                clip: true,
                kind: "frame",
                layout: { kind: "absolute" },
                opacity: 0.5,
                placement: { height: 45, kind: "absolute", width: 90, x: 5, y: 2 },
                visible: true,
              },
              text: {
                kind: "text",
                opacity: 0.25,
                placement: { height: 15, kind: "absolute", width: 30, x: 12, y: 6 },
                style: {
                  ...text.style,
                  align: "end",
                  color: { red: 0, green: 1, blue: 0, alpha: 1 },
                  fontSize: 12,
                  lineHeight: 14,
                  overflow: "ellipsis",
                  weight: "bold",
                },
                value: { kind: "literal", value: ">" },
                visible: true,
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

  it("capture bytes の所有権を固定し、cross-realm Uint8Array を受け取る", async () => {
    const requests: Array<BrowserCaptureRequest> = [];
    const foreignBytes = runInNewContext(
      "new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255])",
    ) as Uint8Array;
    const foreignPixelSize: [number, number] = [2, 1];
    const renderer = createBakedWebRenderer({
      adapter: {
        async capture(request) {
          requests.push(request);
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: foreignPixelSize,
            rgba: foreignBytes,
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const result = await renderer.build(input);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      return;
    }
    expect(requests[0]?.document).toContain("background:rgba(0,0,0,0)");
    foreignBytes[0] = 99;
    foreignPixelSize[0] = 99;
    expect(result.captures[0]?.rgba[0]).toBe(1);
    expect(result.captures[0]?.pixelSize).toEqual([2, 1]);
  });

  it("factory 作成時の capture 実装を固定し、premultiplied output を拒否する", async () => {
    const mutableAdapter: FixedBrowserAdapter = {
      async capture(request) {
        return {
          alphaMode: "opaque",
          colorSpace: "srgb",
          pixelSize: request.pixelTarget,
          rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
        };
      },
      environment,
      identity: adapterIdentity,
    };
    const renderer = createBakedWebRenderer({ adapter: mutableAdapter, config });
    mutableAdapter.capture = async () => {
      throw new Error("replacement must not run");
    };
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    const premultiplied = createBakedWebRenderer({
      adapter: {
        async capture(request) {
          return {
            alphaMode: "premultiplied",
            colorSpace: "srgb",
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    await expect(
      premultiplied.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), premultiplied),
      ),
    ).resolves.toMatchObject({ diagnostics: [{ code: "invalid-browser-capture" }], ok: false });
  });

  it("capture の mutable call property を参照せず、非有限 scale を拒否する", async () => {
    const capture: FixedBrowserAdapter["capture"] = async (request) => ({
      alphaMode: "opaque",
      colorSpace: "srgb",
      pixelSize: request.pixelTarget,
      rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
    });
    Object.defineProperty(capture, "call", {
      value: () => Promise.reject(new Error("mutable call must not run")),
    });
    const renderer = createBakedWebRenderer({
      adapter: { capture, environment, identity: adapterIdentity },
      config,
    });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const text = structuredContent(input.surface).nodes.text;
    if (!text || text.kind !== "text") {
      throw new Error("expected Text fixture");
    }
    await expect(renderer.build(input)).resolves.toMatchObject({ ok: true });
    await expect(
      renderer.build({
        ...input,
        plan: {
          ...input.plan,
          clipWindow: { x: 0, y: 0, width: Number.MIN_VALUE, height: 50 },
          logicalBounds: { x: 0, y: 0, width: Number.MIN_VALUE, height: 50 },
        },
        surface: {
          ...input.surface,
          content: {
            ...structuredContent(input.surface),
            nodes: {
              ...structuredContent(input.surface).nodes,
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
          logicalSize: [Number.MIN_VALUE, 50],
        },
      }),
    ).resolves.toMatchObject({ diagnostics: [{ code: "invalid-render-scale" }], ok: false });
  });

  it("semantic record の挿入順だけが異なる capture states を同値として扱う", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const first = {
      nodes: {
        a: { id: "a", order: 0, parentId: null, role: "paragraph" as const, text: "A" },
        b: { id: "b", order: 1, parentId: null, role: "paragraph" as const, text: "B" },
      },
      rootNodeIds: ["a", "b"],
    };
    const second = {
      nodes: {
        a: { id: "a", parentId: null, order: 0, role: "paragraph" as const, text: "A" },
        b: { id: "b", parentId: null, order: 1, role: "paragraph" as const, text: "B" },
      },
      rootNodeIds: ["a", "b"],
    };
    await expect(
      renderer.build({ ...source, semanticsByState: { a: first, z: second } }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("設定 hash の不一致、adapter failure、hostile capture を診断に変換する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const mismatch = await renderer.build(inputFor("sha256:other"));
    expect(mismatch).toMatchObject({ ok: false });
    if (!mismatch.ok) {
      expect(mismatch.diagnostics[0]?.code).toBe("renderer-fingerprint-mismatch");
    }
    const fails = createBakedWebRenderer({
      adapter: {
        async capture() {
          throw new Error("no");
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const failedInput = withRendererFingerprint(
      inputFor(createWebRendererConfigHash(config)),
      fails,
    );
    await expect(fails.build(failedInput)).resolves.toMatchObject({
      diagnostics: [{ code: "browser-capture-failed" }],
      ok: false,
    });
    const hostile = createBakedWebRenderer({
      adapter: {
        async capture() {
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: [2, 1],
            rgba: new Uint8Array(1),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const hostileInput = withRendererFingerprint(
      inputFor(createWebRendererConfigHash(config)),
      hostile,
    );
    await expect(hostile.build(hostileInput)).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-browser-capture" }],
      ok: false,
    });
  });

  it("直接 build の capability と compiler input 境界を検証する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    await expect(
      renderer.build({
        ...input,
        entry: { entryId: "x", kind: "opaque", moduleHash: "x" },
        plan: { ...input.plan, ownership: { bindingKeys: [], kind: "opaque" } },
        surface: { ...input.surface, content: { bindings: {}, kind: "opaque" } },
      }),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "unsupported-input-kind" }],
      ok: false,
    });
    await expect(
      renderer.build({ ...input, context: { ...input.context, rendererFingerprint: "bad" } }),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "renderer-fingerprint-mismatch" }],
      ok: false,
    });
    await expect(
      renderer.build({
        ...input,
        plan: { ...input.plan, logicalBounds: { height: 1, width: 0, x: 0, y: 0 } },
      }),
    ).resolves.toMatchObject({ diagnostics: [{ code: "invalid-logical-bounds" }], ok: false });
    await expect(
      renderer.build({ ...input, plan: { ...input.plan, semanticSurfaceId: "other" } }),
    ).resolves.toMatchObject({ diagnostics: [{ code: "surface-plan-mismatch" }], ok: false });
  });

  it("adapter identity を implementation hash に含め、固定する", async () => {
    const first = createBakedWebRenderer({ adapter: adapter(), config });
    const second = createBakedWebRenderer({
      adapter: {
        async capture(request) {
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          };
        },
        environment,
        identity: { id: "test-adapter", implementationHash: "sha256:other" },
      },
      config,
    });
    expect(first.identity.implementationHash).not.toBe(second.identity.implementationHash);
    const invalid = createBakedWebRenderer({
      adapter: { capture: async () => ({}), environment } as unknown as FixedBrowserAdapter,
      config,
    });
    await expect(
      invalid.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), invalid),
      ),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-browser-environment" }],
      ok: false,
    });
  });

  it("任意の own state ID に空 hit region を作成する", async () => {
    const renderer = createBakedWebRenderer({ adapter: adapter(), config });
    expect(Object.isFrozen(renderer)).toBe(true);
    const input = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const states = Object.create(null);
    const surfaceStates = Object.create(null);
    const semantics = Object.create(null);
    Object.defineProperty(states, "constructor", { enumerable: true, value: { kind: "capture" } });
    Object.defineProperty(surfaceStates, "constructor", {
      enumerable: true,
      value: {
        contentOverrides: {},
        enabledInteractionIds: [],
        id: "constructor",
        semanticOverrides: [],
      },
    });
    Object.defineProperty(semantics, "constructor", {
      enumerable: true,
      value: { nodes: {}, rootNodeIds: [] },
    });
    const result = await renderer.build({
      ...input,
      plan: { ...input.plan, states },
      semanticsByState: semantics,
      surface: { ...input.surface, initialStateId: "constructor", states: surfaceStates },
    } as CompilerResolvedSurfaceInput);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.captures.map(({ stateId }) => stateId)).toContain("constructor");
    }
  });

  it("空config と opaque capture の厳格な境界を検証する", async () => {
    expect(() =>
      createWebRendererConfigHash({
        documentBackground: [0, 0, 0, 255],
      } as unknown as WebRendererConfig),
    ).toThrow();
    expect(() =>
      createWebRendererConfigHash({
        fontFamily: "unexpected",
      } as unknown as WebRendererConfig),
    ).toThrow();
    const opaque = createBakedWebRenderer({
      adapter: {
        async capture(request) {
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: request.pixelTarget,
            rgba: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 255]),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    await expect(
      opaque.build(withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), opaque)),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-browser-capture" }],
      ok: false,
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
        async capture() {
          return {
            alphaMode: "opaque",
            colorSpace: "srgb",
            pixelSize: new Proxy([2, 1], {
              get() {
                throw new Error("pixel size must not be read as a value");
              },
            }),
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          } as unknown as import("../src/index.js").BrowserRgbaCapture;
        },
        environment: hostileEnvironment,
        identity: adapterIdentity,
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
        capture: () => ({
          alphaMode: "opaque",
          colorSpace: "srgb",
          pixelSize: [2, 1],
          rgba: new HostileBytes([0, 0, 0, 255, 0, 0, 0, 255]),
        }),
        environment,
        identity: adapterIdentity,
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
          capture: () =>
            ({ alphaMode: "opaque", colorSpace: "srgb", pixelSize: [2, 1], rgba }) as never,
          environment,
          identity: adapterIdentity,
        },
        config,
      });
      await expect(
        renderer.build(
          withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer),
        ),
      ).resolves.toMatchObject({ diagnostics: [{ code: "invalid-browser-capture" }], ok: false });
    }
  });

  it("malformed Text node は Browser capture 前に shared validator が拒否する", async () => {
    let captures = 0;
    const renderer = createBakedWebRenderer({
      adapter: {
        capture: () => {
          captures++;
          return {
            alphaMode: "opaque" as const,
            colorSpace: "srgb" as const,
            pixelSize: [2, 1],
            rgba: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
          };
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    const source = withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), renderer);
    const malformed = {
      ...source,
      surface: {
        ...source.surface,
        content: {
          ...structuredContent(source.surface),
          nodes: {
            ...structuredContent(source.surface).nodes,
            text: { ...structuredContent(source.surface).nodes.text, value: 1 },
          },
        },
      },
    } as unknown as CompilerResolvedSurfaceInput;
    await expect(renderer.build(malformed)).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-renderer-input" }],
      ok: false,
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
        async capture() {
          return Object.defineProperty({}, "rgba", {
            get() {
              reads++;
              return new Uint8Array(8);
            },
          }) as unknown as import("../src/index.js").BrowserRgbaCapture;
        },
        environment,
        identity: adapterIdentity,
      },
      config,
    });
    await expect(
      hostile.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), hostile),
      ),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-browser-capture" }],
      ok: false,
    });
    expect(reads).toBe(0);
  });

  it("inherited または getter の Browser environment を安全に拒否する", async () => {
    const inheritedEnvironment = Object.create(environment);
    const inherited = createBakedWebRenderer({
      adapter: {
        async capture() {
          throw new Error("must not run");
        },
        environment: inheritedEnvironment,
        identity: adapterIdentity,
      } as unknown as FixedBrowserAdapter,
      config,
    });
    await expect(
      inherited.build(
        withRendererFingerprint(inputFor(createWebRendererConfigHash(config)), inherited),
      ),
    ).resolves.toMatchObject({
      diagnostics: [{ code: "invalid-browser-environment" }],
      ok: false,
    });
    const hostileAdapter = Object.defineProperty(
      { capture: async () => ({}), identity: adapterIdentity },
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
