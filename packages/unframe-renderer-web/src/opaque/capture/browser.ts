import type { Browser } from "playwright-core";
import { PNG } from "pngjs";
import { validateOpaqueAsset } from "./assets.js";
import { createOpaqueFontValidator } from "./fonts.js";
import { fixedBrowserInitScript } from "../../browser/playwright-fixed-browser.js";
import { validateOpaqueBindings, type OpaqueBinding } from "./bindings.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "./types.js";

const ORIGIN = "https://unframe.invalid/";
const MAX_PIXELS = 4_194_304;
const MAX_BYTES = 64 * 1024 * 1024;
const restrictionScript = `(() => {
  let violation = false;
  function deny() { violation = true; throw new Error('opaque-capability-denied'); }
  for (const key of ['Worker','SharedWorker','WebSocket','EventSource','RTCPeerConnection'])
    Object.defineProperty(globalThis, key, {value: deny, writable: false, configurable: false});
  Object.defineProperty(globalThis,'open',{value:deny,writable:false,configurable:false});
  if (navigator.serviceWorker) {
    const registration = {value:async function(){deny();},writable:false,configurable:false};
    Object.defineProperty(navigator.serviceWorker,'register',registration);
    Object.defineProperty(ServiceWorkerContainer.prototype,'register',registration);
  }
  Object.defineProperty(globalThis,'__unframeViolation',{get:()=>violation,configurable:false});
  addEventListener('securitypolicyviolation', () => { violation = true; });
})();`;
const observeScript = `(buttonKeys => {
  if (document.querySelector('video,audio,iframe,canvas,object,embed,svg')) throw new Error('opaque-element-unsupported');
  const root = document.getElementById('unframe-root');
  const observations = [];
  for (const element of document.querySelectorAll('[data-unframe-binding]')) {
    if (!root.contains(element)) throw new Error('opaque-binding-invalid');
    const key=element.getAttribute('data-unframe-binding');
    const isButton=buttonKeys.includes(key);
    if (isButton && !(element instanceof HTMLButtonElement)) throw new Error('opaque-binding-invalid');
    const rect = element.getBoundingClientRect();
    let left=Math.max(0,rect.left), top=Math.max(0,rect.top), right=Math.min(innerWidth,rect.right), bottom=Math.min(innerHeight,rect.bottom);
    for (let parent=element; parent; parent=parent.parentElement) {
      const style=getComputedStyle(parent);
      if (style.display==='none' || style.visibility!=='visible' || Number(style.opacity)===0) throw new Error('opaque-binding-invisible');
      if (style.clipPath!=='none' || style.perspective!=='none' || style.clip!=='auto') throw new Error('opaque-geometry-unsupported');
      if (style.transform!=='none') {
        const matrix=new DOMMatrixReadOnly(style.transform);
        if (!matrix.is2D || matrix.b!==0 || matrix.c!==0 || matrix.a<=0 || matrix.d<=0) throw new Error('opaque-geometry-unsupported');
      }
      const bounds=parent.getBoundingClientRect();
      const clipsX=['hidden','clip','scroll','auto'].includes(style.overflowX);
      const clipsY=['hidden','clip','scroll','auto'].includes(style.overflowY);
      if ((clipsX || clipsY) && style.borderRadius!=='0px') throw new Error('opaque-geometry-unsupported');
      const scaleX=parent.offsetWidth ? bounds.width/parent.offsetWidth : 1;
      const scaleY=parent.offsetHeight ? bounds.height/parent.offsetHeight : 1;
      if (clipsX) {left=Math.max(left,bounds.left+parent.clientLeft*scaleX);right=Math.min(right,bounds.left+(parent.clientLeft+parent.clientWidth)*scaleX);}
      if (clipsY) {top=Math.max(top,bounds.top+parent.clientTop*scaleY);bottom=Math.min(bottom,bounds.top+(parent.clientTop+parent.clientHeight)*scaleY);}
    }
    observations.push({key,text:element.textContent,x:left,y:top,width:right-left,height:bottom-top,...(isButton?{disabled:element.disabled}:{})});
  }
  return observations;
})`;
const pngBytes = (bytes: Uint8Array, target: readonly [number, number]) => {
  if (
    bytes.length < 24 ||
    bytes.length > MAX_BYTES ||
    Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error("opaque-capture-invalid");
  const buffer = Buffer.from(bytes);
  if (buffer.readUInt32BE(16) !== target[0] || buffer.readUInt32BE(20) !== target[1])
    throw new Error("opaque-capture-invalid");
  return PNG.sync.read(buffer).data;
};

export const captureOpaquePage = async (
  browser: Browser,
  input: OpaqueCaptureRequest,
): Promise<OpaqueCaptureResult> => {
  if (
    !input.pixelTarget.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 2048) ||
    input.pixelTarget[0] * input.pixelTarget[1] > MAX_PIXELS ||
    !input.logicalSize.every((n) => Number.isFinite(n) && n > 0)
  )
    return { ok: false, code: "opaque-input-invalid" };
  const context = await browser.newContext({
    viewport: { width: input.pixelTarget[0], height: input.pixelTarget[1] },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: input.colorScheme,
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  let violation: string | undefined;
  const reject = (code: string) => {
    violation ??= code;
    void context.close().catch(() => undefined);
  };
  const timeout = setTimeout(() => reject("opaque-capture-timeout"), 30_000);
  try {
    const map = new Map<string, { mediaType: string; bytes: Buffer }>();
    let size = Buffer.byteLength(input.javascript);
    if (size > MAX_BYTES) throw new Error("opaque-input-invalid");
    for (const asset of input.assets) {
      if (!validateOpaqueAsset(asset)) throw new Error("opaque-asset-invalid");
      if (
        !asset.path ||
        asset.path.startsWith("/") ||
        asset.path.split("/").some((p) => p === ".." || p === "." || p === "") ||
        /[\\?#:]/.test(asset.path) ||
        map.has(ORIGIN + asset.path)
      )
        throw new Error("opaque-asset-invalid");
      const bytes = Buffer.from(asset.dataBase64, "base64");
      size += bytes.length;
      if (bytes.toString("base64") !== asset.dataBase64 || size > MAX_BYTES)
        throw new Error("opaque-asset-invalid");
      map.set(ORIGIN + asset.path, { mediaType: asset.mediaType, bytes });
    }
    if (
      new Set(input.stylesheets).size !== input.stylesheets.length ||
      input.stylesheets.some((path) => map.get(ORIGIN + path)?.mediaType !== "text/css")
    )
      throw new Error("opaque-asset-invalid");
    const css = input.stylesheets
      .map(
        (path) =>
          `<link rel="stylesheet" href="/${path.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`,
      )
      .join("");
    const scale = input.pixelTarget[0] / input.logicalSize[0];
    if (Math.abs(input.logicalSize[1] * scale - input.pixelTarget[1]) > 1)
      throw new Error("opaque-input-invalid");
    const html = `<!doctype html><html><head><meta charset="utf-8">${css}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:rgba(${input.background.slice(0, 3).join(",")},${input.background[3] / 255})}*{animation:none!important;transition:none!important;caret-color:transparent!important;font-synthesis:none!important}#unframe-root{width:${input.logicalSize[0]}px;height:${input.logicalSize[1]}px;transform-origin:0 0;transform:scale(${scale})}</style></head><body><div id="unframe-root"></div><script src="/__renderer.js"></script></body></html>`;
    if (map.has(ORIGIN + "__renderer.js")) throw new Error("opaque-asset-invalid");
    map.set(ORIGIN, { mediaType: "text/html", bytes: Buffer.from(html) });
    map.set(ORIGIN + "__renderer.js", {
      mediaType: "text/javascript",
      bytes: Buffer.from(input.javascript),
    });
    await context.addInitScript({ content: fixedBrowserInitScript + "\n" + restrictionScript });
    await context.routeWebSocket("**/*", (ws) => {
      ws.close();
      reject("opaque-capability-denied");
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const asset = map.get(request.url());
      if (
        !asset ||
        request.method() !== "GET" ||
        (request.isNavigationRequest() && request.url() !== ORIGIN)
      ) {
        await route.abort();
        reject("opaque-network-denied");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: asset.mediaType,
        body: asset.bytes,
        headers: {
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    });
    const page = await context.newPage();
    context.on("page", (other) => {
      if (other !== page) reject("opaque-capability-denied");
    });
    page.on("worker", () => reject("opaque-capability-denied"));
    page.on("download", () => reject("opaque-capability-denied"));
    page.on("pageerror", () => reject("opaque-render-failed"));
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame() || frame.url() !== ORIGIN) reject("opaque-navigation-denied");
    });
    await page.goto(ORIGIN, { waitUntil: "load", timeout: 30_000 });
    const cdp = await context.newCDPSession(page);
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "unframe-observer",
    });
    const evaluate = async <T>(expression: string, contextId?: number): Promise<T> => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        ...(contextId === undefined ? {} : { contextId }),
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        const message = result.exceptionDetails.exception?.description?.split("\n")[0];
        const code = message?.match(
          /^Error: (opaque-(?:element-unsupported|binding-invalid|binding-invisible|geometry-unsupported))$/,
        )?.[1];
        throw new Error(
          code ??
            (contextId === undefined ? "opaque-render-failed" : "opaque-dom-inspection-failed"),
        );
      }
      return result.result.value as T;
    };

    const isolated = <T>(expression: string) => evaluate<T>(expression, executionContextId);
    const rejectAuthorShadowRoots = async () => {
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const visit = (node: typeof root): void => {
        for (const shadow of node.shadowRoots ?? []) {
          if (shadow.shadowRootType !== "user-agent") throw new Error("opaque-element-unsupported");
          visit(shadow);
        }
        for (const child of node.children ?? []) visit(child);
        for (const pseudo of node.pseudoElements ?? []) visit(pseudo);
      };
      visit(root);
    };

    const bindings = Object.fromEntries(
      (input.bindingKeys ?? Object.keys(input.expectedBindings)).map((key) => [
        key.slice(5),
        { "data-unframe-binding": key },
      ]),
    );
    await evaluate(
      `globalThis.__unframeMount(${JSON.stringify({ props: input.props, texts: input.texts, bindings, state: input.stateKey ?? "default" })})`,
    );
    await rejectAuthorShadowRoots();
    const imageUrls = input.assets
      .filter((asset) => asset.mediaType.startsWith("image/"))
      .map((asset) => ORIGIN + asset.path);
    await isolated(
      `(async()=>{await Promise.all([...document.fonts].map(f=>f.load()));await document.fonts.ready;})()`,
    ).catch(() => {
      throw new Error("opaque-font-invalid");
    });
    await isolated(
      `(async()=>{const images=${JSON.stringify(imageUrls)}.map(url=>{const image=new Image();image.src=url;return image;});await Promise.all([...images,...document.images].map(i=>i.decode()));})()`,
    ).catch(() => {
      throw new Error("opaque-image-invalid");
    });
    const validateFonts = await createOpaqueFontValidator(input.assets, cdp, isolated);
    const observe = async () => {
      await rejectAuthorShadowRoots();
      const result = validateOpaqueBindings(
        input.expectedBindings,
        await isolated<OpaqueBinding[]>(
          `${observeScript}(${JSON.stringify(Object.keys(input.buttonBindings ?? {}))})`,
        ),
      );
      if (!result.ok) throw new Error("opaque-binding-invalid");
      const scale = input.pixelTarget[0] / input.logicalSize[0];
      return result.bindings.map((binding) => ({
        ...binding,
        x: binding.x / scale,
        y: binding.y / scale,
        width: binding.width / scale,
        height: binding.height / scale,
      }));
    };
    let previous:
      | { fingerprint: string; rgba: Buffer; bindings: readonly OpaqueBinding[] }
      | undefined;
    for (;;) {
      await isolated("new Promise(resolve=>requestAnimationFrame(()=>resolve()))");
      if (await evaluate("__unframeViolation")) throw new Error("opaque-capability-denied");
      await validateFonts();
      const observed = await observe();
      const fingerprint = JSON.stringify(observed);
      const rgba = pngBytes(
        await page.screenshot({
          type: "png",
          animations: "disabled",
          caret: "hide",
          scale: "css",
          omitBackground: true,
        }),
        input.pixelTarget,
      );
      if (JSON.stringify(await observe()) !== fingerprint) {
        previous = undefined;
        continue;
      }
      if (violation) throw new Error(violation);
      if (await evaluate("__unframeViolation")) throw new Error("opaque-capability-denied");
      if (previous?.fingerprint === fingerprint && previous.rgba.equals(rgba))
        return {
          ok: true,
          rgbaBase64: rgba.toString("base64"),
          pixelSize: input.pixelTarget,
          bindings: observed,
          browserVersion: browser.version(),
        };
      previous = { fingerprint, rgba, bindings: observed };
    }
  } catch (error) {
    const code =
      violation ??
      (error instanceof Error && /^opaque-[a-z-]+$/.test(error.message)
        ? error.message
        : "opaque-render-failed");
    return { ok: false, code };
  } finally {
    clearTimeout(timeout);
    await context.close();
  }
};
