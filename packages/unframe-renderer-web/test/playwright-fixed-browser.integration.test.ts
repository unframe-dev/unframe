import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
  openPlaywrightFixedBrowser,
} from "../src/index.js";
import {
  adapterIdentity,
  config,
  environment,
  nestedInputFor,
} from "./fixtures/static-renderer.js";

describe("Playwright Fixed Browser integration", () => {
  it("provision済みmanaged ChromiumでFrame/Text相当のdocumentをPNG captureする", async () => {
    const session = await openPlaywrightFixedBrowser();
    const secondSession = await openPlaywrightFixedBrowser();
    try {
      const request = {
        stateId: "default",
        document:
          '<!doctype html><html><body style="margin:0;background:rgb(255,0,0)"><script>const bytes=new Uint8Array(4);crypto.getRandomValues(bytes);const value=[Date.now(),Date(),performance.now(),performance.timeOrigin,Math.random(),crypto.randomUUID(),...bytes].join(":");let hash=0;for(const char of value)hash=(hash*31+char.charCodeAt(0))>>>0;document.body.style.background=`rgb(${hash&255},${(hash>>>8)&255},1)`</script></body></html>',
        fontFaceCount: 0,
        pixelTarget: [2, 1],
        colorScheme: "light",
        environment: session.environment,
        capabilities: {
          network: "deny",
          filesystem: "deny",
          clock: "fixed",
          random: "fixed",
          deviceScaleFactor: 1,
          colorSpace: "srgb",
        },
      } as const;
      const capture = await session.capture(request);
      const repeated = await session.capture(request);
      expect(capture.pixelSize).toEqual([2, 1]);
      expect(capture.rgba).toHaveLength(8);
      expect(capture.colorSpace).toBe("srgb");
      expect(session.environment.browser.fontFingerprint).toMatch(/^sha256:/);
      expect(secondSession.environment.browser.fontFingerprint).toBe(
        session.environment.browser.fontFingerprint,
      );
      expect(repeated.rgba).toEqual(capture.rgba);
      expect(Array.from(capture.rgba.slice(0, 4))).not.toEqual([255, 0, 0, 255]);
    } finally {
      await session.close();
      await secondSession.close();
    }
  });

  it("実Renderer documentのnested Frameを親相対配置しstyle・clip・font順を維持する", async () => {
    const browser = await chromium.launch({ headless: true });
    let captureCount = 0;
    const observations: unknown[] = [];
    try {
      const renderer = createBakedWebRenderer({
        adapter: {
          identity: adapterIdentity,
          environment,
          async capture(request) {
            captureCount++;
            const page = await browser.newPage({
              viewport: { width: request.pixelTarget[0], height: request.pixelTarget[1] },
            });
            try {
              await page.setContent(request.document);
              const layout = await page.locator('[data-node-id="nested"]').evaluate((frame) => {
                const view = frame.ownerDocument.defaultView;
                if (!view) throw new TypeError("Browser document has no window.");
                const text = frame.querySelector('[data-node-id="text-second"]');
                const clipped = frame.querySelector('[data-node-id="clipped"]');
                if (!text || !clipped) throw new TypeError("Nested fixture is incomplete.");
                const frameRect = frame.getBoundingClientRect();
                const textRect = text.getBoundingClientRect();
                const clippedRect = clipped.getBoundingClientRect();
                const frameStyle = view.getComputedStyle(frame);
                const textStyle = view.getComputedStyle(text);
                return {
                  frameRect: [frameRect.x, frameRect.y, frameRect.width, frameRect.height],
                  textRect: [textRect.x, textRect.y, textRect.width, textRect.height],
                  clippedRect: [
                    clippedRect.x,
                    clippedRect.y,
                    clippedRect.width,
                    clippedRect.height,
                  ],
                  childOrder: [...(frame.firstElementChild?.children ?? [])].map((child) =>
                    child.getAttribute("data-node-id"),
                  ),
                  frameStyle: {
                    backgroundColor: frameStyle.backgroundColor,
                    borderTopWidth: frameStyle.borderTopWidth,
                    opacity: frameStyle.opacity,
                    overflow: frameStyle.overflow,
                  },
                  textStyle: {
                    color: textStyle.color,
                    fontFamily: textStyle.fontFamily,
                    fontSize: textStyle.fontSize,
                  },
                };
              });
              const clipHit = await page.locator('[data-node-id="clipped"]').evaluate((element) => {
                const document = element.ownerDocument;
                return (
                  document.elementFromPoint(135, 25)?.closest("[data-node-id]") === element &&
                  document.elementFromPoint(145, 25)?.closest("[data-node-id]") !== element
                );
              });
              observations.push({ ...layout, clipHit });
            } finally {
              await page.close();
            }
            return {
              rgba: new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(255),
              pixelSize: request.pixelTarget,
              colorSpace: "srgb" as const,
              alphaMode: "opaque" as const,
            };
          },
        },
        config,
      });
      const input = nestedInputFor(createWebRendererConfigHash(config), renderer);
      const expectedFontFamily = ["font-main", "font-fallback"]
        .map((assetId) => `unframe-font-${input.fontAssets[assetId]?.checksum.slice(7, 23)}`)
        .join(", ");
      const result = await renderer.build(input);
      expect(result).toMatchObject({ ok: true });
      expect(captureCount).toBe(2);
      expect(observations).toHaveLength(2);
      for (const observation of observations)
        expect(observation).toEqual({
          frameRect: [20, 10, 120, 60],
          textRect: [34, 16, 40, 16],
          clippedRect: [130, 20, 40, 20],
          childOrder: ["text-first", "text-second", "clipped"],
          frameStyle: {
            backgroundColor: "rgba(255, 0, 0, 0.5)",
            borderTopWidth: "4px",
            opacity: "0.75",
            overflow: "hidden",
          },
          textStyle: {
            color: "rgb(255, 255, 255)",
            fontFamily: expectedFontFamily,
            fontSize: "20px",
          },
          clipHit: true,
        });
    } finally {
      await browser.close();
    }
  });
});
