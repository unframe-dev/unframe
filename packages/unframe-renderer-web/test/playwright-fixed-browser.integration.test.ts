import { describe, expect, it } from "vitest";

import { openPlaywrightFixedBrowser } from "../src/index.js";

describe("Playwright Fixed Browser integration", () => {
  it("provision済みmanaged ChromiumでFrame/Text相当のdocumentをPNG captureする", async () => {
    const session = await openPlaywrightFixedBrowser();
    const secondSession = await openPlaywrightFixedBrowser();
    try {
      const request = {
        stateId: "default",
        document:
          '<!doctype html><html><body style="margin:0;background:rgb(255,0,0)"><script>const bytes=new Uint8Array(4);crypto.getRandomValues(bytes);const value=[Date.now(),Date(),performance.now(),performance.timeOrigin,Math.random(),crypto.randomUUID(),...bytes].join(":");let hash=0;for(const char of value)hash=(hash*31+char.charCodeAt(0))>>>0;document.body.style.background=`rgb(${hash&255},${(hash>>>8)&255},1)`</script></body></html>',
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
});
