import path from "node:path";
import { z } from "zod";

const logicalFileSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.posix.isAbsolute(value) &&
      !value.includes("\\") &&
      value.split("/").every((part) => part !== ".." && part !== "." && part !== ""),
    "Expected a project-relative logical file path",
  );
const logicalDependencySchema = z.union([z.literal("."), logicalFileSchema]);
export const compileStylesRequestSchema = z.strictObject({
  projectRoot: z.string(),
  entries: z
    .array(
      z
        .string()
        .min(1)
        .refine((entry) => !path.isAbsolute(entry), "CSS entry must be project-root-relative"),
    )
    .readonly(),
});
export const styleDiagnosticSchema = z.strictObject({
  phase: z.enum(["config", "resolve", "transform"]),
  severity: z.enum(["warning", "error"]),
  message: z.string(),
  file: logicalFileSchema.optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  plugin: z.string().optional(),
});
export const observedDependencySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("file"), path: logicalFileSchema }),
  z.strictObject({
    kind: z.literal("directory"),
    path: logicalDependencySchema,
    glob: z.string().optional(),
  }),
]);
export const compileStylesResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    configFile: logicalFileSchema,
    stylesheets: z.array(
      z.strictObject({
        entry: logicalFileSchema,
        css: z.string(),
        sourceMap: z.string().optional(),
      }),
    ),
    observedDependencies: z.array(observedDependencySchema),
    diagnostics: z.array(styleDiagnosticSchema),
  }),
  z.strictObject({ ok: z.literal(false), diagnostics: z.array(styleDiagnosticSchema).min(1) }),
]);
export type CompileStylesRequest = z.infer<typeof compileStylesRequestSchema>;
export type CompileStylesResult = z.infer<typeof compileStylesResultSchema>;
export type StyleDiagnostic = z.infer<typeof styleDiagnosticSchema>;
export type ObservedDependency = z.infer<typeof observedDependencySchema>;

export const packageManifestSchema = z.object({ version: z.string() });
const locationSchema = {
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  plugin: z.string().optional(),
};
export const errorDiagnosticSchema = z.object({
  message: z.string().optional(),
  reason: z.string().optional(),
  stack: z.string().optional(),
  file: z.string().optional(),
  ...locationSchema,
});
export const dependencyMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dependency"), file: z.string() }),
  z.object({ type: z.literal("dir-dependency"), dir: z.string(), glob: z.string().optional() }),
  z.object({
    type: z.literal("warning"),
    text: z.string(),
    ...locationSchema,
    node: z
      .object({
        source: z
          .object({ input: z.object({ file: z.string().optional() }).optional() })
          .optional(),
      })
      .optional(),
  }),
]);
export const sourceMapSchema = z
  .object({
    version: z.literal(3),
    file: z.string().optional(),
    sourceRoot: z.string().optional(),
    sources: z.array(z.string()),
    sourcesContent: z.array(z.string().nullable()).optional(),
    names: z.array(z.string()),
    mappings: z.string(),
  })
  .passthrough();
