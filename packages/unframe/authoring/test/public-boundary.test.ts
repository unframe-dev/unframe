import { expect, it } from "vitest";
import { defineTheme } from "@unframe/authoring";
import { standardComponents, standardTheme } from "@unframe/authoring/components";

it("exports the standard catalog alongside the authoring DSL", () => {
  expect(typeof defineTheme).toBe("function");
  expect(standardComponents.theme).toBe(standardTheme);
});
