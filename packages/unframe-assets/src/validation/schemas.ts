import { z } from "zod";

const positiveSafeIntegerSchema = z.number().int().safe().positive();

export const encodeLimitsSchema = z.strictObject({
  maxWidth: positiveSafeIntegerSchema,
  maxHeight: positiveSafeIntegerSchema,
  maxPixels: positiveSafeIntegerSchema,
  maxInputBytes: positiveSafeIntegerSchema,
  maxOutputBytes: positiveSafeIntegerSchema,
});

export const encodeRequestSchema = z.strictObject({
  sourceId: z.string().trim().min(1),
  rgba: z.instanceof(Uint8Array),
  pixelSize: z.tuple([positiveSafeIntegerSchema, positiveSafeIntegerSchema]),
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
  limits: encodeLimitsSchema,
});
