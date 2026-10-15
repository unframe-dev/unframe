import { z } from "zod";

export const requestSchema = z.strictObject({
  root: z.string(),
  loaderUrl: z.url(),
  input: z.string().optional(),
  plainOptions: z.boolean(),
});
export const sourceMapSchema = z.object({
  version: z.literal(3),
  file: z.string().optional(),
  sourceRoot: z.string().optional(),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string().nullable()),
  names: z.array(z.string()),
  mappings: z.string(),
});
const messageSchema = z
  .object({
    type: z.string(),
    plugin: z.string().optional(),
    file: z.string().optional(),
    dir: z.string().optional(),
    glob: z.string().optional(),
  })
  .catchall(z.json());
export const responseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    css: z.string(),
    map: sourceMapSchema.optional(),
    messages: z.array(messageSchema),
    config: z.string(),
    versions: z.record(z.string(), z.string()),
    configOptionKeys: z.array(z.string()),
    processOptions: z.strictObject({
      from: z.string().optional(),
      to: z.string().optional(),
      map: z.union([z.boolean(), z.record(z.string(), z.json())]).optional(),
    }),
    nativeLibraries: z.array(z.string()),
  }),
  z.strictObject({
    ok: z.literal(false),
    phase: z.enum(["boundary", "config", "transform"]),
    name: z.string(),
    error: z.string(),
  }),
]);
export const packageVersionSchema = z.object({ version: z.string() });
export const manifestSchema = z.object({
  packageManager: z.string(),
  dependencies: z.record(z.string(), z.string()),
});
export const reportSchema = z.object({
  sharedObjects: z.array(z.string()),
  header: z.object({ glibcVersionRuntime: z.string().optional() }),
});
export const checkSchema = z.discriminatedUnion("status", [
  z.strictObject({ name: z.string(), status: z.literal("passed") }),
  z.strictObject({ name: z.string(), status: z.literal("failed"), error: z.string() }),
]);
export type Response = z.infer<typeof responseSchema>;
export type SourceMap = z.infer<typeof sourceMapSchema>;
export type Check = z.infer<typeof checkSchema>;
export type Json = z.infer<ReturnType<typeof z.json>>;
