import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  createRendererFingerprint,
  type CompilerResolvedSurfaceInput,
} from "@unframe/unframe-renderer-api";

import {
  createBakedWebRenderer,
  type BrowserCaptureRequest,
  type FixedBrowserAdapter,
  type WebRendererConfig,
} from "../../src/index.js";

export const config = {
  documentBackground: [0, 0, 0, 255],
} as const satisfies WebRendererConfig;

export const environment = {
  browser: { id: "test-browser", version: "1", fontFingerprint: "sha256:fonts" },
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  colorSpace: "srgb",
  deviceScaleFactor: 1,
  network: "deny",
  filesystem: "deny",
  clock: "fixed",
  random: "fixed",
} as const;
export const adapterIdentity = {
  id: "test-adapter",
  implementationHash: "sha256:adapter",
} as const;

export const testFontAsset = (characters: string) => {
  const codePoints = [...new Set(Array.from(characters, (value) => value.codePointAt(0)!))].sort(
    (left, right) => left - right,
  );
  const cmapLength = 12 + 16 + codePoints.length * 12;
  const bytes = new Uint8Array(28 + cmapLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x0001_0000);
  view.setUint16(4, 1);
  bytes.set(new TextEncoder().encode("cmap"), 12);
  view.setUint32(20, 28);
  view.setUint32(24, cmapLength);
  view.setUint16(30, 1);
  view.setUint16(32, 3);
  view.setUint16(34, 10);
  view.setUint32(36, 12);
  view.setUint16(40, 12);
  view.setUint32(44, 16 + codePoints.length * 12);
  view.setUint32(52, codePoints.length);
  codePoints.forEach((codePoint, index) => {
    const offset = 56 + index * 12;
    view.setUint32(offset, codePoint);
    view.setUint32(offset + 4, codePoint);
    view.setUint32(offset + 8, index + 1);
  });
  return {
    mediaType: "font/ttf" as const,
    dataBase64: Buffer.from(bytes).toString("base64"),
    checksum: `sha256:${bytesToHex(sha256(bytes))}`,
  };
};

export const fontMain = testFontAsset("<&>\"'");

export const inputFor = (rendererConfigHash: string): CompilerResolvedSurfaceInput => {
  const identity = {
    id: "baked-web",
    version: "1",
    contractVersion: "1",
    implementationHash: "unused",
  };
  return {
    surface: {
      id: "surface",
      hostNodeId: "host",
      physicalSizeMeters: [1, 1],
      logicalSize: [100, 50],
      fit: "contain",
      rootFrameId: "root",
      contentNodes: {
        root: {
          id: "root",
          kind: "frame",
          parentId: null,
          order: 0,
          visible: true,
          opacity: 1,
          placement: { kind: "absolute", x: 0, y: 0, width: 100, height: 50 },
          layout: { kind: "absolute" },
          children: ["text"],
          backgroundColor: { red: 0, green: 0, blue: 0, alpha: 1 },
          border: {
            color: { red: 0, green: 0, blue: 0, alpha: 0 },
            width: 0,
            radius: 0,
          },
          clip: false,
        },
        text: {
          id: "text",
          kind: "text",
          parentId: "root",
          order: 0,
          visible: true,
          opacity: 1,
          placement: { kind: "absolute", x: 10, y: 5, width: 40, height: 20 },
          value: { kind: "literal", value: "<&>\"'" },
          maxCodePoints: 100,
          style: {
            fontAssetId: "font-main",
            fallbackFontAssetIds: [],
            fontSize: 10,
            lineHeight: 12,
            color: { red: 1, green: 1, blue: 1, alpha: 1 },
            weight: "regular",
            align: "start",
            overflow: "clip",
          },
        },
      },
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      interactions: {},
      initialStateId: "a",
      states: {
        a: { id: "a", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
        z: { id: "z", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
      },
      renderIntent: {
        updateModel: { kind: "static" },
        interaction: { kind: "none" },
        internalAnimation: { kind: "none" },
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      },
    },
    sourceIntent: {
      updateModel: { kind: "static" },
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      rendererPreference: "baked-web",
      fallbackPolicy: "reject",
    },
    resolvedIntent: {
      updateModel: { kind: "static" },
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      selectedRendererId: "baked-web",
      fallbackPolicy: "reject",
    },
    semanticsByState: { a: { rootNodeIds: [], nodes: {} }, z: { rootNodeIds: [], nodes: {} } },
    fontAssets: {
      "font-main": fontMain,
    },
    plan: {
      id: "render",
      semanticSurfaceId: "surface",
      logicalBounds: { x: 0, y: 0, width: 100, height: 50 },
      layer: 0,
      contentNodeIds: ["root", "text"],
      states: { z: { kind: "capture" }, a: { kind: "capture" } },
    },
    entry: { kind: "structured" },
    context: {
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      colorScheme: "dark",
      themeId: "theme",
      themeHash: "sha256:theme",
      inputHash: "sha256:input",
      buildContextHash: "sha256:context",
      environmentHash: "sha256:environment",
      rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(identity, rendererConfigHash),
      pixelTarget: [2, 1],
    },
  } as CompilerResolvedSurfaceInput;
};

export const adapter = (requests: BrowserCaptureRequest[] = []): FixedBrowserAdapter => ({
  identity: adapterIdentity,
  environment,
  async capture(request) {
    requests.push(request);
    return {
      rgba: new Uint8Array([0, 1, 2, 255, 3, 4, 5, 255]),
      pixelSize: request.pixelTarget,
      colorSpace: "srgb",
      alphaMode: "opaque",
    };
  },
});

export const withRendererFingerprint = (
  input: CompilerResolvedSurfaceInput,
  renderer: ReturnType<typeof createBakedWebRenderer>,
): CompilerResolvedSurfaceInput => ({
  ...input,
  context: {
    ...input.context,
    rendererFingerprint: createRendererFingerprint(
      renderer.identity,
      input.context.rendererConfigHash,
    ),
  },
});

export const nestedInputFor = (
  rendererConfigHash: string,
  renderer: ReturnType<typeof createBakedWebRenderer>,
): CompilerResolvedSurfaceInput => {
  const source = inputFor(rendererConfigHash);
  const root = source.surface.contentNodes.root;
  const text = source.surface.contentNodes.text;
  if (!root || root.kind !== "frame" || !text || text.kind !== "text")
    throw new TypeError("Expected Frame/Text fixture.");
  return withRendererFingerprint(
    {
      ...source,
      surface: {
        ...source.surface,
        contentNodes: {
          root: { ...root, children: ["nested"] },
          nested: {
            ...root,
            id: "nested",
            parentId: "root",
            placement: { kind: "absolute", x: 10, y: 5, width: 60, height: 30 },
            children: ["text-first", "text-second", "clipped"],
            backgroundColor: { red: 1, green: 0, blue: 0, alpha: 0.5 },
            border: {
              color: { red: 0, green: 1, blue: 0, alpha: 1 },
              width: 2,
              radius: 3,
            },
            clip: true,
            opacity: 0.75,
          },
          "text-second": {
            ...text,
            id: "text-second",
            parentId: "nested",
            order: 1,
            placement: { kind: "absolute", x: 7, y: 3, width: 20, height: 8 },
            value: { kind: "literal", value: "&" },
            style: {
              ...text.style,
              fallbackFontAssetIds: ["font-fallback"],
            },
          },
          "text-first": {
            ...text,
            id: "text-first",
            parentId: "nested",
            order: 0,
            placement: { kind: "absolute", x: 2, y: 1, width: 20, height: 8 },
            value: { kind: "literal", value: "<" },
            style: {
              ...text.style,
              fallbackFontAssetIds: ["font-fallback"],
            },
          },
          clipped: {
            ...root,
            id: "clipped",
            parentId: "nested",
            order: 2,
            placement: { kind: "absolute", x: 55, y: 5, width: 20, height: 10 },
            children: [],
            backgroundColor: { red: 0, green: 0, blue: 1, alpha: 1 },
            border: { ...root.border },
          },
        },
      },
      fontAssets: {
        "font-main": testFontAsset("<"),
        "font-fallback": testFontAsset("&"),
      },
      plan: {
        ...source.plan,
        contentNodeIds: ["root", "nested", "text-second", "text-first", "clipped"],
      },
      context: { ...source.context, pixelTarget: [200, 100] },
    },
    renderer,
  );
};
