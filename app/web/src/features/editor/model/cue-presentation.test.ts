import { expect, it } from "vitest";
import { actionValueLabel, scalarLabel } from "./cue-presentation";

it.each([
  [7, "7"],
  ["7", '"7"'],
  [false, "false（偽）"],
  ["false（偽）", '"false（偽）"'],
  [null, "null（値なし）"],
  ["null（値なし）", '"null（値なし）"'],
  ["", '""'],
  ["空文字", '"空文字"'],
  ['say "hello"\nnext', '"say \\"hello\\"\\nnext"'],
] as const)("keeps scalar type and content visible for %j", (value, expected) => {
  expect(scalarLabel(value)).toBe(expected);
});

it("distinguishes literal reference-like text from variable and event references", () => {
  expect(actionValueLabel({ kind: "literal", value: "変数 score の値" })).toBe('"変数 score の値"');
  expect(actionValueLabel({ kind: "variable", variableId: "score" })).toBe("変数 score の値");
  expect(actionValueLabel({ kind: "literal", value: "イベント入力 score の値" })).toBe(
    '"イベント入力 score の値"',
  );
  expect(actionValueLabel({ kind: "eventPayload", field: "score" })).toBe(
    "イベント入力 score の値",
  );
});
