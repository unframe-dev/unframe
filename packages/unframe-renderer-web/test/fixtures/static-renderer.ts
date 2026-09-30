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

const structuredContent = (surface: CompilerResolvedSurfaceInput["surface"]) => {
  if (surface.content.kind !== "structured") {
    throw new TypeError("Expected structured fixture.");
  }
  return surface.content;
};

export const config = {} as const satisfies WebRendererConfig;

export const environment = {
  browser: { fontFingerprint: "sha256:fonts", id: "test-browser", version: "1" },
  clock: "fixed",
  colorSpace: "srgb",
  deviceScaleFactor: 1,
  filesystem: "deny",
  locale: "ja-JP",
  network: "deny",
  random: "fixed",
  timezone: "Asia/Tokyo",
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
  view.setUint32(0, 0x00_01_00_00);
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
    checksum: `sha256:${bytesToHex(sha256(bytes))}`,
    dataBase64: Buffer.from(bytes).toString("base64"),
    mediaType: "font/ttf" as const,
  };
};

export const fontMain = testFontAsset("<&>\"'");

export const inputFor = (rendererConfigHash: string): CompilerResolvedSurfaceInput => {
  const identity = {
    contractVersion: "1",
    id: "baked-web",
    implementationHash: "unused",
    version: "1",
  };
  return {
    context: {
      buildContextHash: "sha256:context",
      colorScheme: "dark",
      environmentHash: "sha256:environment",
      inputHash: "sha256:input",
      locale: "ja-JP",
      pixelTarget: [2, 1],
      rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(identity, rendererConfigHash),
      themeHash: "sha256:theme",
      themeId: "theme",
      timezone: "Asia/Tokyo",
    },
    entry: { kind: "structured" },
    fontAssets: {
      "font-main": fontMain,
    },
    plan: {
      clipWindow: { height: 50, width: 100, x: 0, y: 0 },
      id: "render",
      layer: 0,
      logicalBounds: { height: 50, width: 100, x: 0, y: 0 },
      ownership: { contextNodeIds: ["root"], kind: "structured", ownedContentNodeIds: ["text"] },
      semanticSurfaceId: "surface",
      states: { a: { kind: "capture" }, z: { kind: "capture" } },
    },
    resolvedIntent: {
      fallbackPolicy: "reject",
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      selectedRendererId: "baked-web",
      updateModel: { kind: "static" },
    },
    semanticsByState: { a: { nodes: {}, rootNodeIds: [] }, z: { nodes: {}, rootNodeIds: [] } },
    sourceIntent: {
      fallbackPolicy: "reject",
      interaction: { kind: "none" },
      internalAnimation: { kind: "none" },
      rendererPreference: "baked-web",
      updateModel: { kind: "static" },
    },
    surface: {
      baseSemanticTree: { nodes: {}, rootNodeIds: [] },
      content: {
        kind: "structured",
        nodes: {
          root: {
            backgroundColor: { alpha: 1, blue: 0, green: 0, red: 0 },
            border: {
              color: { alpha: 0, blue: 0, green: 0, red: 0 },
              radius: 0,
              width: 0,
            },
            children: ["text"],
            clip: false,
            id: "root",
            kind: "frame",
            layout: { kind: "absolute" },
            opacity: 1,
            order: 0,
            parentId: null,
            placement: { height: 50, kind: "absolute", width: 100, x: 0, y: 0 },
            visible: true,
          },
          text: {
            id: "text",
            kind: "text",
            maxCodePoints: 100,
            opacity: 1,
            order: 0,
            parentId: "root",
            placement: { height: 20, kind: "absolute", width: 40, x: 10, y: 5 },
            style: {
              align: "start",
              color: { alpha: 1, blue: 1, green: 1, red: 1 },
              fallbackFontAssetIds: [],
              fontAssetId: "font-main",
              fontSize: 10,
              lineHeight: 12,
              overflow: "clip",
              weight: "regular",
            },
            value: { kind: "literal", value: "<&>\"'" },
            visible: true,
          },
        },
        rootFrameId: "root",
      },
      fit: "contain",
      hostNodeId: "host",
      id: "surface",
      initialStateId: "a",
      interactions: {},
      logicalSize: [100, 50],
      physicalSizeMeters: [1, 1],
      renderIntent: {
        fallbackPolicy: "reject",
        interaction: { kind: "none" },
        internalAnimation: { kind: "none" },
        rendererPreference: "baked-web",
        updateModel: { kind: "static" },
      },
      states: {
        a: { contentOverrides: {}, enabledInteractionIds: [], id: "a", semanticOverrides: [] },
        z: { contentOverrides: {}, enabledInteractionIds: [], id: "z", semanticOverrides: [] },
      },
    },
  } as CompilerResolvedSurfaceInput;
};

export const adapter = (requests: Array<BrowserCaptureRequest> = []): FixedBrowserAdapter => ({
  async capture(request) {
    requests.push(request);
    return {
      alphaMode: "opaque",
      colorSpace: "srgb",
      pixelSize: request.pixelTarget,
      rgba: new Uint8Array([0, 1, 2, 255, 3, 4, 5, 255]),
    };
  },
  environment,
  identity: adapterIdentity,
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
  const root = structuredContent(source.surface).nodes.root;
  const text = structuredContent(source.surface).nodes.text;
  if (!root || root.kind !== "frame" || !text || text.kind !== "text") {
    throw new TypeError("Expected Frame/Text fixture.");
  }
  return withRendererFingerprint(
    {
      ...source,
      context: { ...source.context, pixelTarget: [200, 100] },
      fontAssets: {
        "font-fallback": testFontAsset("&"),
        "font-main": testFontAsset("<"),
      },
      plan: {
        ...source.plan,
        ownership: {
          contextNodeIds: ["root", "nested"],
          kind: "structured",
          ownedContentNodeIds: ["text-second", "text-first", "clipped"],
        },
      },
      surface: {
        ...source.surface,
        content: {
          ...structuredContent(source.surface),
          nodes: {
            clipped: {
              ...root,
              backgroundColor: { alpha: 1, blue: 1, green: 0, red: 0 },
              border: { ...root.border },
              children: [],
              id: "clipped",
              order: 2,
              parentId: "nested",
              placement: { height: 10, kind: "absolute", width: 20, x: 55, y: 5 },
            },
            nested: {
              ...root,
              backgroundColor: { alpha: 0.5, blue: 0, green: 0, red: 1 },
              border: {
                color: { alpha: 1, blue: 0, green: 1, red: 0 },
                radius: 3,
                width: 2,
              },
              children: ["text-first", "text-second", "clipped"],
              clip: true,
              id: "nested",
              opacity: 0.75,
              parentId: "root",
              placement: { height: 30, kind: "absolute", width: 60, x: 10, y: 5 },
            },
            root: { ...root, children: ["nested"] },
            "text-first": {
              ...text,
              id: "text-first",
              order: 0,
              parentId: "nested",
              placement: { height: 8, kind: "absolute", width: 20, x: 2, y: 1 },
              style: {
                ...text.style,
                fallbackFontAssetIds: ["font-fallback"],
              },
              value: { kind: "literal", value: "<" },
            },
            "text-second": {
              ...text,
              id: "text-second",
              order: 1,
              parentId: "nested",
              placement: { height: 8, kind: "absolute", width: 20, x: 7, y: 3 },
              style: {
                ...text.style,
                fallbackFontAssetIds: ["font-fallback"],
              },
              value: { kind: "literal", value: "&" },
            },
          },
        },
      },
    },
    renderer,
  );
};
