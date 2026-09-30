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
      clipWindow: { x: 0, y: 0, width: 100, height: 50 },
      id: "render",
      layer: 0,
      logicalBounds: { x: 0, y: 0, width: 100, height: 50 },
      ownership: { kind: "structured", ownedContentNodeIds: ["text"], contextNodeIds: ["root"] },
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
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
      content: {
        kind: "structured",
        rootFrameId: "root",
        nodes: {
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
      },
      fit: "contain",
      hostNodeId: "host",
      id: "surface",
      initialStateId: "a",
      interactions: {},
      logicalSize: [100, 50],
      physicalSizeMeters: [1, 1],
      renderIntent: {
        updateModel: { kind: "static" },
        interaction: { kind: "none" },
        internalAnimation: { kind: "none" },
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      },
      states: {
        a: { id: "a", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
        z: { id: "z", contentOverrides: {}, semanticOverrides: [], enabledInteractionIds: [] },
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
              id: "clipped",
              parentId: "nested",
              order: 2,
              placement: { kind: "absolute", x: 55, y: 5, width: 20, height: 10 },
              children: [],
              backgroundColor: { red: 0, green: 0, blue: 1, alpha: 1 },
              border: { ...root.border },
            },
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
            root: { ...root, children: ["nested"] },
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
          },
        },
      },
    },
    renderer,
  );
};
