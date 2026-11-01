import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type LaunchOptions,
  type Page,
  type Route,
} from "playwright-core";

export const launchChromium = (options: LaunchOptions) => chromium.launch(options);

export const createChromiumPage = (page: Page) => ({
  page,
  loadDocument: (document: string) => page.setContent(document, { waitUntil: "load" }),
  loadUrl: async (url: string) => {
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  },
  waitFor: async (expression: string) => {
    await page.evaluate(expression);
  },
  capture: async () =>
    Uint8Array.from(
      await page.screenshot({
        type: "png",
        scale: "css",
        omitBackground: true,
        animations: "disabled",
        caret: "hide",
      }),
    ),
  evaluate: (
    cdp: CDPSession,
    expression: string,
    contextId?: number,
  ): Promise<{
    result: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string } };
  }> =>
    cdp.send("Runtime.evaluate", {
      expression,
      ...(contextId === undefined ? {} : { contextId }),
      awaitPromise: true,
      returnByValue: true,
    }),
});

export const openChromiumPage = async (context: BrowserContext) =>
  createChromiumPage(await context.newPage());

export const routeChromiumResources = (
  context: BrowserContext,
  handler: (route: Route) => Promise<void>,
) => context.route("**/*", handler);
