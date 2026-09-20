import { describe, expect, it } from "vitest";

import { validateStaticBuilderResult } from "../src/index.js";

describe("static builder result validation", () => {
  it("uses the same strict prop declaration schema as the runtime builder", () => {
    expect(validateStaticBuilderResult("stringProp", { kind: "string", default: "x" })).toBe(true);
    expect(
      validateStaticBuilderResult("stringProp", {
        kind: "string",
        default: "x",
        extra: "Injected",
      }),
    ).toBe(false);
  });

  it("uses the same non-negative timer constraint as after", () => {
    expect(validateStaticBuilderResult("after", { kind: "timer", afterMilliseconds: 0 })).toBe(
      true,
    );
    expect(validateStaticBuilderResult("after", { kind: "timer", afterMilliseconds: -1 })).toBe(
      false,
    );
  });

  it("rejects semantic interactions consistently with Surface and Structure builders", () => {
    const root = {
      kind: "surface",
      id: "surface",
      physicalSizeMeters: [1, 1],
      logicalSize: [100, 100],
      fit: "contain",
      root: {
        kind: "frame",
        id: "frame",
        layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 100 },
        children: [],
      },
      baseSemanticTree: {
        rootNodeIds: ["button"],
        nodes: {
          button: {
            id: "button",
            parentId: null,
            order: 0,
            role: "button",
            text: "Click",
            interactionId: "click",
          },
        },
      },
      interactions: {},
      initialStateId: "default",
      states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
      renderIntent: {
        updateModel: "static",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        fallbackPolicy: "reject",
      },
    };
    expect(validateStaticBuilderResult("surface", root)).toBe(false);
    expect(
      validateStaticBuilderResult("defineComponentStructure", {
        id: "structure",
        componentId: "card",
        root,
        partBindings: {},
        variantStyles: {},
        timelines: [],
      }),
    ).toBe(false);
  });

  it("rejects accessors without invoking them", () => {
    let reads = 0;
    const value = Object.defineProperty({ kind: "string" }, "default", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "x";
      },
    });

    expect(validateStaticBuilderResult("stringProp", value)).toBe(false);
    expect(reads).toBe(0);
  });
});
