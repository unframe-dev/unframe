import * as z from "zod";

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
export const contentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const finiteNumberSchema = z.number().finite();
export const nonNegativeFiniteNumberSchema = finiteNumberSchema.min(0);
export const positiveFiniteNumberSchema = finiteNumberSchema.positive();
export const unitIntervalSchema = finiteNumberSchema.min(0).max(1);
export const safeUIntSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveSafeUIntSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
export const uint32Schema = z.int().min(0).max(4_294_967_295);

export const vector2Schema = z.tuple([finiteNumberSchema, finiteNumberSchema]);
export const positiveVector2Schema = z.tuple([
  positiveFiniteNumberSchema,
  positiveFiniteNumberSchema,
]);
export const vector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]);
export const positiveVector3Schema = z.tuple([
  positiveFiniteNumberSchema,
  positiveFiniteNumberSchema,
  positiveFiniteNumberSchema,
]);
export const quaternionSchema = z.tuple([
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
]);
export const transformSchema = z.strictObject({
  position: vector3Schema,
  rotation: quaternionSchema,
  scale: positiveVector3Schema,
});
export const boundsSchema = z.strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: positiveFiniteNumberSchema,
  height: positiveFiniteNumberSchema,
});
export const srgbaColorSchema = z.strictObject({
  red: unitIntervalSchema,
  green: unitIntervalSchema,
  blue: unitIntervalSchema,
  alpha: unitIntervalSchema,
});
export const srgbColorSchema = z.strictObject({
  red: unitIntervalSchema,
  green: unitIntervalSchema,
  blue: unitIntervalSchema,
});

export const resourceOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ kind: z.literal("group"), groupId: idSchema }),
]);
export const projectionAudienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);
export const spatialParentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: idSchema }),
  z.strictObject({
    kind: z.literal("anchor"),
    target: z.enum(["head", "leftHand", "rightHand", "body"]),
    owner: z.strictObject({ kind: z.literal("presenter") }),
    followPosition: z.boolean(),
    followRotation: z.boolean(),
  }),
]);

export const easingSchema = z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]);
export const scalarSchema = z.union([z.null(), z.boolean(), finiteNumberSchema, z.string()]);
export const scalarTypeSchema = z.enum(["null", "boolean", "number", "string"]);
export const actionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: scalarSchema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idSchema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
]);

export type ResourceOwner = z.infer<typeof resourceOwnerSchema>;
export type ProjectionAudience = z.infer<typeof projectionAudienceSchema>;
export type SpatialParent = z.infer<typeof spatialParentSchema>;
