import { describe, expect, it } from "vitest";
import { frame, image, shape, validateStaticBuilderResult } from "../src/index.js";

const clear = { red: 0, green: 0, blue: 0, alpha: 0 };
const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const border = { color: clear, width: 0, radius: 0 };

describe("generic Structured declarations", () => {
  it("validates nested Stack, Grid, Shape, and Image through builders and static guard", () => {
    const icon = image({
      id: "icon",
      asset: { kind: "asset-ref", assetId: "logo" },
      layout: {
        kind: "grid",
        column: 1,
        row: 1,
        columnSpan: 1,
        rowSpan: 1,
        width: 10,
        height: 10,
        alignSelf: "center",
        justifySelf: "center",
        margin: insets,
      },
      style: { fit: "contain", tint: { ...clear, red: 1, green: 1, blue: 1, alpha: 1 }, border },
    });
    const cell = frame({
      id: "cell",
      layout: {
        kind: "stack",
        grow: 1,
        width: 20,
        height: 20,
        alignSelf: "stretch",
        margin: insets,
      },
      flow: {
        kind: "grid",
        columns: [{ kind: "fraction", fraction: 1 }],
        rows: [{ kind: "fixed", size: 20 }],
        columnGap: 0,
        rowGap: 0,
        padding: insets,
      },
      children: [icon],
    });
    const mark = shape({
      id: "mark",
      geometry: { kind: "ellipse", width: 8, height: 8 },
      layout: { kind: "stack", grow: 0, width: 8, height: 8, alignSelf: "auto", margin: insets },
      style: { fill: clear, stroke: clear, strokeWidth: 1 },
    });
    const root = frame({
      id: "root",
      layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 100 },
      flow: {
        kind: "stack",
        direction: "horizontal",
        gap: 2,
        padding: insets,
        alignItems: "center",
        justifyContent: "start",
      },
      children: [cell, mark],
    });

    expect(validateStaticBuilderResult("frame", root)).toBe(true);
    expect(
      validateStaticBuilderResult("image", { ...icon, asset: { kind: "asset-ref", assetId: "" } }),
    ).toBe(false);
    expect(
      validateStaticBuilderResult("shape", {
        ...mark,
        geometry: { kind: "ellipse", width: -1, height: 8 },
      }),
    ).toBe(false);
    expect(validateStaticBuilderResult("frame", { ...root, flow: { ...root.flow, gap: -1 } })).toBe(
      false,
    );
  });
});
