import { expect, it } from "vitest";
import { safePlainClone } from "../src/validation/safe-plain-clone.js";

it("preserves well-formed surrogate pairs in JSON keys and values", () => {
  const input = { "😀": "𐀀" };
  expect(safePlainClone(input)).toEqual({ valid: true, value: input, diagnostics: [] });
});
