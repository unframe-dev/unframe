import { expect, it } from "vitest";
import { sourceDiagnosticFamily } from "../src/application/source-diagnostic-family.js";

it.each([
  ["compiler-source-syntax-error", "syntax"],
  ["compiler-source-kind-unsupported", "syntax"],
  ["compiler-static-expression-invalid", "syntax"],
  ["compiler-source-type-error", "type"],
  ["compiler-module-unresolved", "type"],
  ["compiler-project-entry-invariant-invalid", "type"],
  ["compiler-binding-invalid", "semantic"],
] as const)("classifies %s as %s for CLI and Author", (code, family) => {
  expect(sourceDiagnosticFamily(code)).toBe(family);
});
