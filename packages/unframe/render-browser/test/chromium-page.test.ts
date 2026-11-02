import { expect, it, vi } from "vitest";
import type { CDPSession, Page } from "playwright-core";
import { createChromiumPage } from "../src/index.js";

it("loads a document, waits for assets, captures pixels and observes geometry", async () => {
  const page = {
    setContent: vi.fn(async () => undefined),
    goto: vi.fn(async () => null),
    evaluate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from([1, 2])),
  };
  const cdp = { send: vi.fn(async () => ({ result: { value: { x: 12 } } })) };
  const browserPage = createChromiumPage(page as unknown as Page);
  await browserPage.loadDocument("<p>hello</p>");
  await browserPage.loadUrl("https://unframe.invalid/");
  await browserPage.waitFor("document.fonts.ready");
  expect(await browserPage.capture()).toEqual(Uint8Array.of(1, 2));
  expect(await browserPage.evaluate(cdp as unknown as CDPSession, "geometry", 42)).toEqual({
    result: { value: { x: 12 } },
  });
  expect(page.setContent).toHaveBeenCalledWith("<p>hello</p>", { waitUntil: "load" });
  expect(page.goto).toHaveBeenCalledWith("https://unframe.invalid/", {
    waitUntil: "load",
    timeout: 30000,
  });
  expect(cdp.send).toHaveBeenCalledWith("Runtime.evaluate", {
    expression: "geometry",
    contextId: 42,
    awaitPromise: true,
    returnByValue: true,
  });
});
