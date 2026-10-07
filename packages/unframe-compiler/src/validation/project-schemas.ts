import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export const plainRecordSchema = z.record(z.string(), z.unknown());
const lockOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("local"),
    entryFile: nonEmptyStringSchema,
    files: z.array(z.strictObject({ path: nonEmptyStringSchema, hash: nonEmptyStringSchema })),
    sourceHash: nonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal("package"),
    packageKey: nonEmptyStringSchema,
    subpath: nonEmptyStringSchema,
  }),
]);
const structuredLockSchema = z.strictObject({
  mode: z.literal("structured"),
  origin: lockOriginSchema,
  manifestHash: nonEmptyStringSchema,
  structureHash: nonEmptyStringSchema,
});
const opaqueLockSchema = z.strictObject({
  mode: z.literal("opaque"),
  origin: lockOriginSchema,
  manifestHash: nonEmptyStringSchema,
  rendererInputHash: nonEmptyStringSchema,
});
export const declarationProjectEnvelopeSchema = z
  .object({
    presentation: plainRecordSchema,
    themes: z.array(
      z.object({ declaration: plainRecordSchema, hash: nonEmptyStringSchema }).strict(),
    ),
    components: z.array(
      z.union([
        z.strictObject({
          manifest: plainRecordSchema,
          structure: plainRecordSchema,
          lock: structuredLockSchema,
        }),
        z.strictObject({
          manifest: plainRecordSchema,
          metadata: plainRecordSchema,
          rendererEntry: nonEmptyStringSchema,
          rendererSource: nonEmptyStringSchema,
          lock: opaqueLockSchema,
        }),
      ]),
    ),
    assets: plainRecordSchema,
  })
  .strict();
export const declarationProjectFieldKeysSchema = z.array(
  z.enum(["presentation", "themes", "components", "assets"]),
);
export const compilerBuildOptionsSchema = z
  .object({
    compiler: z
      .object({
        name: nonEmptyStringSchema,
        version: nonEmptyStringSchema,
        baseEnvironmentHash: nonEmptyStringSchema,
      })
      .strict(),
    locale: nonEmptyStringSchema,
    timezone: nonEmptyStringSchema,
    colorScheme: z.enum(["light", "dark"]),
    rendererConfigHash: nonEmptyStringSchema,
    renderers: z.array(z.unknown()),
    encodeLimits: z.object({}).passthrough(),
  })
  .strict();
export const diagnosticSchema = z.strictObject({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  relatedPath: z.array(z.union([z.string(), z.number()])).optional(),
});
