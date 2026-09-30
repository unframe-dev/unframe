import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
  openPlaywrightFixedBrowser,
} from "../src/index.js";
import type { CompilerResolvedSurfaceInput } from "@unframe/unframe-renderer-api";
import {
  adapterIdentity,
  config,
  environment,
  nestedInputFor,
} from "./fixtures/static-renderer.js";

const frameOnlyInput = (source: CompilerResolvedSurfaceInput): CompilerResolvedSurfaceInput => {
  if (source.surface.content.kind !== "structured") {
    throw new Error("Expected structured fixture.");
  }
  const { clipped, nested, root } = source.surface.content.nodes;
  if (!root || root.kind !== "frame" || !nested || nested.kind !== "frame" || !clipped) {
    throw new TypeError("Expected nested Frame fixture.");
  }
  return {
    ...source,
    fontAssets: {},
    surface: {
      ...source.surface,
      content: {
        ...source.surface.content,
        nodes: { clipped, nested: { ...nested, children: ["clipped"] }, root },
      },
    },
  };
};

describe("Playwright Fixed Browser integration", () => {
  it("provision済みmanaged ChromiumでFrame/Text相当のdocumentをPNG captureする", async () => {
    const session = await openPlaywrightFixedBrowser();
    const secondSession = await openPlaywrightFixedBrowser();
    try {
      const request = {
        capabilities: {
          clock: "fixed",
          colorSpace: "srgb",
          deviceScaleFactor: 1,
          filesystem: "deny",
          network: "deny",
          random: "fixed",
        },
        colorScheme: "light",
        document:
          '<!doctype html><html><body style="margin:0;background:rgb(255,0,0)"><script>const bytes=new Uint8Array(4);crypto.getRandomValues(bytes);const value=[Date.now(),Date(),performance.now(),performance.timeOrigin,Math.random(),crypto.randomUUID(),...bytes].join(":");let hash=0;for(const char of value)hash=(hash*31+char.charCodeAt(0))>>>0;document.body.style.background=`rgb(${hash&255},${(hash>>>8)&255},1)`</script></body></html>',
        environment: session.environment,
        fontFaceCount: 0,
        pixelTarget: [2, 1],
        stateId: "default",
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
    const observations: Array<unknown> = [];
    try {
      const renderer = createBakedWebRenderer({
        adapter: {
          async capture(request) {
            captureCount++;
            const page = await browser.newPage({
              viewport: { height: request.pixelTarget[1], width: request.pixelTarget[0] },
            });
            try {
              await page.setContent(request.document);
              const layout = await page.locator('[data-node-id="nested"]').evaluate((frame) => {
                const view = frame.ownerDocument.defaultView;
                if (!view) {
                  throw new TypeError("Browser document has no window.");
                }
                const text = frame.querySelector('[data-node-id="text-second"]');
                const clipped = frame.querySelector('[data-node-id="clipped"]');
                if (!text || !clipped) {
                  throw new TypeError("Nested fixture is incomplete.");
                }
                const frameRect = frame.getBoundingClientRect();
                const textRect = text.getBoundingClientRect();
                const clippedRect = clipped.getBoundingClientRect();
                const frameStyle = view.getComputedStyle(frame);
                const textStyle = view.getComputedStyle(text);
                return {
                  childOrder: [...(frame.firstElementChild?.children ?? [])].map((child) =>
                    child.getAttribute("data-node-id"),
                  ),
                  clippedRect: [
                    clippedRect.x,
                    clippedRect.y,
                    clippedRect.width,
                    clippedRect.height,
                  ],
                  frameRect: [frameRect.x, frameRect.y, frameRect.width, frameRect.height],
                  frameStyle: {
                    backgroundColor: frameStyle.backgroundColor,
                    borderTopWidth: frameStyle.borderTopWidth,
                    opacity: frameStyle.opacity,
                    overflow: frameStyle.overflow,
                  },
                  textRect: [textRect.x, textRect.y, textRect.width, textRect.height],
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
              alphaMode: "opaque" as const,
              colorSpace: "srgb" as const,
              pixelSize: request.pixelTarget,
              rgba: new Uint8Array(request.pixelTarget[0] * request.pixelTarget[1] * 4).fill(255),
            };
          },
          environment,
          identity: adapterIdentity,
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
      for (const observation of observations) {
        expect(observation).toEqual({
          childOrder: ["text-first", "text-second", "clipped"],
          clipHit: true,
          clippedRect: [130, 20, 40, 20],
          frameRect: [20, 10, 120, 60],
          frameStyle: {
            backgroundColor: "rgba(0, 0, 0, 0)",
            borderTopWidth: "4px",
            opacity: "0.75",
            overflow: "hidden",
          },
          textRect: [34, 16, 40, 16],
          textStyle: {
            color: "rgb(255, 255, 255)",
            fontFamily: expectedFontFamily,
            fontSize: "20px",
          },
        });
      }
    } finally {
      await browser.close();
    }
  });

  it("部分partitionのcropでcontext paintを除き、owned Frameをclipとgroup opacityで描画する", async () => {
    const session = await openPlaywrightFixedBrowser();
    try {
      const renderer = createBakedWebRenderer({
        adapter: {
          capture: session.capture,
          environment: session.environment,
          identity: session.identity,
        },
        config,
      });
      const source = frameOnlyInput(nestedInputFor(createWebRendererConfigHash(config), renderer));
      const input: CompilerResolvedSurfaceInput = {
        ...source,
        context: { ...source.context, pixelTarget: [10, 10] },
        plan: {
          ...source.plan,
          clipWindow: { x: 60, y: 10, width: 10, height: 10 },
          logicalBounds: { x: 60, y: 10, width: 10, height: 10 },
          ownership: {
            contextNodeIds: ["root", "nested"],
            kind: "structured",
            ownedContentNodeIds: ["clipped"],
          },
          states: { a: { kind: "capture" }, z: { kind: "empty" } },
        },
      };

      const result = await renderer.build(input);

      if (!result.ok) {
        throw new Error(JSON.stringify(result.diagnostics));
      }
      expect(result.ok).toBe(true);
      expect(result.captures).toHaveLength(1);
      expect(result.captures[0]?.pixelSize).toEqual([10, 10]);
      const rgba = result.captures[0]?.rgba;
      expect(rgba?.[4 * (5 * 10 + 1) + 3]).toBe(0);
      expect(rgba?.[4 * (5 * 10 + 6) + 2]).toBe(255);
      expect(rgba?.[4 * (5 * 10 + 6) + 3]).toBeGreaterThan(0);
      expect(rgba?.[4 * (5 * 10 + 6) + 3]).toBeLessThan(255);
    } finally {
      await session.close();
    }
  });

  it("背景と重なるclip/group-opacity Frameのpartition合成画素が全体captureに一致する", async () => {
    const session = await openPlaywrightFixedBrowser();
    try {
      const renderer = createBakedWebRenderer({
        adapter: {
          capture: session.capture,
          environment: session.environment,
          identity: session.identity,
        },
        config,
      });
      const source = frameOnlyInput(nestedInputFor(createWebRendererConfigHash(config), renderer));
      const full: CompilerResolvedSurfaceInput = {
        ...source,
        plan: {
          ...source.plan,
          ownership: {
            contextNodeIds: [],
            kind: "structured",
            ownedContentNodeIds: ["root", "nested", "clipped"],
          },
          states: { a: { kind: "capture" }, z: { kind: "empty" } },
        },
      };
      const background: CompilerResolvedSurfaceInput = {
        ...full,
        plan: {
          ...full.plan,
          ownership: { contextNodeIds: [], kind: "structured", ownedContentNodeIds: ["root"] },
        },
      };
      const foreground: CompilerResolvedSurfaceInput = {
        ...full,
        context: { ...full.context, pixelTarget: [120, 60] },
        plan: {
          ...full.plan,
          clipWindow: { x: 10, y: 5, width: 60, height: 30 },
          logicalBounds: { x: 10, y: 5, width: 60, height: 30 },
          ownership: {
            contextNodeIds: ["root"],
            kind: "structured",
            ownedContentNodeIds: ["nested", "clipped"],
          },
        },
      };
      const [whole, back, front] = await Promise.all([
        renderer.build(full),
        renderer.build(background),
        renderer.build(foreground),
      ]);
      if (!whole.ok || !back.ok || !front.ok) {
        throw new Error(JSON.stringify([whole, back, front].filter((result) => !result.ok)));
      }
      expect(whole.ok && back.ok && front.ok).toBe(true);
      const wholeRgba = whole.captures[0]?.rgba;
      const backRgba = back.captures[0]?.rgba;
      const frontRgba = front.captures[0]?.rgba;
      expect(wholeRgba).toBeDefined();
      expect(backRgba).toBeDefined();
      expect(frontRgba).toBeDefined();
      if (!wholeRgba || !backRgba || !frontRgba) {
        return;
      }
      let largestDifference = 0;
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 200; x++) {
          const index = 4 * (y * 200 + x);
          const overX = x - 20;
          const overY = y - 10;
          const frontIndex = 4 * (overY * 120 + overX);
          const alpha =
            overX >= 0 && overX < 120 && overY >= 0 && overY < 60
              ? (frontRgba[frontIndex + 3] ?? 0) / 255
              : 0;
          for (let channel = 0; channel < 3; channel++) {
            const expected = Math.round(
              (frontRgba[frontIndex + channel] ?? 0) * alpha +
                (backRgba[index + channel] ?? 0) * (1 - alpha),
            );
            largestDifference = Math.max(
              largestDifference,
              Math.abs((wholeRgba[index + channel] ?? 0) - expected),
            );
          }
          largestDifference = Math.max(
            largestDifference,
            Math.abs((wholeRgba[index + 3] ?? 0) - 255),
          );
        }
      }
      expect(largestDifference).toBeLessThanOrEqual(2);
    } finally {
      await session.close();
    }
  });
});
