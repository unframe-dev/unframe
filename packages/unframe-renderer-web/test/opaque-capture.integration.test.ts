import { readFile } from "node:fs/promises";
import { assert, expect, it } from "vitest";
import { testFontAsset } from "./fixtures/static-renderer.js";
import { openOpaqueCaptureRuntime } from "../src/opaque/capture/runtime.js";

const script = `globalThis.__unframeMount = () => {
  const h = document.createElement('h1'); h.dataset.unframeBinding='node:title';
  h.textContent='Hello'; h.style.color='white'; document.getElementById('unframe-root').append(h);
};`;
const fixtureFont = (
  await readFile(
    new URL("../../../app/unity/Assets/TextMesh Pro/Fonts/LiberationSans.ttf", import.meta.url),
  )
).toString("base64");
const fontCss =
  "@font-face{font-family:Fixture;src:url('/assets/LiberationSans.ttf')}*{font-family:Fixture!important;font-weight:400!important}";
const request = {
  assets: [
    { dataBase64: fixtureFont, mediaType: "font/ttf", path: "assets/LiberationSans.ttf" },
    {
      dataBase64: Buffer.from(fontCss).toString("base64"),
      mediaType: "text/css",
      path: "assets/font.css",
    },
  ],
  background: [0, 0, 0, 255] as const,
  colorScheme: "light" as const,
  expectedBindings: { "node:title": "Hello" },
  javascript: script,
  logicalSize: [160, 90] as const,
  pixelTarget: [160, 90] as const,
  props: {},
  stateId: "default",
  stylesheets: ["assets/font.css"],
  texts: { title: "Hello" },
};
it("captures identical RGBA in two isolated executions", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const first = await runtime.capture(request);
    const second = await runtime.capture(request);
    assert.isTrue(first.ok, JSON.stringify(first));
    assert.isTrue(second.ok, JSON.stringify(second));
    expect(first.rgbaBase64).toBe(second.rgbaBase64);
    expect(first.bindings).toEqual(second.bindings);
    expect(Buffer.from(first.rgbaBase64, "base64")).toHaveLength(160 * 90 * 4);
  } finally {
    await runtime.close();
  }
}, 90_000);
it("captures transparent button geometry in logical coordinates after viewport and overflow clipping", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      bindingKeys: ["node:button"],
      buttonBindings: { "node:button": true },
      expectedBindings: { "node:button": "Go" },
      javascript: `globalThis.__unframeMount=()=>{
        const clip=document.createElement('div');
        Object.assign(clip.style,{position:'absolute',left:'20px',top:'10px',width:'60px',height:'40px',overflow:'hidden'});
        const button=document.createElement('button');
        button.dataset.unframeBinding='node:button';button.textContent='Go';
        Object.assign(button.style,{position:'absolute',left:'45px',top:'5px',width:'50px',height:'20px',padding:'0',border:'0',background:'transparent'});
        clip.append(button);document.getElementById('unframe-root').append(clip);
      };`,
      logicalSize: [160, 90],
      pixelTarget: [320, 180],
    });
    assert.isTrue(result.ok);
    expect(result.bindings).toEqual([
      { disabled: false, height: 20, key: "node:button", text: "Go", width: 15, x: 65, y: 15 },
    ]);
  } finally {
    await runtime.close();
  }
}, 60_000);
it("passes the local State key and rejects an excluded binding that is rendered", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      bindingKeys: ["node:title", "node:answer"],
      javascript: `globalThis.__unframeMount=({state,bindings,texts})=>{
        const h=document.createElement('h1');h.setAttribute('data-unframe-binding',bindings.title['data-unframe-binding']);h.textContent=texts.title;document.getElementById('unframe-root').append(h);
        if(state==='hidden'){const p=document.createElement('p');p.setAttribute('data-unframe-binding',bindings.answer['data-unframe-binding']);p.textContent=texts.answer;document.getElementById('unframe-root').append(p);}
      };`,
      stateId: "canonical-state-id",
      stateKey: "hidden",
      texts: { answer: "Answer", title: "Hello" },
    });
    expect(result).toMatchObject({ code: "opaque-binding-invalid", ok: false });
  } finally {
    await runtime.close();
  }
}, 60_000);
it("rejects transformed and nonrectangular binding geometry", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    for (const css of ["transform:rotate(10deg)", "clip-path:circle(40%)"]) {
      const result = await runtime.capture({
        ...request,
        javascript: `globalThis.__unframeMount=()=>{
          const h=document.createElement('h1');h.dataset.unframeBinding='node:title';h.textContent='Hello';h.style.cssText=${JSON.stringify(css)};document.getElementById('unframe-root').append(h);
        };`,
      });
      expect(result).toMatchObject({ code: "opaque-geometry-unsupported", ok: false });
    }
  } finally {
    await runtime.close();
  }
}, 60_000);
it("rejects individual CSS rotation on a button or its ancestor and 3D transforms", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    for (const [css, onAncestor] of [
      ["rotate:10deg", false],
      ["rotate:10deg", true],
      ["rotate:x 10deg", false],
      ["scale:1 1 2", false],
      ["scale:-1 1", false],
      ["translate:0px 0px 3px", false],
    ] as const) {
      const result = await runtime.capture({
        ...request,
        buttonBindings: { "node:button": true },
        expectedBindings: { "node:button": "Go" },
        javascript: `globalThis.__unframeMount=()=>{
          const parent=document.createElement('div');const button=document.createElement('button');
          button.dataset.unframeBinding='node:button';button.textContent='Go';
          ((${JSON.stringify(onAncestor)})?parent:button).style.cssText=${JSON.stringify(css)};
          parent.append(button);document.getElementById('unframe-root').append(parent);
        };`,
      });
      expect(result).toMatchObject({ code: "opaque-geometry-unsupported", ok: false });
    }
  } finally {
    await runtime.close();
  }
}, 90_000);
it("captures axis-aligned individual translate and positive scale", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      buttonBindings: { "node:button": true },
      expectedBindings: { "node:button": "Go" },
      javascript: `globalThis.__unframeMount=()=>{
        const parent=document.createElement('div');parent.style.cssText='transform-origin:0 0;translate:10px 5px;scale:2 2';
        const button=document.createElement('button');button.dataset.unframeBinding='node:button';
        button.textContent='Go';button.style.cssText='rotate:0deg;translate:2px 0px';
        parent.append(button);document.getElementById('unframe-root').append(parent);
      };`,
    });
    assert.isTrue(result.ok, JSON.stringify(result));
  } finally {
    await runtime.close();
  }
}, 60_000);
it.each(["open", "closed"])(
  "rejects an author-created %s shadow root",
  async (mode) => {
    const runtime = await openOpaqueCaptureRuntime();
    try {
      const result = await runtime.capture({
        ...request,
        javascript: `globalThis.__unframeMount=()=>{
        const h=document.createElement('h1');h.dataset.unframeBinding='node:title';h.textContent='Hello';document.getElementById('unframe-root').append(h);
        const host=document.createElement('div');const shadow=host.attachShadow({mode:${JSON.stringify(mode)}});
        shadow.append(document.createElement('canvas'));document.getElementById('unframe-root').append(host);
      };`,
      });
      expect(result).toMatchObject({ code: "opaque-element-unsupported", ok: false });
    } finally {
      await runtime.close();
    }
  },
  60_000,
);
it("does not trust renderer replacements of DOM observation APIs", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      javascript: `globalThis.__unframeMount=()=>{document.querySelectorAll=()=>[{getAttribute:()=> 'node:title',textContent:'Hello',getBoundingClientRect:()=>({x:0,y:0,width:100,height:30})}];};`,
    });
    expect(result).toMatchObject({ code: "opaque-binding-invalid", ok: false });
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
    expect(duplicate).toMatchObject({ code: "opaque-binding-invalid", ok: false });
    const worker = await runtime.capture({
      ...request,
      javascript:
        script +
        `; const original=__unframeMount; __unframeMount=()=>{original();try{new Worker('/worker.js')}catch{};try{Object.defineProperty(globalThis,'__unframeViolation',{value:false})}catch{}};`,
    });
    expect(worker).toMatchObject({ code: "opaque-capability-denied", ok: false });
    expect(await runtime.capture({ ...request, logicalSize: [100, 100] })).toMatchObject({
      code: "opaque-input-invalid",
      ok: false,
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
    expect(result).toMatchObject({ code: "opaque-capture-timeout", ok: false });
  } finally {
    await runtime.close();
  }
}, 50_000);
it("cancels an active Chromium worker", async () => {
  const controller = new AbortController();
  const runtime = await openOpaqueCaptureRuntime({ signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 1000);
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
        assets: [
          { dataBase64: asset.dataBase64, mediaType: "font/ttf", path: "invalid.ttf" },
          {
            dataBase64: Buffer.from(
              "@font-face{font-family:Fixture;src:url('/invalid.ttf')}*{font-family:Fixture!important}",
            ).toString("base64"),
            mediaType: "text/css",
            path: "invalid.css",
          },
        ],
        stylesheets: ["invalid.css"],
      }),
    ).toMatchObject({ code: "opaque-font-invalid", ok: false });
  } finally {
    await runtime.close();
  }
}, 30_000);
it("preserves CSS import cascade without linking imported styles twice", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const result = await runtime.capture({
      ...request,
      assets: [
        ...request.assets,
        {
          dataBase64: Buffer.from(
            '@import "./child.css"; #unframe-root { background: rgb(255,0,0); }',
          ).toString("base64"),
          mediaType: "text/css",
          path: "assets/parent.css",
        },
        {
          dataBase64: Buffer.from("#unframe-root { background: rgb(0,0,255); }").toString("base64"),
          mediaType: "text/css",
          path: "assets/child.css",
        },
      ],
      stylesheets: [...request.stylesheets, "assets/parent.css"],
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
