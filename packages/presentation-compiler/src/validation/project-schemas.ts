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
    pixelTarget: z.tuple([z.int().positive(), z.int().positive()]),
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
export const initialOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ kind: z.literal("group"), groupId: nonEmptyStringSchema }),
]);
export const initialAudienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);
export const initialParentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: nonEmptyStringSchema }),
]);
export const initialPresentationShapeSchema = z.object({
  metadata: z.object({ title: nonEmptyStringSchema }),
  stage: z.object({
    coordinateSystem: z.strictObject({
      unit: z.literal("meter"),
      handedness: z.literal("right"),
      upAxis: z.literal("+Y"),
      forwardAxis: z.literal("-Z"),
    }),
  }),
  scene: z.object({
    spatial: z.array(
      z.object({
        kind: z.literal("spatial"),
        name: z.string(),
        owner: initialOwnerSchema,
        audience: initialAudienceSchema,
        parent: initialParentSchema,
        active: z.boolean(),
        visible: z.boolean(),
      }),
    ),
  }),
  assets: z.array(z.strictObject({ kind: z.literal("asset-ref"), assetId: nonEmptyStringSchema })),
});
