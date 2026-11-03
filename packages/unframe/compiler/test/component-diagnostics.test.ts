import { expect, it } from "vite-plus/test";
import { resolvePresentation } from "../src/index.js";
import { modelProject } from "./fixtures/model.js";

it("identifies the instance, component and version when its manifest is absent", () => {
  const input = modelProject();
  input.components = [];
  const result = resolvePresentation(input);
  expect(result.diagnostics).toContainEqual({
    code: "compiler-component-not-found",
    path: ["presentation", "scene", "components", 0],
    message:
      "Component instance 'instance-0' references 'model-component' version 1, but no manifest was collected. Add the Component declaration, or correct this instance's componentId and version.",
  });
});

it("explains that duplicate manifests must be removed rather than adding another", () => {
  const input = modelProject();
  input.components = [...input.components, ...input.components];
  const result = resolvePresentation(input);
  expect(result.diagnostics).toContainEqual({
    code: "compiler-component-not-found",
    path: ["presentation", "scene", "components", 0],
    message:
      "Component instance 'instance-0' references 'model-component' version 1, but 2 manifests were collected. Remove duplicate declarations for this componentId and version.",
  });
});
