import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export const plainRecordSchema = z.record(z.string(), z.unknown());
const lockOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    entryFile: nonEmptyStringSchema,
    files: z.array(z.strictObject({ hash: nonEmptyStringSchema, path: nonEmptyStringSchema })),
    kind: z.literal("local"),
    sourceHash: nonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal("package"),
    packageKey: nonEmptyStringSchema,
    subpath: nonEmptyStringSchema,
  }),
]);
const structuredLockSchema = z.strictObject({
  manifestHash: nonEmptyStringSchema,
  mode: z.literal("structured"),
  origin: lockOriginSchema,
  structureHash: nonEmptyStringSchema,
});
const opaqueLockSchema = z.strictObject({
  manifestHash: nonEmptyStringSchema,
  mode: z.literal("opaque"),
  origin: lockOriginSchema,
  rendererInputHash: nonEmptyStringSchema,
});
export const declarationProjectEnvelopeSchema = z
  .object({
    assets: plainRecordSchema,
    components: z.array(
      z.union([
        z.strictObject({
          lock: structuredLockSchema,
          manifest: plainRecordSchema,
          structure: plainRecordSchema,
        }),
        z.strictObject({
          lock: opaqueLockSchema,
          manifest: plainRecordSchema,
          metadata: plainRecordSchema,
          rendererEntry: nonEmptyStringSchema,
          rendererSource: nonEmptyStringSchema,
        }),
      ]),
    ),
    presentation: plainRecordSchema,
    themes: z.array(
      z.object({ declaration: plainRecordSchema, hash: nonEmptyStringSchema }).strict(),
    ),
  })
  .strict();
export const declarationProjectFieldKeysSchema = z.array(
  z.enum(["presentation", "themes", "components", "assets"]),
);
export const compilerBuildOptionsSchema = z
  .object({
    colorScheme: z.enum(["light", "dark"]),
    compiler: z
      .object({
        baseEnvironmentHash: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        version: nonEmptyStringSchema,
      })
      .strict(),
    encodeLimits: z.object({}).passthrough(),
    locale: nonEmptyStringSchema,
    rendererConfigHash: nonEmptyStringSchema,
    renderers: z.array(z.unknown()),
    timezone: nonEmptyStringSchema,
  })
  .strict();
export const diagnosticSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  relatedPath: z.array(z.union([z.string(), z.number()])).optional(),
});
