import { expect, it } from "vite-plus/test";
import { defineTheme } from "@unframe-dev/authoring";
import { standardComponents, standardTheme } from "@unframe-dev/authoring/components";

it("exports the standard catalog alongside the authoring DSL", () => {
  expect(typeof defineTheme).toBe("function");
  expect(standardComponents.theme).toBe(standardTheme);
});
