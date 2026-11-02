import { z } from "zod";
import type { AuthorDiagnostic } from "@unframe/contracts/author-http";
import type { AuthorBuildExecutionResult } from "@unframe/build";
import type { PresentationCliResult } from "../application/types.js";
const diagnostic = (
  code: string,
  message: string,
  path?: readonly (string | number)[],
): AuthorDiagnostic => ({ code, message, ...(path ? { path: [...path] } : {}) });
const locationSchema = z.object({
  fileName: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
const buildDiagnosticSchema = z
  .object({
    family: z.enum(["syntax", "type", "semantic", "renderer", "io", "cancel", "usage"]),
    code: z.string(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])),
    location: locationSchema.optional(),
    severity: z.enum(["warning", "error"]).optional(),
    phase: z.enum(["config", "resolve", "transform"]).optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    plugin: z.string().optional(),
  })
  .transform(
    ({ location, severity, phase, file, line, column, plugin, ...required }): AuthorDiagnostic => ({
      ...required,
      ...(location !== undefined ? { location } : {}),
      ...(severity !== undefined ? { severity } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
      ...(plugin !== undefined ? { plugin } : {}),
    }),
  );
const buildDiagnostics = (stderr: string): AuthorDiagnostic[] => {
  try {
    const output = z
      .object({ diagnostics: z.array(buildDiagnosticSchema).min(1) })
      .safeParse(JSON.parse(stderr));
    if (output.success) return output.data.diagnostics;
  } catch {
    /* CLI output may be plain text after an unexpected failure. */
  }
  return [diagnostic("author-build-failed", stderr.trim() || "Build failed.")];
};
const buildWarnings = (stdout: string): AuthorDiagnostic[] => {
  try {
    const output = z
      .object({ warnings: z.array(buildDiagnosticSchema) })
      .safeParse(JSON.parse(stdout));
    if (output.success)
      return output.data.warnings.map((item) => ({ ...item, severity: "warning" }));
  } catch {
    /* A custom build host may return no structured warning output. */
  }
  return [];
};

export const readBuildExecutionResult = (
  result: PresentationCliResult,
): AuthorBuildExecutionResult => {
  if (result.exitCode === 0 && result.generationId)
    return {
      status: "succeeded",
      generationId: result.generationId,
      diagnostics: buildWarnings(result.stdout),
    };
  if (result.exitCode === 130) return { status: "cancelled", diagnostics: [] };
  const diagnostics = buildDiagnostics(result.stderr);
  return {
    status: diagnostics.some((item) => item.code === "cli-output-stale") ? "stale" : "failed",
    diagnostics,
  };
};
