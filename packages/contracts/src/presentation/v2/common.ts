import * as z from "zod";

export const idV2Schema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/);
export const contentHashV2Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const finiteNumberV2Schema = z.number().finite();
export const nonNegativeFiniteNumberV2Schema = finiteNumberV2Schema.min(0);
export const positiveFiniteNumberV2Schema = finiteNumberV2Schema.positive();
export const unitIntervalV2Schema = finiteNumberV2Schema.min(0).max(1);
export const safeUIntV2Schema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveSafeUIntV2Schema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
export const uint32V2Schema = z.int().min(0).max(4_294_967_295);

export const vector2V2Schema = z.tuple([finiteNumberV2Schema, finiteNumberV2Schema]);
export const positiveVector2V2Schema = z.tuple([
  positiveFiniteNumberV2Schema,
  positiveFiniteNumberV2Schema,
]);
export const vector3V2Schema = z.tuple([
  finiteNumberV2Schema,
  finiteNumberV2Schema,
  finiteNumberV2Schema,
]);
export const positiveVector3V2Schema = z.tuple([
  positiveFiniteNumberV2Schema,
  positiveFiniteNumberV2Schema,
  positiveFiniteNumberV2Schema,
]);
export const quaternionV2Schema = z.tuple([
  finiteNumberV2Schema,
  finiteNumberV2Schema,
  finiteNumberV2Schema,
  finiteNumberV2Schema,
]);
export const transformV2Schema = z.strictObject({
  position: vector3V2Schema,
  rotation: quaternionV2Schema,
  scale: positiveVector3V2Schema,
});
export const boundsV2Schema = z.strictObject({
  x: finiteNumberV2Schema,
  y: finiteNumberV2Schema,
  width: positiveFiniteNumberV2Schema,
  height: positiveFiniteNumberV2Schema,
});
export const srgbaColorV2Schema = z.strictObject({
  red: unitIntervalV2Schema,
  green: unitIntervalV2Schema,
  blue: unitIntervalV2Schema,
  alpha: unitIntervalV2Schema,
});
export const srgbColorV2Schema = z.strictObject({
  red: unitIntervalV2Schema,
  green: unitIntervalV2Schema,
  blue: unitIntervalV2Schema,
});

export const resourceOwnerV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ kind: z.literal("group"), groupId: idV2Schema }),
]);
export const projectionAudienceV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);
export const spatialParentV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: idV2Schema }),
  z.strictObject({
    kind: z.literal("anchor"),
    target: z.enum(["head", "leftHand", "rightHand", "body"]),
    owner: z.strictObject({ kind: z.literal("presenter") }),
    followPosition: z.boolean(),
    followRotation: z.boolean(),
  }),
]);

export const easingV2Schema = z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]);
export const scalarV2Schema = z.union([z.null(), z.boolean(), finiteNumberV2Schema, z.string()]);
export const scalarTypeV2Schema = z.enum(["null", "boolean", "number", "string"]);
export const actionValueV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: scalarV2Schema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idV2Schema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
]);

export type ResourceOwnerV2 = z.infer<typeof resourceOwnerV2Schema>;
export type ProjectionAudienceV2 = z.infer<typeof projectionAudienceV2Schema>;
export type SpatialParentV2 = z.infer<typeof spatialParentV2Schema>;
