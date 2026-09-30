import { describe, expect, it, vi } from "vitest";

import {
  createPlaywrightFixedBrowserFactory,
  type BrowserDriver,
} from "../src/browser/playwright-fixed-browser.js";
import type { FixedBrowserSession } from "../src/index.js";

const request = {
  capabilities: {
    clock: "fixed" as const,
    colorSpace: "srgb" as const,
    deviceScaleFactor: 1 as const,
    filesystem: "deny" as const,
    network: "deny" as const,
    random: "fixed" as const,
  },
  colorScheme: "dark" as const,
  document: "<!doctype html><html><body>capture</body></html>",
  environment: {
    browser: {
      fontFingerprint: "sha256:477649c3440112aa6ceb0ec1967fd774def2a28b041fcd29030879d6f32ef398",
      id: "playwright-chromium",
      version: "123.4.5",
    },
    clock: "fixed" as const,
    colorSpace: "srgb" as const,
    deviceScaleFactor: 1 as const,
    filesystem: "deny" as const,
    locale: "ja-JP",
    network: "deny" as const,
    random: "fixed" as const,
    timezone: "Asia/Tokyo",
  },
  fontFaceCount: 0,
  pixelTarget: [2, 1] as const,
  stateId: "default",
};

const png = Uint8Array.of(
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0,
  2,
  0,
  0,
  0,
  1,
  8,
  6,
  0,
  0,
  0,
  244,
  34,
  127,
  138,
  0,
  0,
  0,
  17,
  73,
  68,
  65,
  84,
  120,
  1,
  99,
  248,
  207,
  192,
  240,
  31,
  132,
  25,
  0,
  15,
  248,
  3,
  253,
  19,
  109,
  42,
  112,
  0,
  0,
  0,
  0,
  73,
  69,
  78,
  68,
  174,
  66,
  96,
  130,
);

const probePng = Uint8Array.from(png);
probePng.set([0, 0, 1, 0], 16);
probePng.set([0, 0, 0, 64], 20);

const driver = (probeValue = 0) => {
  let screenshotCount = 0;
  const page = {
    evaluate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => (screenshotCount++ === 0 ? probePng : png)),
    setContent: vi.fn(async () => undefined),
  };
  const context = {
    addInitScript: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    route: vi.fn(async () => undefined),
  };
  const browser = {
    close: vi.fn(async () => undefined),
    newContext: vi.fn(async () => context),
    version: vi.fn(() => "123.4.5"),
  };
  const value: BrowserDriver = {
    decodePng: vi.fn((bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      if (width === 256 && height === 64) {
        const data = new Uint8Array(width * height * 4);
        for (let index = 0; index < data.length; index += 4) {
          data[index] = probeValue;
          data[index + 3] = 255;
        }
        return { data, height, width };
      }
      return {
        data: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255),
        height: 1,
        width: 2,
      };
    }),
    launch: vi.fn(async () => browser),
  };
  return { browser, context, page, value };
};

const captureRequest = (session: FixedBrowserSession) => ({
  ...request,
  environment: session.environment,
});

describe("Playwright Fixed Browser", () => {
  it("起動中のabortでsessionを公開せず、遅れて起動したbrowserも閉じる", async () => {
    const fake = driver();
    let finishLaunch: (() => void) | undefined;
    fake.value.launch = vi.fn(
      () =>
        new Promise<typeof fake.browser>((resolve) => {
          finishLaunch = () => resolve(fake.browser);
        }),
    );
    const controller = new AbortController();
    const opening = createPlaywrightFixedBrowserFactory(fake.value)({ signal: controller.signal });

    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    finishLaunch?.();
    await vi.waitFor(() => expect(fake.browser.close).toHaveBeenCalledOnce());
    expect(fake.browser.newContext).not.toHaveBeenCalled();
  });

  it("managed Chromiumだけを固定環境で起動し、隔離contextからRGBAをcaptureする", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();

    expect(fake.value.launch).toHaveBeenCalledWith({
      chromiumSandbox: true,
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      headless: true,
    });
    expect(session.environment).toMatchObject({
      browser: {
        fontFingerprint: expect.stringMatching(/^sha256:/),
        id: "playwright-chromium",
        version: "123.4.5",
      },
      deviceScaleFactor: 1,
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
    });

    await expect(session.capture(captureRequest(session))).resolves.toEqual({
      alphaMode: "opaque",
      colorSpace: "srgb",
      pixelSize: [2, 1],
      rgba: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255),
    });
    expect(fake.browser.newContext).toHaveBeenCalledWith({
      acceptDownloads: false,
      colorScheme: "dark",
      deviceScaleFactor: 1,
      locale: "ja-JP",
      offline: true,
      serviceWorkers: "block",
      timezoneId: "Asia/Tokyo",
      viewport: { height: 1, width: 2 },
    });
    expect(fake.context.addInitScript).toHaveBeenCalledTimes(2);
    const init = fake.context.addInitScript.mock.calls[1] as unknown as [string];
    expect(init[0]).toContain("946684800000");
    expect(init[0]).toContain("0x5eed");
    expect(init[0]).toContain("performance");
    expect(init[0]).toContain("getRandomValues");
    expect(init[0]).toContain("randomUUID");
    expect(init[0]).toContain("Web Crypto is unavailable");
    expect(fake.context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    expect(fake.page.setContent).toHaveBeenCalledWith(request.document, { waitUntil: "load" });
    expect(fake.page.evaluate).toHaveBeenCalledTimes(2);
    expect(fake.page.evaluate).toHaveBeenLastCalledWith(0);
    expect(fake.page.screenshot).toHaveBeenCalledWith({
      animations: "disabled",
      caret: "hide",
      omitBackground: true,
      scale: "css",
      type: "png",
    });
    expect(fake.value.decodePng).toHaveBeenCalledWith(png);
    expect(fake.context.close).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("abortとcloseで進行中contextを閉じ、browserを一度だけ閉じる", async () => {
    const fake = driver();
    let unblockScreenshot: (() => void) | undefined;
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.page.screenshot.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          unblockScreenshot = () => resolve(new Uint8Array(png));
        }),
    );
    const controller = new AbortController();
    const capture = session.capture(captureRequest(session), { signal: controller.signal });
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalledOnce());
    controller.abort();
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.context.close).toHaveBeenCalledTimes(2);

    const second = session.capture(captureRequest(session));
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalledTimes(2));
    const closing = session.close();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    await Promise.all([closing, session.close()]);
    expect(fake.browser.close).toHaveBeenCalledOnce();
    unblockScreenshot?.();
  });

  it("壊れたPNGをcaptureとして公開せず、失敗してもcontextを閉じる", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.value.decodePng = vi.fn(() => ({
      data: Uint8Array.of(0, 0, 0, 255),
      height: 1,
      width: 1,
    }));
    await expect(session.capture(captureRequest(session))).rejects.toThrow(
      "PNG dimensions must match",
    );
    expect(fake.context.close).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("FontFace load failureをcapture failureとして返してcontextを閉じる", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.page.screenshot.mockClear();
    fake.page.evaluate.mockRejectedValueOnce(new Error("font load failed"));
    await expect(session.capture({ ...captureRequest(session), fontFaceCount: 1 })).rejects.toThrow(
      "font load failed",
    );
    expect(fake.context.close).toHaveBeenCalledTimes(2);
    expect(fake.page.screenshot).not.toHaveBeenCalled();
    await session.close();
  });

  it("context cleanupが失敗してもsession closeはbrowser closeを試みる", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.page.screenshot.mockImplementation(
      () => new Promise<Uint8Array<ArrayBuffer>>(() => undefined),
    );
    fake.context.close.mockRejectedValue(new Error("context close failed"));
    fake.browser.close.mockRejectedValue(new Error("browser close failed"));
    const capture = session.capture(captureRequest(session));
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalledOnce());
    await expect(session.close()).rejects.toThrow("context close failed");
    await expect(capture).rejects.toThrow("context close failed");
    expect(fake.browser.close).toHaveBeenCalledOnce();
  });

  it("固定profile以外のrequestを起動前に拒否し、transparent PNGはstraight RGBAとして返す", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.value.decodePng = vi.fn(() => ({
      data: Uint8Array.of(1, 2, 3, 128, 4, 5, 6, 255),
      height: 1,
      width: 2,
    }));
    await expect(session.capture(captureRequest(session))).resolves.toMatchObject({
      alphaMode: "straight",
    });
    await expect(
      session.capture({
        ...captureRequest(session),
        environment: { ...session.environment, locale: "en-US" },
      }),
    ).rejects.toThrow("fixed Browser environment");
    await expect(
      session.capture({
        ...captureRequest(session),
        environment: {
          ...session.environment,
          browser: { ...session.environment.browser, fontFingerprint: "sha256:forged" },
        },
      }),
    ).rejects.toThrow("fixed Browser environment");
    await expect(
      session.capture({ ...captureRequest(session), pixelTarget: [0, 1] }),
    ).rejects.toThrow("fixed Browser environment");
    expect(fake.browser.newContext).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("trust-boundaryの4096px/16,777,216px上限をcapture前に適用する", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    await expect(
      session.capture({ ...captureRequest(session), pixelTarget: [4097, 1] }),
    ).rejects.toThrow("fixed Browser environment");
    await expect(
      session.capture({ ...captureRequest(session), pixelTarget: [4096, 4096] }),
    ).rejects.toThrow("PNG dimensions must match");
    expect(fake.browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { height: 4096, width: 4096 } }),
    );
    await session.close();
  });

  it("font probeの異なるactual bytesは異なるfingerprintになる", async () => {
    const fake = driver();
    const first = await createPlaywrightFixedBrowserFactory(fake.value)();
    const different = driver(9);
    const second = await createPlaywrightFixedBrowserFactory(different.value)();
    expect(first.environment.browser.fontFingerprint).not.toBe(
      second.environment.browser.fontFingerprint,
    );
    await Promise.all([first.close(), second.close()]);
  });

  it("不完全なfont probeをidentityとして公開せずcontextとbrowserを閉じる", async () => {
    const fake = driver();
    fake.value.decodePng = vi.fn(() => ({
      data: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255),
      height: 1,
      width: 2,
    }));

    await expect(createPlaywrightFixedBrowserFactory(fake.value)()).rejects.toThrow(
      "complete baseline RGBA",
    );
    expect(fake.context.close).toHaveBeenCalledOnce();
    expect(fake.browser.close).toHaveBeenCalledOnce();
  });

  it("不正なcolor schemeとAbortSignalをcontext作成前に拒否する", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    await expect(
      session.capture({ ...captureRequest(session), colorScheme: "contrast" as never }),
    ).rejects.toThrow("fixed Browser environment");
    await expect(
      session.capture(captureRequest(session), { signal: {} as AbortSignal }),
    ).rejects.toThrow("fixed Browser environment");
    expect(fake.browser.newContext).toHaveBeenCalledOnce();
    await session.close();
  });

  it("PNG preflightはinjected decoder前にencoded bytesとIHDR上限を拒否する", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    fake.page.screenshot.mockResolvedValueOnce(new Uint8Array(65 * 1024 * 1024 + 1));
    await expect(session.capture(captureRequest(session))).rejects.toThrow("PNG bytes exceed");
    expect(fake.value.decodePng).toHaveBeenCalledOnce();

    const huge = Uint8Array.from(png);
    huge.set([0, 0, 16, 1], 16);
    fake.page.screenshot.mockResolvedValueOnce(huge);
    await expect(session.capture(captureRequest(session))).rejects.toThrow("PNG dimensions exceed");
    expect(fake.value.decodePng).toHaveBeenCalledOnce();

    await expect(session.capture(captureRequest(session))).resolves.toMatchObject({
      pixelSize: [2, 1],
    });
    expect(fake.value.decodePng).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("pending newContextをcloseが待ち、context cleanup後にbrowserを閉じる", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    let resolveContext: ((context: typeof fake.context) => void) | undefined;
    fake.browser.newContext.mockImplementationOnce(
      () => new Promise((resolve) => (resolveContext = resolve)),
    );
    const capture = session.capture(captureRequest(session));
    const closing = session.close();
    expect(fake.browser.close).not.toHaveBeenCalled();
    resolveContext?.(fake.context);
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    await closing;
    expect(fake.context.close.mock.invocationCallOrder[1]).toBeLessThan(
      fake.browser.close.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("複数captureのcleanup失敗でも他contextのcleanup完了後にbrowserを閉じる", async () => {
    const fake = driver();
    const session = await createPlaywrightFixedBrowserFactory(fake.value)();
    const second = { ...fake.context, close: vi.fn(async () => undefined) };
    fake.browser.newContext.mockResolvedValueOnce(fake.context).mockResolvedValueOnce(second);
    fake.page.screenshot.mockImplementation(
      () => new Promise<Uint8Array<ArrayBuffer>>(() => undefined),
    );
    const firstCapture = session.capture(captureRequest(session));
    const secondCapture = session.capture(captureRequest(session));
    await vi.waitFor(() => expect(fake.page.screenshot).toHaveBeenCalledTimes(3));
    fake.context.close.mockRejectedValueOnce(new Error("first cleanup failed"));
    await expect(session.close()).rejects.toThrow("first cleanup failed");
    await expect(firstCapture).rejects.toThrow();
    await expect(secondCapture).rejects.toThrow();
    expect(second.close).toHaveBeenCalled();
    expect(second.close.mock.invocationCallOrder[0]).toBeLessThan(
      fake.browser.close.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
