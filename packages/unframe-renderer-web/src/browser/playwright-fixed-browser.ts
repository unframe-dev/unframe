import {
  chromium,
  type BrowserContext as PlaywrightBrowserContext,
  type Page as PlaywrightPage,
  type Route,
} from "playwright-core";
import { PNG } from "pngjs";

import type {
  BrowserCaptureRequest,
  BrowserRgbaCapture,
  FixedBrowserSession,
} from "../public-types.js";
import { hash } from "../config/config-environment.js";

type BrowserContextOptions = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: 1;
  readonly locale: "ja-JP";
  readonly timezoneId: "Asia/Tokyo";
  readonly colorScheme: "light" | "dark";
  readonly offline: true;
  readonly acceptDownloads: false;
  readonly serviceWorkers: "block";
};

type BrowserLaunchOptions = {
  readonly headless: true;
  readonly chromiumSandbox: true;
  readonly handleSIGINT: false;
  readonly handleSIGTERM: false;
  readonly handleSIGHUP: false;
};

type BrowserPage = {
  setContent(document: string, options: { readonly waitUntil: "load" }): Promise<void>;
  evaluate(): Promise<void>;
  screenshot(options: {
    readonly type: "png";
    readonly scale: "css";
    readonly omitBackground: false;
    readonly animations: "disabled";
    readonly caret: "hide";
  }): Promise<Uint8Array<ArrayBufferLike>>;
};

type BrowserContext = {
  addInitScript(script: string): Promise<void>;
  route(url: string, handler: () => Promise<void>): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
};

type LaunchedBrowser = {
  version(): string;
  newContext(options: BrowserContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
};

export type BrowserDriver = {
  launch(options: BrowserLaunchOptions): Promise<LaunchedBrowser>;
  decodePng(bytes: Uint8Array): {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
  };
};

const FIXED_TIME_MS = 946684800000;
const RANDOM_SEED = 0x5eed;
const FONT_PROFILE = "Noto Sans CJK JP";
const MAX_CAPTURE_DIMENSION = 4096;
const MAX_CAPTURE_PIXELS = 16_777_216;
const MAX_ENCODED_PNG_BYTES = 65 * 1024 * 1024;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const initScript = `(() => {
  const fixedTime = ${FIXED_TIME_MS};
  const OriginalDate = Date;
  function FixedDate(...args) {
    if (new.target)
      return Reflect.construct(OriginalDate, args.length === 0 ? [fixedTime] : args, new.target);
    return new OriginalDate(fixedTime).toString();
  }
  Object.setPrototypeOf(FixedDate, OriginalDate);
  FixedDate.prototype = OriginalDate.prototype;
  FixedDate.now = () => fixedTime;
  let state = 0x${RANDOM_SEED.toString(16)};
  const nextUint32 = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  Math.random = () => nextUint32() / 4294967296;
  Object.defineProperty(performance, "now", { value: () => 0 });
  Object.defineProperty(performance, "timeOrigin", { value: fixedTime });
  const fillRandom = (array) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = nextUint32() & 0xff;
    return array;
  };
  Object.defineProperty(crypto, "getRandomValues", { value: fillRandom });
  Object.defineProperty(crypto, "subtle", {
    get: () => { throw new DOMException("Web Crypto is unavailable in the fixed renderer.", "NotAllowedError"); },
  });
  Object.defineProperty(crypto, "randomUUID", {
    value: () => {
      const bytes = fillRandom(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
      return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" +
        hex.slice(10).join("");
    },
  });
  globalThis.Date = FixedDate;
})();`;

const aborted = () => {
  const error = new Error("Fixed Browser capture was aborted.");
  error.name = "AbortError";
  return error;
};

const alphaModeFor = (rgba: Uint8Array): "opaque" | "straight" =>
  rgba.every((value, index) => index % 4 !== 3 || value === 255) ? "opaque" : "straight";

const hasFixedEnvironment = (request: BrowserCaptureRequest, fontFingerprint: string) =>
  request.environment.browser.id === "playwright-chromium" &&
  request.environment.browser.version.length > 0 &&
  request.environment.browser.fontFingerprint === fontFingerprint &&
  request.environment.locale === "ja-JP" &&
  request.environment.timezone === "Asia/Tokyo" &&
  request.environment.colorSpace === "srgb" &&
  request.environment.deviceScaleFactor === 1 &&
  request.environment.network === "deny" &&
  request.environment.filesystem === "deny" &&
  request.environment.clock === "fixed" &&
  request.environment.random === "fixed" &&
  request.capabilities.colorSpace === "srgb" &&
  request.capabilities.deviceScaleFactor === 1 &&
  request.capabilities.network === "deny" &&
  request.capabilities.filesystem === "deny" &&
  request.capabilities.clock === "fixed" &&
  request.capabilities.random === "fixed";

const hasPixelTarget = (value: readonly [number, number]) =>
  value.every(
    (dimension) =>
      Number.isSafeInteger(dimension) && dimension > 0 && dimension <= MAX_CAPTURE_DIMENSION,
  ) && value[0] * value[1] <= MAX_CAPTURE_PIXELS;

const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const isAbortSignal = (value: unknown): value is AbortSignal => {
  try {
    return (
      typeof value === "object" && value !== null && abortSignalAborted?.call(value) !== undefined
    );
  } catch {
    return false;
  }
};

const preflightPng = (bytes: Uint8Array) => {
  if (bytes.byteLength > MAX_ENCODED_PNG_BYTES)
    throw new TypeError("PNG bytes exceed the Fixed Browser trust boundary.");
  if (
    bytes.byteLength < 24 ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value) ||
    bytes[12] !== 73 ||
    bytes[13] !== 72 ||
    bytes[14] !== 68 ||
    bytes[15] !== 82 ||
    bytes[8] !== 0 ||
    bytes[9] !== 0 ||
    bytes[10] !== 0 ||
    bytes[11] !== 13
  )
    throw new TypeError("Browser screenshot must be a PNG with an IHDR header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width === 0 ||
    height === 0 ||
    width > MAX_CAPTURE_DIMENSION ||
    height > MAX_CAPTURE_DIMENSION ||
    width * height > MAX_CAPTURE_PIXELS
  )
    throw new TypeError("PNG dimensions exceed the Fixed Browser trust boundary.");
};

const decodePng = (bytes: Uint8Array) => {
  preflightPng(bytes);
  const decoded = PNG.sync.read(Buffer.from(bytes));
  return { width: decoded.width, height: decoded.height, data: Uint8Array.from(decoded.data) };
};

const playwrightDriver: BrowserDriver = {
  launch: async (options) => {
    const browser = await chromium.launch(options);
    return {
      version: () => browser.version(),
      newContext: async (contextOptions) => contextFor(await browser.newContext(contextOptions)),
      close: async () => browser.close(),
    };
  },
  decodePng,
};

const FONT_PROBE_DOCUMENT = `<!doctype html><html><head><style>html,body{margin:0;background:#fff;color:#000;font-family:"${FONT_PROFILE}";font-size:32px;line-height:1}body{width:256px;height:64px;overflow:hidden}</style></head><body>あいう漢字ＡＢＣ123</body></html>`;
const screenshotOptions = Object.freeze({
  type: "png" as const,
  scale: "css" as const,
  omitBackground: false as const,
  animations: "disabled" as const,
  caret: "hide" as const,
});

const fontFingerprintFor = async (browser: LaunchedBrowser, driver: BrowserDriver) => {
  const context = await browser.newContext({
    viewport: { width: 256, height: 64 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    offline: true,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  try {
    await context.addInitScript(initScript);
    await context.route("**/*", async () => undefined);
    const page = await context.newPage();
    await page.setContent(FONT_PROBE_DOCUMENT, { waitUntil: "load" });
    await page.evaluate();
    const png = await page.screenshot(screenshotOptions);
    preflightPng(png);
    const decoded = driver.decodePng(png);
    if (decoded.width !== 256 || decoded.height !== 64 || decoded.data.byteLength !== 256 * 64 * 4)
      throw new TypeError("Fixed Browser font probe must produce the complete baseline RGBA.");
    return hash({ fontProfile: FONT_PROFILE, rgba: Array.from(decoded.data) });
  } finally {
    await context.close();
  }
};

const contextFor = (context: PlaywrightBrowserContext): BrowserContext => ({
  addInitScript: async (script) => {
    await context.addInitScript({ content: script });
  },
  route: async (url, handler) => {
    await context.route(url, async (route: Route) => {
      await handler();
      await route.abort("blockedbyclient");
    });
  },
  newPage: async () => pageFor(await context.newPage()),
  close: async () => context.close(),
});

const pageFor = (page: PlaywrightPage): BrowserPage => ({
  setContent: async (document, options) => page.setContent(document, options),
  evaluate: async () => {
    await page.evaluate("document.fonts.ready");
  },
  screenshot: async (options) => Uint8Array.from(await page.screenshot(options)),
});

type CaptureOperation = {
  readonly controller: AbortController;
  closeContext(): Promise<void>;
};

const abortable = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw aborted();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
};

export const createPlaywrightFixedBrowserFactory =
  (driver: BrowserDriver) =>
  async (options: { readonly signal?: AbortSignal } = {}): Promise<FixedBrowserSession> => {
    const launch = driver.launch({
      headless: true,
      chromiumSandbox: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    let browser: LaunchedBrowser;
    try {
      browser = options.signal ? await abortable(launch, options.signal) : await launch;
    } catch (error) {
      if (options.signal?.aborted)
        void launch.then((lateBrowser) => lateBrowser.close()).catch(() => undefined);
      throw error;
    }
    let fontFingerprint: string;
    try {
      const fingerprint = fontFingerprintFor(browser, driver);
      fontFingerprint = options.signal
        ? await abortable(fingerprint, options.signal)
        : await fingerprint;
    } catch (error) {
      await browser.close();
      throw error;
    }
    const environment = Object.freeze({
      browser: Object.freeze({
        id: "playwright-chromium",
        version: browser.version(),
        fontFingerprint,
      }),
      locale: "ja-JP" as const,
      timezone: "Asia/Tokyo" as const,
      colorSpace: "srgb" as const,
      deviceScaleFactor: 1 as const,
      network: "deny" as const,
      filesystem: "deny" as const,
      clock: "fixed" as const,
      random: "fixed" as const,
    });
    const identity = Object.freeze({
      id: "playwright-chromium",
      implementationHash: hash({
        adapter: "playwright-fixed-browser",
        browser: environment.browser,
        locale: environment.locale,
        timezone: environment.timezone,
        fixedTimeMs: FIXED_TIME_MS,
        randomSeed: RANDOM_SEED,
        fontProfile: FONT_PROFILE,
      }),
    });
    const active = new Set<CaptureOperation>();
    let closing = false;
    let closePromise: Promise<void> | undefined;

    const close = (): Promise<void> => {
      closePromise ??= (async () => {
        closing = true;
        const operations = [...active];
        for (const operation of operations) operation.controller.abort();
        const results = await Promise.allSettled(
          operations.map((operation) => operation.closeContext()),
        );
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        let browserCloseError: unknown;
        try {
          await browser.close();
        } catch (error) {
          browserCloseError = error;
        }
        if (rejected) throw rejected.reason;
        if (browserCloseError) throw browserCloseError;
      })();
      return closePromise;
    };

    const capture = async (
      request: BrowserCaptureRequest,
      captureOptions?: { readonly signal?: AbortSignal },
    ): Promise<BrowserRgbaCapture> => {
      if (closing) throw aborted();
      const externalSignal = captureOptions?.signal;
      if (
        !hasFixedEnvironment(request, fontFingerprint) ||
        request.environment.browser.version !== environment.browser.version ||
        !hasPixelTarget(request.pixelTarget) ||
        (request.colorScheme !== "light" && request.colorScheme !== "dark") ||
        (externalSignal !== undefined && !isAbortSignal(externalSignal))
      )
        throw new TypeError("Capture request must match the fixed Browser environment.");
      const controller = new AbortController();
      let contextClose: Promise<void> | undefined;
      const contextReady = browser.newContext({
        viewport: { width: request.pixelTarget[0], height: request.pixelTarget[1] },
        deviceScaleFactor: 1,
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        colorScheme: request.colorScheme,
        offline: true,
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      const operation: CaptureOperation = {
        controller,
        closeContext: () =>
          (contextClose ??= contextReady.then(async (context) => {
            await context.close();
          })),
      };
      active.add(operation);
      try {
        const signal = AbortSignal.any(
          [controller.signal, externalSignal].filter(
            (value): value is AbortSignal => value !== undefined,
          ),
        );
        if (closing || signal.aborted) throw aborted();
        const context = await abortable(contextReady, signal);
        await abortable(context.addInitScript(initScript), signal);
        await abortable(
          context.route("**/*", async () => undefined),
          signal,
        );
        const page = await abortable(context.newPage(), signal);
        await abortable(page.setContent(request.document, { waitUntil: "load" }), signal);
        await abortable(page.evaluate(), signal);
        const screenshot = await abortable(page.screenshot(screenshotOptions), signal);
        preflightPng(screenshot);
        const decoded = driver.decodePng(screenshot);
        const [width, height] = request.pixelTarget;
        if (decoded.width !== width || decoded.height !== height)
          throw new TypeError("PNG dimensions must match the requested pixel target.");
        const rgba = Uint8Array.from(decoded.data);
        if (rgba.byteLength !== width * height * 4)
          throw new TypeError("PNG RGBA bytes must match the requested pixel target.");
        return {
          rgba,
          pixelSize: [width, height],
          colorSpace: "srgb",
          alphaMode: alphaModeFor(rgba),
        };
      } finally {
        try {
          await operation.closeContext();
        } finally {
          active.delete(operation);
        }
      }
    };

    return Object.freeze({ identity, environment, capture, close });
  };

export const openPlaywrightFixedBrowser = createPlaywrightFixedBrowserFactory(playwrightDriver);
