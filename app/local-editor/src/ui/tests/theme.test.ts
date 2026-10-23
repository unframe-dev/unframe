import { expect, it } from "vitest";
import { resolveTheme } from "../theme";
it.each([
  [null, true, "dark"],
  [null, false, "light"],
  ["invalid", true, "dark"],
  ["light", true, "light"],
  ["dark", false, "dark"],
] as const)("resolves saved %s with system dark %s", (saved, dark, expected) => {
  expect(resolveTheme(saved, dark)).toBe(expected);
});
