import { assert, expect, it } from "vitest";
import { testFontAsset } from "./fixtures/static-renderer.js";
import { openOpaqueCaptureRuntime } from "../src/opaque/capture/runtime.js";

const script = `globalThis.__unframeMount = () => {
  const h = document.createElement('h1'); h.dataset.unframeBinding='node:title';
  h.textContent='Hello'; h.style.color='white'; document.getElementById('unframe-root').append(h);
};`;
const request = {
  javascript: script,
  assets: [],
  stylesheets: [],
  props: {},
  texts: { title: "Hello" },
  expectedBindings: { "node:title": "Hello" },
  stateId: "default",
  logicalSize: [160, 90] as const,
  pixelTarget: [160, 90] as const,
  colorScheme: "light" as const,
  background: [0, 0, 0, 255] as const,
};
it("captures identical RGBA in two isolated executions", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const first = await runtime.capture(request);
    const second = await runtime.capture(request);
    assert.isTrue(first.ok);
    assert.isTrue(second.ok);
    expect(first.rgbaBase64).toBe(second.rgbaBase64);
    expect(first.bindings).toEqual(second.bindings);
    expect(Buffer.from(first.rgbaBase64, "base64")).toHaveLength(160 * 90 * 4);
  } finally {
    await runtime.close();
  }
}, 90_000);
it("does not trust renderer replacements of DOM observation APIs", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript: `globalThis.__unframeMount=()=>{document.querySelectorAll=()=>[{getAttribute:()=> 'node:title',textContent:'Hello',getBoundingClientRect:()=>({x:0,y:0,width:100,height:30})}];};`,
    });
    expect(result).toMatchObject({ ok: false, code: "opaque-binding-invalid" });
  } finally {
    await runtime.close();
  }
}, 60_000);
it("rejects external network attempts", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript:
        script +
        `; const original=__unframeMount; __unframeMount=()=>{original();fetch('https://example.com/').catch(()=>{});};`,
    });
    expect(result.ok).toBe(false);
  } finally {
    await runtime.close();
  }
}, 60_000);
it("rejects duplicate bindings, forbidden workers and distorted viewports", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const duplicate = await runtime.capture({
      ...request,
      javascript:
        script + `; const original=__unframeMount; __unframeMount=()=>{original();original();};`,
    });
    expect(duplicate).toMatchObject({ ok: false, code: "opaque-binding-invalid" });
    const worker = await runtime.capture({
      ...request,
      javascript:
        script +
        `; const original=__unframeMount; __unframeMount=()=>{original();try{new Worker('/worker.js')}catch{};try{Object.defineProperty(globalThis,'__unframeViolation',{value:false})}catch{}};`,
    });
    expect(worker).toMatchObject({ ok: false, code: "opaque-capability-denied" });
    expect(await runtime.capture({ ...request, logicalSize: [100, 100] })).toMatchObject({
      ok: false,
      code: "opaque-input-invalid",
    });
  } finally {
    await runtime.close();
  }
}, 90_000);
it("preserves the configured background alpha", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({ ...request, background: [255, 0, 0, 128] });
    assert.isTrue(result.ok);
    expect([...Buffer.from(result.rgbaBase64, "base64").subarray(-4)]).toEqual([255, 0, 0, 128]);
  } finally {
    await runtime.close();
  }
}, 60_000);
it("terminates a renderer that never returns from mount", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript: "globalThis.__unframeMount=()=>{while(true){}};",
    });
    expect(result).toMatchObject({ ok: false, code: "opaque-capture-timeout" });
  } finally {
    await runtime.close();
  }
}, 50_000);
it("cancels an active Chromium worker", async () => {
  const controller = new AbortController();
  const runtime = await openOpaqueCaptureRuntime({ signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    await expect(
      runtime.capture({ ...request, javascript: "globalThis.__unframeMount=()=>{while(true){}};" }),
    ).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
  } finally {
    clearTimeout(timer);
    await runtime.close();
  }
}, 30_000);

it("reports a font that passes metadata checks but cannot be decoded", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const asset = testFontAsset("Hello");
    expect(
      await runtime.capture({
        ...request,
        assets: [{ path: "invalid.ttf", mediaType: "font/ttf", dataBase64: asset.dataBase64 }],
      }),
    ).toMatchObject({ ok: false, code: "opaque-font-invalid" });
  } finally {
    await runtime.close();
  }
}, 30_000);
it("preserves CSS import cascade without linking imported styles twice", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      stylesheets: ["assets/parent.css"],
      assets: [
        {
          path: "assets/parent.css",
          mediaType: "text/css",
          dataBase64: Buffer.from(
            '@import "./child.css"; #unframe-root { background: rgb(255,0,0); }',
          ).toString("base64"),
        },
        {
          path: "assets/child.css",
          mediaType: "text/css",
          dataBase64: Buffer.from("#unframe-root { background: rgb(0,0,255); }").toString("base64"),
        },
      ],
    });
    assert.isTrue(result.ok);
    expect([...Buffer.from(result.rgbaBase64, "base64").subarray(-4)]).toEqual([255, 0, 0, 255]);
  } finally {
    await runtime.close();
  }
}, 30_000);
it("rejects service worker registration even when the renderer catches the rejection", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript:
        script +
        `;const original=__unframeMount;__unframeMount=()=>{original();navigator.serviceWorker.register('/__renderer.js').catch(()=>{});};`,
    });
    expect(result).toMatchObject({ ok: false });
  } finally {
    await runtime.close();
  }
}, 30_000);
it("cannot hide a denied capability by replacing main-world eval", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript:
        script +
        `; __unframeMount(); try {new Worker('/worker.js')} catch {} globalThis.eval=()=>false;`,
    });
    expect(result).toMatchObject({ ok: false });
  } finally {
    await runtime.close();
  }
}, 30_000);
