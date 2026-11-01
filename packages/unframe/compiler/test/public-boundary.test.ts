import { expect, it } from "vitest";
import * as compiler from "../src/index.js";

it("does not export Source preparation or build execution from the compiler", () => {
  for (const name of [
    "checkAuthoringProjectAssembly",
    "assembleAuthoringProject",
    "assembleDeclarationProject",
    "computeFrozenComponentInputs",
    "prepareLockedOpaqueBundleInput",
    "compileDeclarationProject",
    "compileAuthoringProject",
    "planCheckedDeclarationProject",
    "checkDeclarationProject",
    "resolveDeclarationProject",
  ])
    expect(compiler).not.toHaveProperty(name);
});

it("exposes Presentation resolution without artifact metadata", async () => {
  const { createDeliveryFixtureProject } = await import("./fixtures/plan-project.js");
  expect("resolvePresentation" in compiler).toBe(true);
  const result = compiler.resolvePresentation(createDeliveryFixtureProject());
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.presentationId).toBe("compiler-wire-fixture");
  expect(result.value).not.toHaveProperty("assetSet");
  expect(result.value).not.toHaveProperty("definitionJson");
});
