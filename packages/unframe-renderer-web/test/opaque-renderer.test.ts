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

const makeRenderer = (
  capture: (request: OpaqueCaptureRequest) => Promise<OpaqueCaptureResult>,
  stateKeysById?: Readonly<Record<string, string>>,
) => {
  const renderer = createOpaqueBakedWebRenderer({
    programs: [
      {
        entryId: "opaque-entry",
        moduleHash: "sha256:module",
        javascript: "opaque-bundle",
        assets: [{ path: "hero.png", mediaType: "image/png", dataBase64: "AQ==" }],
        stylesheets: ["theme.css"],
        props: { title: "Prop title", density: 2, featured: true },
        ...(stateKeysById ? { stateKeysById } : {}),
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

  it("captures every State using its local key while retaining excluded text", async () => {
    const requests: OpaqueCaptureRequest[] = [];
    const renderer = makeRenderer(
      async (request) => {
        requests.push(request);
        return validCapture(request);
      },
      { default: "initial", alternate: "revealed" },
    );
    const input = inputForRenderer(renderer);
    const hiddenTree = {
      rootNodeIds: ["heading"],
      nodes: { heading: { ...semantics.nodes.heading, text: "Alternate title" } },
    };
    const multiStateInput: CompilerResolvedSurfaceInput = {
      ...input,
      surface: {
        ...input.surface,
        states: {
          ...input.surface.states,
          alternate: {
            id: "alternate",
            contentOverrides: {},
            semanticOverrides: [
              { nodes: { paragraph: { included: false }, heading: { text: "Alternate title" } } },
            ],
            enabledInteractionIds: [],
          },
        },
      },
      semanticsByState: { ...input.semanticsByState, alternate: hiddenTree },
      plan: {
        ...input.plan,
        states: { ...input.plan.states, alternate: { kind: "capture" } },
      },
    };

    const result = await executeRendererPlugin(renderer, multiStateInput);

    expect(result.valid).toBe(true);
    expect(requests.map(({ stateKey }) => stateKey)).toEqual(["revealed", "initial"]);
    expect(requests[0]).toMatchObject({
      texts: { title: "Alternate title", body: "Opaque body" },
      expectedBindings: { "node:title": "Alternate title" },
      bindingKeys: ["node:title", "node:body"],
    });
  });

  it("supports finite-state intent", async () => {
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

    expect(result.valid).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("emits normalized Hit Regions for enabled button bindings with interaction priority", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        key,
        text,
        x: 25,
        y: 10,
        width: 50,
        height: 20,
        ...(key === "node:button" ? { disabled: false } : {}),
      })),
    }));
    const input = inputForRenderer(renderer);
    const button = {
      id: "button",
      role: "button" as const,
      parentId: null,
      order: 2,
      text: "Reveal",
      interactionId: "reveal",
    };
    const completedButton = { ...button, stateEnabled: true };
    const tree = {
      rootNodeIds: [...semantics.rootNodeIds, "button"],
      nodes: { ...semantics.nodes, button: completedButton },
    };
    const withButton: CompilerResolvedSurfaceInput = {
      ...input,
      surface: {
        ...input.surface,
        content: {
          kind: "opaque",
          bindings: { "node:title": "heading", "node:body": "paragraph", "node:button": "button" },
        },
        baseSemanticTree: { rootNodeIds: tree.rootNodeIds, nodes: { ...semantics.nodes, button } },
        interactions: { reveal: { id: "reveal", kind: "click", event: "reveal", hitPriority: 3 } },
        states: {
          default: { ...input.surface.states.default!, enabledInteractionIds: ["reveal"] },
        },
        renderIntent: {
          ...input.surface.renderIntent,
          interaction: { kind: "regions", events: ["reveal"] },
        },
      },
      sourceIntent: { ...input.sourceIntent, interaction: { kind: "regions", events: ["reveal"] } },
      resolvedIntent: {
        ...input.resolvedIntent,
        interaction: { kind: "regions", events: ["reveal"] },
      },
      semanticsByState: { default: tree },
      plan: {
        ...input.plan,
        ownership: { kind: "opaque", bindingKeys: ["node:title", "node:body", "node:button"] },
      },
    };
    const result = await executeRendererPlugin(renderer, withButton);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.hitRegionsByState).toEqual({
      default: [
        {
          interactionId: "reveal",
          semanticNodeId: "button",
          priority: 3,
          coordinateSpace: "normalized",
          bounds: { x: 0.25, y: 0.2, width: 0.5, height: 0.4 },
        },
      ],
    });
    const disabledRenderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        key,
        text,
        x: 25,
        y: 10,
        width: 50,
        height: 20,
        ...(key === "node:button" ? { disabled: true } : {}),
      })),
    }));
    const disabled = await executeRendererPlugin(disabledRenderer, withButton);
    expect(disabled.valid).toBe(true);
    if (disabled.valid) expect(disabled.value.hitRegionsByState).toEqual({ default: [] });
    const outsideRenderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        key,
        text,
        x: 90,
        y: 10,
        width: 50,
        height: 20,
        ...(key === "node:button" ? { disabled: false } : {}),
      })),
    }));
    const outside = await executeRendererPlugin(outsideRenderer, withButton);
    expect(outside.valid).toBe(false);
    if (!outside.valid)
      expect(outside.diagnostics.map(({ code }) => code)).toContain("invalid-hit-region");
  });

  it("sorts equal-priority Hit Regions by Core's code-unit interaction and semantic IDs", async () => {
    const renderer = makeRenderer(async (request) => ({
      ...validCapture(request),
      bindings: Object.entries(request.expectedBindings).map(([key, text]) => ({
        key,
        text,
        x: 5,
        y: 5,
        width: 20,
        height: 10,
        ...(key === "node:z" || key === "node:A" || key === "node:Z" ? { disabled: false } : {}),
      })),
    }));
    const input = inputForRenderer(renderer);
    const buttons = {
      "button-z": {
        id: "button-z",
        role: "button" as const,
        parentId: null,
        order: 2,
        text: "z",
        interactionId: "a",
      },
      "button-A": {
        id: "button-A",
        role: "button" as const,
        parentId: null,
        order: 3,
        text: "A",
        interactionId: "a",
      },
      "button-Z": {
        id: "button-Z",
        role: "button" as const,
        parentId: null,
        order: 4,
        text: "Z",
        interactionId: "Z",
      },
    };
    const rootNodeIds = [...semantics.rootNodeIds, "button-z", "button-A", "button-Z"];
    const bindings = {
      "node:title": "heading",
      "node:body": "paragraph",
      "node:z": "button-z",
      "node:A": "button-A",
      "node:Z": "button-Z",
    };
    const interactions = {
      a: { id: "a", kind: "click" as const, event: "a", hitPriority: 1 },
      Z: { id: "Z", kind: "click" as const, event: "Z", hitPriority: 1 },
    };
    const withButtons: CompilerResolvedSurfaceInput = {
      ...input,
      surface: {
        ...input.surface,
        content: { kind: "opaque", bindings },
        baseSemanticTree: { rootNodeIds, nodes: { ...semantics.nodes, ...buttons } },
        interactions,
        states: {
          default: { ...input.surface.states.default!, enabledInteractionIds: ["a", "Z"] },
        },
        renderIntent: {
          ...input.surface.renderIntent,
          interaction: { kind: "regions", events: ["a", "Z"] },
        },
      },
      sourceIntent: { ...input.sourceIntent, interaction: { kind: "regions", events: ["a", "Z"] } },
      resolvedIntent: {
        ...input.resolvedIntent,
        interaction: { kind: "regions", events: ["a", "Z"] },
      },
      semanticsByState: {
        default: {
          rootNodeIds,
          nodes: {
            ...semantics.nodes,
            ...Object.fromEntries(
              Object.entries(buttons).map(([id, button]) => [
                id,
                { ...button, stateEnabled: true },
              ]),
            ),
          },
        },
      },
      plan: { ...input.plan, ownership: { kind: "opaque", bindingKeys: Object.keys(bindings) } },
    };
    const result = await executeRendererPlugin(renderer, withButtons);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
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
