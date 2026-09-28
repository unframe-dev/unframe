import { expect, it } from "vitest";
import { validateOpaqueBindings } from "../src/opaque/capture/bindings.js";

const expected = { "node:title": "Hello" };
const title = { key: "node:title", text: "Hello", x: 0, y: 0, width: 100, height: 30 };
it("accepts an exact declared text binding with finite visible geometry", () => {
  expect(validateOpaqueBindings(expected, [title])).toEqual({ ok: true, bindings: [title] });
});
it.each(
  [
    [],
    [title, title],
    [{ ...title, key: "node:other" }],
    [{ ...title, text: "Different" }],
    [{ ...title, width: Number.NaN }],
    [{ ...title, height: 0 }],
  ].map((observed) => ({ observed })),
)("rejects missing, duplicate, undeclared, changed or invisible bindings: %j", ({ observed }) => {
  expect(validateOpaqueBindings(expected, observed).ok).toBe(false);
});
