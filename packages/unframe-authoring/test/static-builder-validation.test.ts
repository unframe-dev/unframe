import { describe, expect, it } from "vitest";

import { validateStaticBuilderResult } from "../src/index.js";

describe("static builder result validation", () => {
  it("uses the same strict prop declaration schema as the runtime builder", () => {
    expect(validateStaticBuilderResult("stringProp", { default: "x", kind: "string" })).toBe(true);
    expect(
      validateStaticBuilderResult("stringProp", {
        default: "x",
        extra: "Injected",
        kind: "string",
      }),
    ).toBe(false);
  });

  it("uses the same non-negative timer constraint as after", () => {
    expect(validateStaticBuilderResult("after", { afterMilliseconds: 0, kind: "timer" })).toBe(
      true,
    );
    expect(validateStaticBuilderResult("after", { afterMilliseconds: -1, kind: "timer" })).toBe(
      false,
    );
  });

  it("accepts semantic interactions at the declaration shape boundary", () => {
    const root = {
      baseSemanticTree: {
        nodes: {
          button: {
            id: "button",
            interactionId: "click",
            order: 0,
            parentId: null,
            role: "button",
            text: "Click",
          },
        },
        rootNodeIds: ["button"],
      },
      fit: "contain",
      id: "surface",
      initialStateId: "default",
      interactions: {},
      kind: "surface",
      logicalSize: [100, 100],
      physicalSizeMeters: [1, 1],
      renderIntent: {
        fallbackPolicy: "reject",
        interaction: "none",
        internalAnimation: "none",
        rendererPreference: "baked-web",
        updateModel: "static",
      },
      root: {
        children: [],
        id: "frame",
        kind: "frame",
        layout: { height: 100, kind: "absolute", width: 100, x: 0, y: 0 },
      },
      states: { default: { enabledInteractionIds: [], id: "default", semanticOverrides: [] } },
    };
    expect(validateStaticBuilderResult("surface", root)).toBe(true);
    expect(
      validateStaticBuilderResult("defineComponentStructure", {
        componentId: "card",
        id: "structure",
        partBindings: {},
        root,
        timelines: [],
        variantStyles: {},
      }),
    ).toBe(true);
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
