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
  nodes: {
    heading: {
      id: "heading",
      level: 1,
      order: 0,
      parentId: null,
      role: "heading",
      text: "Opaque title",
    },
    paragraph: {
      id: "paragraph",
      order: 1,
      parentId: null,
      role: "paragraph",
      text: "Opaque body",
    },
  },
  rootNodeIds: ["heading", "paragraph"],
} as const;

const makeRenderer = (
  capture: (request: OpaqueCaptureRequest) => Promise<OpaqueCaptureResult>,
  stateKeysById?: Readonly<Record<string, string>>,
) => {
  const renderer = createOpaqueBakedWebRenderer({
    capture,
    config,
    programs: [
      {
        assets: [{ dataBase64: "AQ==", mediaType: "image/png", path: "hero.png" }],
        entryId: "opaque-entry",
        javascript: "opaque-bundle",
        moduleHash: "sha256:module",
        props: { density: 2, featured: true, title: "Prop title" },
        stylesheets: ["theme.css"],
        ...(stateKeysById ? { stateKeysById } : {}),
      } satisfies OpaqueRenderProgram,
    ],
    runtimeFingerprint: "sha256:runtime",
  });
  return renderer;
};

const inputForRenderer = (
  renderer: ReturnType<typeof makeRenderer>,
): CompilerResolvedSurfaceInput => {
  const rendererConfigHash = createWebRendererConfigHash(config);
  const source = inputFor(rendererConfigHash);
  const bindings = {
    "node:body": "paragraph",
    "node:title": "heading",
  };
  return {
    ...source,
    context: {
      ...source.context,
      rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(renderer.identity, rendererConfigHash),
    },
    entry: { entryId: "opaque-entry", kind: "opaque", moduleHash: "sha256:module" },
    fontAssets: {},
    plan: {
      ...source.plan,
      ownership: { bindingKeys: Object.keys(bindings), kind: "opaque" },
      states: { default: { kind: "capture" } },
    },
    semanticsByState: { default: semantics },
    surface: {
      ...source.surface,
      baseSemanticTree: semantics,
      content: { bindings, kind: "opaque" },
      initialStateId: "default",
      states: {
        default: {
          contentOverrides: {},
          enabledInteractionIds: [],
          id: "default",
          semanticOverrides: [],
        },
      },
    },
  } as CompilerResolvedSurfaceInput;
};

const validCapture = (
  request: OpaqueCaptureRequest,
  rgba = [20, 30, 40, 255, 50, 60, 70, 255],
): OpaqueCaptureResult => ({
  bindings: Object.entries(request.expectedBindings).map(([key, text], index) => ({
    height: 10,
    key,
    text,
    width: 80,
    x: 4,
    y: 5 + index * 12,
  })),
  browserVersion: "test-browser",
  ok: true,
  pixelSize: request.pixelTarget,
  rgbaBase64: Buffer.from(rgba).toString("base64"),
});

describe("Opaque Baked Web RendererPlugin adapter", () => {
  it("transfers the locked program, semantic texts, state, and configured background through the plugin boundary", async () => {
    const requests: Array<OpaqueCaptureRequest> = [];
    const renderer = makeRenderer(async (request) => {
      requests.push(request);
      return validCapture(request);
    });

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests.map(({ stateId }) => stateId)).toEqual(["default"]);
    expect(requests[0]).toMatchObject({
      assets: [{ dataBase64: "AQ==", mediaType: "image/png", path: "hero.png" }],
      background: [0, 0, 0, 0],
      colorScheme: "dark",
      expectedBindings: { "node:body": "Opaque body", "node:title": "Opaque title" },
      javascript: "opaque-bundle",
      logicalSize: [100, 50],
      pixelTarget: [2, 1],
      props: { density: 2, featured: true, title: "Prop title" },
      stateId: "default",
      stylesheets: ["theme.css"],
      texts: { body: "Opaque body", title: "Opaque title" },
    });
  });

  it("rejects capture bindings that do not match semantic text", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: [
        {
          height: 10,
          key: "node:title",
          text: "Changed after capture",
          width: 80,
          x: 4,
          y: 5,
        },
      ],
    }));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
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
    if (result.valid) {
      return;
    }
    expect(result.diagnostics.map(({ code }) => code)).toContain("opaque-capture-invalid");
  });

  it("returns a failed capture as a renderer diagnostic", async () => {
    const renderer = makeRenderer(async () => ({ code: "opaque-network-denied", ok: false }));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["opaque-network-denied"]);
  });

  it("captures every State using its local key while retaining excluded text", async () => {
    const requests: Array<OpaqueCaptureRequest> = [];
    const renderer = makeRenderer(
      async (request) => {
        requests.push(request);
        return validCapture(request);
      },
      { alternate: "revealed", default: "initial" },
    );
    const input = inputForRenderer(renderer);
    const hiddenTree = {
      nodes: { heading: { ...semantics.nodes.heading, text: "Alternate title" } },
      rootNodeIds: ["heading"],
    };
    const multiStateInput: CompilerResolvedSurfaceInput = {
      ...input,
      plan: {
        ...input.plan,
        states: { ...input.plan.states, alternate: { kind: "capture" } },
      },
      semanticsByState: { ...input.semanticsByState, alternate: hiddenTree },
      surface: {
        ...input.surface,
        states: {
          ...input.surface.states,
          alternate: {
            contentOverrides: {},
            enabledInteractionIds: [],
            id: "alternate",
            semanticOverrides: [
              { nodes: { heading: { text: "Alternate title" }, paragraph: { included: false } } },
            ],
          },
        },
      },
    };

    const result = await executeRendererPlugin(renderer, multiStateInput);

    expect(result.valid).toBe(true);
    expect(requests.map(({ stateKey }) => stateKey)).toEqual(["revealed", "initial"]);
    expect(requests[0]).toMatchObject({
      bindingKeys: ["node:title", "node:body"],
      expectedBindings: { "node:title": "Alternate title" },
      texts: { body: "Opaque body", title: "Alternate title" },
    });
  });

  it("supports finite-state intent", async () => {
    const requests: Array<OpaqueCaptureRequest> = [];
    const renderer = makeRenderer(async (request) => {
      requests.push(request);
      return validCapture(request);
    });
    const input = inputForRenderer(renderer);
    const finiteStateInput: CompilerResolvedSurfaceInput = {
      ...input,
      resolvedIntent: {
        ...input.resolvedIntent,
        updateModel: { kind: "finite-state", stateIds: ["default"] },
      },
      sourceIntent: {
        ...input.sourceIntent,
        updateModel: { kind: "finite-state", stateIds: ["default"] },
      },
      surface: {
        ...input.surface,
        renderIntent: {
          ...input.surface.renderIntent,
          updateModel: { kind: "finite-state", stateIds: ["default"] },
        },
      },
    };

    const result = await executeRendererPlugin(renderer, finiteStateInput);

    expect(result.valid).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("emits normalized Hit Regions for enabled button bindings with interaction priority", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        height: 20,
        key,
        text,
        width: 50,
        x: 25,
        y: 10,
        ...(key === "node:button" ? { disabled: false } : {}),
      })),
    }));
    const input = inputForRenderer(renderer);
    const button = {
      id: "button",
      interactionId: "reveal",
      order: 2,
      parentId: null,
      role: "button" as const,
      text: "Reveal",
    };
    const completedButton = { ...button, stateEnabled: true };
    const tree = {
      nodes: { ...semantics.nodes, button: completedButton },
      rootNodeIds: [...semantics.rootNodeIds, "button"],
    };
    const withButton: CompilerResolvedSurfaceInput = {
      ...input,
      plan: {
        ...input.plan,
        ownership: { bindingKeys: ["node:title", "node:body", "node:button"], kind: "opaque" },
      },
      resolvedIntent: {
        ...input.resolvedIntent,
        interaction: { events: ["reveal"], kind: "regions" },
      },
      semanticsByState: { default: tree },
      sourceIntent: { ...input.sourceIntent, interaction: { events: ["reveal"], kind: "regions" } },
      surface: {
        ...input.surface,
        baseSemanticTree: { nodes: { ...semantics.nodes, button }, rootNodeIds: tree.rootNodeIds },
        content: {
          bindings: { "node:body": "paragraph", "node:button": "button", "node:title": "heading" },
          kind: "opaque",
        },
        interactions: { reveal: { event: "reveal", hitPriority: 3, id: "reveal", kind: "click" } },
        renderIntent: {
          ...input.surface.renderIntent,
          interaction: { events: ["reveal"], kind: "regions" },
        },
        states: {
          default: { ...input.surface.states.default!, enabledInteractionIds: ["reveal"] },
        },
      },
    };
    const result = await executeRendererPlugin(renderer, withButton);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.hitRegionsByState).toEqual({
      default: [
        {
          bounds: { height: 0.4, width: 0.5, x: 0.25, y: 0.2 },
          coordinateSpace: "normalized",
          interactionId: "reveal",
          priority: 3,
          semanticNodeId: "button",
        },
      ],
    });
    const disabledRenderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        height: 20,
        key,
        text,
        width: 50,
        x: 25,
        y: 10,
        ...(key === "node:button" ? { disabled: true } : {}),
      })),
    }));
    const disabled = await executeRendererPlugin(disabledRenderer, withButton);
    expect(disabled.valid).toBe(true);
    if (disabled.valid) {
      expect(disabled.value.hitRegionsByState).toEqual({ default: [] });
    }
    const outsideRenderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        height: 20,
        key,
        text,
        width: 50,
        x: 90,
        y: 10,
        ...(key === "node:button" ? { disabled: false } : {}),
      })),
    }));
    const outside = await executeRendererPlugin(outsideRenderer, withButton);
    expect(outside.valid).toBe(false);
    if (!outside.valid) {
      expect(outside.diagnostics.map(({ code }) => code)).toContain("invalid-hit-region");
    }
  });

  it("sorts equal-priority Hit Regions by Core's code-unit interaction and semantic IDs", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        height: 10,
        key,
        text,
        width: 20,
        x: 5,
        y: 5,
        ...(key === "node:z" || key === "node:A" || key === "node:Z" ? { disabled: false } : {}),
      })),
    }));
    const input = inputForRenderer(renderer);
    const buttons = {
      "button-A": {
        id: "button-A",
        interactionId: "a",
        order: 3,
        parentId: null,
        role: "button" as const,
        text: "A",
      },
      "button-z": {
        id: "button-z",
        interactionId: "a",
        order: 2,
        parentId: null,
        role: "button" as const,
        text: "z",
      },
      "button-Z": {
        id: "button-Z",
        interactionId: "Z",
        order: 4,
        parentId: null,
        role: "button" as const,
        text: "Z",
      },
    };
    const rootNodeIds = [...semantics.rootNodeIds, "button-z", "button-A", "button-Z"];
    const bindings = {
      "node:A": "button-A",
      "node:body": "paragraph",
      "node:title": "heading",
      "node:z": "button-z",
      "node:Z": "button-Z",
    };
    const interactions = {
      a: { event: "a", hitPriority: 1, id: "a", kind: "click" as const },
      Z: { event: "Z", hitPriority: 1, id: "Z", kind: "click" as const },
    };
    const withButtons: CompilerResolvedSurfaceInput = {
      ...input,
      plan: { ...input.plan, ownership: { bindingKeys: Object.keys(bindings), kind: "opaque" } },
      resolvedIntent: {
        ...input.resolvedIntent,
        interaction: { events: ["a", "Z"], kind: "regions" },
      },
      semanticsByState: {
        default: {
          nodes: {
            ...semantics.nodes,
            ...Object.fromEntries(
              Object.entries(buttons).map(([id, button]) => [
                id,
                { ...button, stateEnabled: true },
              ]),
            ),
          },
          rootNodeIds,
        },
      },
      sourceIntent: { ...input.sourceIntent, interaction: { events: ["a", "Z"], kind: "regions" } },
      surface: {
        ...input.surface,
        baseSemanticTree: { nodes: { ...semantics.nodes, ...buttons }, rootNodeIds },
        content: { bindings, kind: "opaque" },
        interactions,
        renderIntent: {
          ...input.surface.renderIntent,
          interaction: { events: ["a", "Z"], kind: "regions" },
        },
        states: {
          default: { ...input.surface.states.default!, enabledInteractionIds: ["a", "Z"] },
        },
      },
    };
    const result = await executeRendererPlugin(renderer, withButtons);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(
      result.value.hitRegionsByState?.default?.map(({ interactionId, semanticNodeId }) => [
        interactionId,
        semanticNodeId,
      ]),
    ).toEqual([
      ["Z", "button-Z"],
      ["a", "button-A"],
      ["a", "button-z"],
    ]);
  });

  it("reports opaque alpha only when every pixel is fully opaque", async () => {
    const renderer = makeRenderer(async (request) =>
      validCapture(request, [20, 30, 40, 255, 50, 60, 70, 254]),
    );

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.captures.map(({ alphaMode }) => alphaMode)).toEqual(["straight"]);
    expect([...result.value.captures[0]!.rgba]).toEqual([20, 30, 40, 255, 50, 60, 70, 254]);
  });

  it("marks fully opaque pixels with opaque alpha mode", async () => {
    const renderer = makeRenderer(async (request) => validCapture(request));

    const result = await executeRendererPlugin(renderer, inputForRenderer(renderer));

    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value.captures.map(({ alphaMode }) => alphaMode)).toEqual(["opaque"]);
  });
});
