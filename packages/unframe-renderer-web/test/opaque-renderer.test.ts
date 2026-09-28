import { describe, expect, it } from "vitest";
import {
  createRendererFingerprint,
  executeRendererPlugin,
  type CompilerResolvedSurfaceInput,
} from "@unframe/unframe-renderer-api";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "../src/opaque/capture/types.js";
import {
  createOpaqueBakedWebRenderer,
  createWebRendererConfigHash,
  type OpaqueRenderProgram,
  type WebRendererConfig,
} from "../src/index.js";
import { inputFor } from "./fixtures/static-renderer.js";

const config = {} as const satisfies WebRendererConfig;

const semantics = {
  rootNodeIds: ["heading", "paragraph"],
  nodes: {
    heading: {
      id: "heading",
      role: "heading",
      level: 1,
      parentId: null,
      order: 0,
      text: "Opaque title",
    },
    paragraph: {
      id: "paragraph",
      role: "paragraph",
      parentId: null,
      order: 1,
      text: "Opaque body",
    },
  },
} as const;

const makeRenderer = (capture: (request: OpaqueCaptureRequest) => Promise<OpaqueCaptureResult>) => {
  const renderer = createOpaqueBakedWebRenderer({
    programs: [
      {
        entryId: "opaque-entry",
        moduleHash: "sha256:module",
        javascript: "opaque-bundle",
        assets: [{ path: "hero.png", mediaType: "image/png", dataBase64: "AQ==" }],
        stylesheets: ["theme.css"],
        props: { title: "Prop title", density: 2, featured: true },
      } satisfies OpaqueRenderProgram,
    ],
    runtimeFingerprint: "sha256:runtime",
    config,
    capture,
  });
  return renderer;
};

const inputForRenderer = (
  renderer: ReturnType<typeof makeRenderer>,
): CompilerResolvedSurfaceInput => {
  const rendererConfigHash = createWebRendererConfigHash(config);
  const source = inputFor(rendererConfigHash);
  const bindings = {
    "node:title": "heading",
    "node:body": "paragraph",
  };
  return {
    ...source,
    surface: {
      ...source.surface,
      content: { kind: "opaque", bindings },
      baseSemanticTree: semantics,
      initialStateId: "default",
      states: {
        default: {
          id: "default",
          contentOverrides: {},
          semanticOverrides: [],
          enabledInteractionIds: [],
        },
      },
    },
    semanticsByState: { default: semantics },
    fontAssets: {},
    plan: {
      ...source.plan,
      ownership: { kind: "opaque", bindingKeys: Object.keys(bindings) },
      states: { default: { kind: "capture" } },
    },
    entry: { kind: "opaque", entryId: "opaque-entry", moduleHash: "sha256:module" },
    context: {
      ...source.context,
      rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(renderer.identity, rendererConfigHash),
    },
  } as CompilerResolvedSurfaceInput;
};

const validCapture = (
  request: OpaqueCaptureRequest,
  rgba = [20, 30, 40, 255, 50, 60, 70, 255],
): OpaqueCaptureResult => ({
  ok: true,
  rgbaBase64: Buffer.from(rgba).toString("base64"),
  pixelSize: request.pixelTarget,
  bindings: Object.entries(request.expectedBindings).map(([key, text], index) => ({
    key,
    text,
    x: 4,
    y: 5 + index * 12,
    width: 80,
    height: 10,
  })),
  browserVersion: "test-browser",
});

describe("Opaque Baked Web RendererPlugin adapter", () => {
  it("transfers the locked program, semantic texts, state, and configured background through the plugin boundary", async () => {
    const requests: OpaqueCaptureRequest[] = [];
    const renderer = makeRenderer(async (request) => {
      requests.push(request);
      return validCapture(request);
    });

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests.map(({ stateId }) => stateId)).toEqual(["default"]);
    expect(requests[0]).toMatchObject({
      javascript: "opaque-bundle",
      assets: [{ path: "hero.png", mediaType: "image/png", dataBase64: "AQ==" }],
      stylesheets: ["theme.css"],
      props: { title: "Prop title", density: 2, featured: true },
      texts: { title: "Opaque title", body: "Opaque body" },
      expectedBindings: { "node:title": "Opaque title", "node:body": "Opaque body" },
      stateId: "default",
      logicalSize: [100, 50],
      pixelTarget: [2, 1],
      colorScheme: "dark",
      background: [0, 0, 0, 0],
    });
  });

  it("rejects capture bindings that do not match semantic text", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: [
        {
          key: "node:title",
          text: "Changed after capture",
          x: 4,
          y: 5,
          width: 80,
          height: 10,
        },
      ],
    }));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map(({ code }) => code)).toContain("opaque-capture-invalid");
  });

  it.each([
    ["non-canonical base64", "AQ=A"],
    ["the wrong RGBA byte length", Buffer.from([1, 2, 3, 255]).toString("base64")],
  ])("rejects capture data with %s", async (_description, rgbaBase64) => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      rgbaBase64,
    }));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map(({ code }) => code)).toContain("opaque-capture-invalid");
  });

  it("returns a failed capture as a renderer diagnostic", async () => {
    const renderer = makeRenderer(async () => ({ ok: false, code: "opaque-network-denied" }));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["opaque-network-denied"]);
  });

  it("rejects additional states before capture", async () => {
    const requests: OpaqueCaptureRequest[] = [];
    const renderer = makeRenderer(async (request) => {
      requests.push(request);
      return validCapture(request);
    });
    const input = inputForRenderer(renderer);
    const multiStateInput: CompilerResolvedSurfaceInput = {
      ...input,
      surface: {
        ...input.surface,
        states: {
          ...input.surface.states,
          alternate: {
            id: "alternate",
            contentOverrides: {},
            semanticOverrides: [],
            enabledInteractionIds: [],
          },
        },
      },
      semanticsByState: { ...input.semanticsByState, alternate: semantics },
      plan: {
        ...input.plan,
        states: { ...input.plan.states, alternate: { kind: "capture" } },
      },
    };

    const result = await executeRendererPlugin(renderer, multiStateInput);

    expect(result.valid).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("rejects finite-state intent before capture", async () => {
    const requests: OpaqueCaptureRequest[] = [];
    const renderer = makeRenderer(async (request) => {
      requests.push(request);
      return validCapture(request);
    });
    const input = inputForRenderer(renderer);
    const finiteStateInput: CompilerResolvedSurfaceInput = {
      ...input,
      surface: {
        ...input.surface,
        renderIntent: {
          ...input.surface.renderIntent,
          updateModel: { kind: "finite-state", stateIds: ["default"] },
        },
      },
      sourceIntent: {
        ...input.sourceIntent,
        updateModel: { kind: "finite-state", stateIds: ["default"] },
      },
      resolvedIntent: {
        ...input.resolvedIntent,
        updateModel: { kind: "finite-state", stateIds: ["default"] },
      },
    };

    const result = await executeRendererPlugin(renderer, finiteStateInput);

    expect(result.valid).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("reports opaque alpha only when every pixel is fully opaque", async () => {
    const renderer = makeRenderer(async (request) =>
      validCapture(request, [20, 30, 40, 255, 50, 60, 70, 254]),
    );

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.captures.map(({ alphaMode }) => alphaMode)).toEqual(["straight"]);
    expect([...result.value.captures[0]!.rgba]).toEqual([20, 30, 40, 255, 50, 60, 70, 254]);
  });

  it("marks fully opaque pixels with opaque alpha mode", async () => {
    const renderer = makeRenderer(async (request) => validCapture(request));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.captures.map(({ alphaMode }) => alphaMode)).toEqual(["opaque"]);
  });
});
