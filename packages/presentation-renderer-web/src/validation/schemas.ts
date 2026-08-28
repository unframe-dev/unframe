import * as z from "zod";

const nonEmptyStringSchema = z.string().min(1);
const rgbaByteSchema = z.number().int().min(0).max(255);

export const adapterIdentitySchema = z.strictObject({
  id: nonEmptyStringSchema,
  implementationHash: nonEmptyStringSchema,
});

export const fixedBrowserEnvironmentSchema = z.strictObject({
  browser: z.strictObject({
    id: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    fontFingerprint: nonEmptyStringSchema,
  }),
  locale: nonEmptyStringSchema,
  timezone: nonEmptyStringSchema,
  colorSpace: z.literal("srgb"),
  deviceScaleFactor: z.literal(1),
  network: z.literal("deny"),
  filesystem: z.literal("deny"),
  clock: z.literal("fixed"),
  random: z.literal("fixed"),
});

export const webRendererConfigSchema = z.strictObject({
  documentBackground: z.tuple([rgbaByteSchema, rgbaByteSchema, rgbaByteSchema, rgbaByteSchema]),
  fontFamily: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9 _-]+$/),
});

export const browserCaptureSchema = z.strictObject({
  rgba: z.instanceof(Uint8Array),
  pixelSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight"]),
});
