import type { PresentationDiagnosticFamily } from "./types.js";

export const sourceDiagnosticFamily = (code: string): PresentationDiagnosticFamily =>
  code === "compiler-source-syntax-error" ||
  code === "compiler-source-kind-unsupported" ||
  code.startsWith("compiler-static-")
    ? "syntax"
    : code === "compiler-source-type-error" ||
        code.startsWith("compiler-module-") ||
        code === "compiler-project-entry-invariant-invalid"
      ? "type"
      : "semantic";
