import { describe, expect, it } from "vitest";
import { defineComponentStructure, isComponentStructure, model, Model } from "../src/index.js";

const structure = () => ({
  id: "model",
  componentId: "model-component",
  partBindings: {},
  variantStyles: {},
  timelines: [],
  root: { kind: "model", id: "model-root", asset: { kind: "asset-ref", assetId: "model-source" } },
});

describe("Model component roots", () => {
  it("validates a data-only Model root with a logical asset reference", () => {
    expect(isComponentStructure(structure())).toBe(true);
  });
  it("rejects layout and children on a Model root", () => {
    const input = structure();
    expect(() =>
      defineComponentStructure({ ...input, root: { ...input.root, children: [] } } as never),
    ).toThrow();
  });
});

it("supports factory and JSX Model roots with the same logical asset", () => {
  const root = model({ id: "model-root", asset: { kind: "asset-ref", assetId: "model-source" } });
  expect(defineComponentStructure({ ...structure(), root }).root).toEqual(root);
  const jsxRoot = Model({
    id: "model-root",
    asset: { kind: "asset-ref", assetId: "model-source" },
  });
  expect(defineComponentStructure({ ...structure(), root: jsxRoot }).root).toEqual(root);
});
