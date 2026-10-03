import { createHash } from "node:crypto";
import { PNG } from "pngjs";
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
  inputFor,
  nestedInputFor,
  withRendererFingerprint,
} from "./fixtures/static-renderer.js";

const frameOnlyInput = (source: CompilerResolvedSurfaceInput): CompilerResolvedSurfaceInput => {
  if (source.surface.content.kind !== "structured") throw new Error("Expected structured fixture.");
  const { root, nested, clipped } = source.surface.content.nodes;
  if (!root || root.kind !== "frame" || !nested || nested.kind !== "frame" || !clipped)
    throw new TypeError("Expected nested Frame fixture.");
  return {
    ...source,
    surface: {
      ...source.surface,
      content: {
        ...source.surface.content,
        nodes: { root, nested: { ...nested, children: ["clipped"] }, clipped },
      },
    },
    fontAssets: {},
  };
};

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
            backgroundColor: "rgba(0, 0, 0, 0)",
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

  it("部分partitionのcropでcontext paintを除き、owned Frameをclipとgroup opacityで描画する", async () => {
    const session = await openPlaywrightFixedBrowser();
    try {
      const renderer = createBakedWebRenderer({
        adapter: {
          identity: session.identity,
          environment: session.environment,
          capture: session.capture,
        },
        config,
      });
      const source = frameOnlyInput(nestedInputFor(createWebRendererConfigHash(config), renderer));
      const input: CompilerResolvedSurfaceInput = {
        ...source,
        plan: {
          ...source.plan,
          logicalBounds: { x: 60, y: 10, width: 10, height: 10 },
          clipWindow: { x: 60, y: 10, width: 10, height: 10 },
          ownership: {
            kind: "structured",
            ownedContentNodeIds: ["clipped"],
            contextNodeIds: ["root", "nested"],
          },
          states: { a: { kind: "capture" }, z: { kind: "empty" } },
        },
        context: { ...source.context, pixelTarget: [10, 10] },
      };

      const result = await renderer.build(input);

      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
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
          identity: session.identity,
          environment: session.environment,
          capture: session.capture,
        },
        config,
      });
      const source = frameOnlyInput(nestedInputFor(createWebRendererConfigHash(config), renderer));
      const full: CompilerResolvedSurfaceInput = {
        ...source,
        plan: {
          ...source.plan,
          ownership: {
            kind: "structured",
            ownedContentNodeIds: ["root", "nested", "clipped"],
            contextNodeIds: [],
          },
          states: { a: { kind: "capture" }, z: { kind: "empty" } },
        },
      };
      const background: CompilerResolvedSurfaceInput = {
        ...full,
        plan: {
          ...full.plan,
          ownership: { kind: "structured", ownedContentNodeIds: ["root"], contextNodeIds: [] },
        },
      };
      const foreground: CompilerResolvedSurfaceInput = {
        ...full,
        plan: {
          ...full.plan,
          logicalBounds: { x: 10, y: 5, width: 60, height: 30 },
          clipWindow: { x: 10, y: 5, width: 60, height: 30 },
          ownership: {
            kind: "structured",
            ownedContentNodeIds: ["nested", "clipped"],
            contextNodeIds: ["root"],
          },
        },
        context: { ...full.context, pixelTarget: [120, 60] },
      };
      const [whole, back, front] = await Promise.all([
        renderer.build(full),
        renderer.build(background),
        renderer.build(foreground),
      ]);
      if (!whole.ok || !back.ok || !front.ok)
        throw new Error(JSON.stringify([whole, back, front].filter((result) => !result.ok)));
      expect(whole.ok && back.ok && front.ok).toBe(true);
      const wholeRgba = whole.captures[0]?.rgba;
      const backRgba = back.captures[0]?.rgba;
      const frontRgba = front.captures[0]?.rgba;
      expect(wholeRgba).toBeDefined();
      expect(backRgba).toBeDefined();
      expect(frontRgba).toBeDefined();
      if (!wholeRgba || !backRgba || !frontRgba) return;
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

describe("Fixed Browser visual baseline", () => {
  it("二つのStateの配置・clip・透明余白を固定RGBA baselineと照合する", async () => {
    const session = await openPlaywrightFixedBrowser();
    try {
      const configHash = createWebRendererConfigHash(config);
      const renderer = createBakedWebRenderer({
        adapter: {
          identity: session.identity,
          environment: session.environment,
          capture: session.capture,
        },
        config,
      });
      const source = inputFor(configHash);
      if (source.surface.content.kind !== "structured")
        throw new Error("Structured fixture required");
      const root = source.surface.content.nodes.root;
      if (!root || root.kind !== "frame") throw new Error("Frame fixture required");
      const tile = {
        ...root,
        id: "tile",
        parentId: "root",
        children: [],
        placement: { kind: "absolute", x: 2, y: 1, width: 8, height: 4 },
        backgroundColor: { red: 0, green: 1, blue: 0, alpha: 1 },
      } as const;
      const input = withRendererFingerprint(
        {
          ...source,
          surface: {
            ...source.surface,
            logicalSize: [16, 8],
            content: {
              ...source.surface.content,
              nodes: {
                root: {
                  ...root,
                  children: ["tile"],
                  clip: true,
                  placement: { kind: "absolute", x: 0, y: 0, width: 8, height: 8 },
                  backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 },
                },
                tile,
              },
            },
            states: {
              a: source.surface.states.a!,
              z: {
                ...source.surface.states.z!,
                contentOverrides: {
                  tile: { kind: "frame", backgroundColor: { red: 0, green: 0, blue: 1, alpha: 1 } },
                },
              },
            },
          },
          fontAssets: {},
          plan: {
            ...source.plan,
            logicalBounds: { x: 0, y: 0, width: 16, height: 8 },
            clipWindow: { x: 0, y: 0, width: 16, height: 8 },
            ownership: {
              kind: "structured",
              ownedContentNodeIds: ["root", "tile"],
              contextNodeIds: [],
            },
          },
          context: { ...source.context, pixelTarget: [16, 8] },
        },
        renderer,
      );
      const result = await renderer.build(input);
      expect(result.diagnostics).toEqual([]);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.captures.map((capture) => capture.stateId)).toEqual(["a", "z"]);
      for (const capture of result.captures) {
        const baseline = new Uint8Array(16 * 8 * 4);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const inTile = x >= 2 && y >= 1 && y < 5;
            baseline.set(
              inTile
                ? capture.stateId === "a"
                  ? [0, 255, 0, 255]
                  : [0, 0, 255, 255]
                : [255, 0, 0, 255],
              (y * 16 + x) * 4,
            );
          }
        }
        expect(capture.rgba).toEqual(baseline);
      }
    } finally {
      await session.close();
    }
  });
});

describe("Generic Structured visual baseline", () => {
  it("Grid上のShapeとImageのState別描画を固定RGBA baselineと照合する", async () => {
    const session = await openPlaywrightFixedBrowser();
    try {
      const configHash = createWebRendererConfigHash(config);
      const renderer = createBakedWebRenderer({
        adapter: {
          identity: session.identity,
          environment: session.environment,
          capture: session.capture,
        },
        config,
      });
      const source = inputFor(configHash);
      if (source.surface.content.kind !== "structured")
        throw new Error("Structured fixture required");
      const root = source.surface.content.nodes.root;
      if (!root || root.kind !== "frame") throw new Error("Frame fixture required");
      const margin = { top: 0, right: 0, bottom: 0, left: 0 };
      const placement = {
        kind: "grid",
        row: 1,
        columnSpan: 1,
        rowSpan: 1,
        width: 8,
        height: 8,
        alignSelf: "stretch",
        justifySelf: "stretch",
        margin,
      } as const;
      const common = { parentId: "root", visible: true, opacity: 1 };
      const transparent = { red: 0, green: 0, blue: 0, alpha: 0 };
      const image = PNG.sync.write({
        width: 1,
        height: 1,
        data: Buffer.from([0, 255, 0, 255]),
      } as PNG);
      const input = withRendererFingerprint(
        {
          ...source,
          surface: {
            ...source.surface,
            logicalSize: [16, 8],
            content: {
              ...source.surface.content,
              nodes: {
                root: {
                  ...root,
                  placement: { kind: "absolute", x: 0, y: 0, width: 16, height: 8 },
                  children: ["shape", "picture"],
                  layout: {
                    kind: "grid",
                    columns: [
                      { kind: "fixed", size: 8 },
                      { kind: "fraction", fraction: 1 },
                    ],
                    rows: [{ kind: "fraction", fraction: 1 }],
                    columnGap: 0,
                    rowGap: 0,
                    padding: margin,
                  },
                },
                shape: {
                  ...common,
                  id: "shape",
                  kind: "shape",
                  order: 0,
                  placement: { ...placement, column: 1 },
                  geometry: { kind: "rectangle", width: 8, height: 8, radius: 0 },
                  style: {
                    fill: { red: 1, green: 0, blue: 0, alpha: 1 },
                    stroke: transparent,
                    strokeWidth: 0,
                  },
                },
                picture: {
                  ...common,
                  id: "picture",
                  kind: "image",
                  order: 1,
                  placement: { ...placement, column: 2 },
                  assetId: "green",
                  style: {
                    fit: "stretch",
                    tint: { red: 1, green: 1, blue: 1, alpha: 1 },
                    border: root.border,
                  },
                },
              },
            },
            states: {
              a: source.surface.states.a!,
              z: {
                ...source.surface.states.z!,
                contentOverrides: {
                  shape: {
                    kind: "shape",
                    style: {
                      fill: { red: 0, green: 0, blue: 1, alpha: 1 },
                      stroke: transparent,
                      strokeWidth: 0,
                    },
                  },
                },
              },
            },
          },
          fontAssets: {},
          imageAssets: {
            green: {
              mediaType: "image/png",
              checksum: `sha256:${createHash("sha256").update(image).digest("hex")}`,
              dataBase64: image.toString("base64"),
            },
          },
          plan: {
            ...source.plan,
            logicalBounds: { x: 0, y: 0, width: 16, height: 8 },
            clipWindow: { x: 0, y: 0, width: 16, height: 8 },
            ownership: {
              kind: "structured",
              ownedContentNodeIds: ["root", "shape", "picture"],
              contextNodeIds: [],
            },
          },
          context: { ...source.context, pixelTarget: [16, 8] },
        },
        renderer,
      );
      const result = await renderer.build(input);
      expect(result.diagnostics).toEqual([]);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.captures.map((capture) => capture.stateId)).toEqual(["a", "z"]);
      for (const capture of result.captures) {
        const baseline = new Uint8Array(16 * 8 * 4);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 16; x++) {
            baseline.set(
              x >= 8
                ? [0, 255, 0, 255]
                : capture.stateId === "a"
                  ? [255, 0, 0, 255]
                  : [0, 0, 255, 255],
              (y * 16 + x) * 4,
            );
          }
        expect(capture.rgba).toEqual(baseline);
      }
    } finally {
      await session.close();
    }
  });
});

it("固定 Browser で white Image の green tint を pixel に反映する", async () => {
  const session = await openPlaywrightFixedBrowser();
  try {
    const renderer = createBakedWebRenderer({
      adapter: {
        identity: session.identity,
        environment: session.environment,
        capture: session.capture,
      },
      config,
    });
    const source = inputFor(createWebRendererConfigHash(config));
    if (source.surface.content.kind !== "structured")
      throw new Error("Structured fixture required");
    const root = source.surface.content.nodes.root;
    if (!root || root.kind !== "frame") throw new Error("Frame fixture required");
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([255, 255, 255, 255]);
    const bytes = PNG.sync.write(png);
    const input = withRendererFingerprint(
      {
        ...source,
        surface: {
          ...source.surface,
          logicalSize: [1, 1],
          content: {
            ...source.surface.content,
            nodes: {
              root: {
                ...root,
                placement: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
                children: ["image"],
              },
              image: {
                id: "image",
                kind: "image",
                parentId: "root",
                order: 0,
                visible: true,
                opacity: 1,
                placement: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
                assetId: "white",
                style: {
                  fit: "stretch",
                  tint: { red: 0, green: 1, blue: 0, alpha: 1 },
                  border: root.border,
                },
              },
            },
          },
        },
        fontAssets: {},
        imageAssets: {
          white: {
            mediaType: "image/png",
            dataBase64: bytes.toString("base64"),
            checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          },
        },
        plan: {
          ...source.plan,
          logicalBounds: { x: 0, y: 0, width: 1, height: 1 },
          clipWindow: { x: 0, y: 0, width: 1, height: 1 },
          ownership: {
            kind: "structured",
            ownedContentNodeIds: ["root", "image"],
            contextNodeIds: [],
          },
        },
        context: { ...source.context, pixelTarget: [1, 1] },
      },
      renderer,
    );
    const result = await renderer.build(input);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect([...result.captures[0]!.rgba]).toEqual([0, 255, 0, 255]);
  } finally {
    await session.close();
  }
});
