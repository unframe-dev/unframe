import type { StyleDiagnostic } from "@unframe/unframe-tailwind";
import type { PresentationCliDiagnostic } from "./types.js";

export const styleDiagnostics = (
  diagnostics: readonly StyleDiagnostic[],
  errorCode = "cli-style-transform-failed",
): PresentationCliDiagnostic[] =>
  diagnostics.map((item) => ({
    ...item,
    family: "semantic",
    code: item.severity === "warning" ? "cli-style-warning" : errorCode,
    path: item.file ? [item.file] : [],
  }));
