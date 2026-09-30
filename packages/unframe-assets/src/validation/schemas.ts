import { z } from "zod";

const positiveSafeIntegerSchema = z.number().int().safe().positive();

export const encodeLimitsSchema = z.strictObject({
  maxHeight: positiveSafeIntegerSchema,
  maxInputBytes: positiveSafeIntegerSchema,
  maxOutputBytes: positiveSafeIntegerSchema,
  maxPixels: positiveSafeIntegerSchema,
  maxWidth: positiveSafeIntegerSchema,
});

export const encodeRequestSchema = z.strictObject({
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
  colorSpace: z.literal("srgb"),
  limits: encodeLimitsSchema,
  pixelSize: z.tuple([positiveSafeIntegerSchema, positiveSafeIntegerSchema]),
  rgba: z.instanceof(Uint8Array),
  sourceId: z.string().trim().min(1),
});
