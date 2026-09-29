import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export const plainRecordSchema = z.record(z.string(), z.unknown());
export const declarationProjectEnvelopeSchema = z
  .object({
    presentation: plainRecordSchema,
    themes: z.array(
      z.object({ declaration: plainRecordSchema, hash: nonEmptyStringSchema }).strict(),
    ),
    components: z.array(
      z
        .object({
          manifest: plainRecordSchema,
          structure: plainRecordSchema,
          lock: z
            .object({
              packageVersion: nonEmptyStringSchema,
              packageIntegrity: nonEmptyStringSchema,
              manifestHash: nonEmptyStringSchema,
              structureHash: nonEmptyStringSchema,
            })
            .strict(),
        })
        .strict(),
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
