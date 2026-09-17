import * as z from "zod";

const nonEmptyStringSchema = z.string().min(1);
const rgbaByteSchema = z.number().int().min(0).max(255);

export const adapterIdentitySchema = z.strictObject({
  id: nonEmptyStringSchema,
  implementationHash: nonEmptyStringSchema,
});

export const adapterCaptureSchema = z.function();

export const createBakedWebRendererOptionsSchema = z.strictObject({
  adapter: z.unknown(),
  config: z.unknown(),
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

export const browserCaptureSchema = z
  .strictObject({
    rgba: z.instanceof(Uint8Array),
    pixelSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    colorSpace: z.literal("srgb"),
    alphaMode: z.enum(["opaque", "straight"]),
  })
  .superRefine((capture, context) => {
    const [width, height] = capture.pixelSize;
    if (capture.rgba.byteLength !== width * height * 4)
      context.addIssue({
        code: "custom",
        path: ["rgba"],
        message: "RGBA byte length must match pixel size.",
      });
    if (
      capture.alphaMode === "opaque" &&
      capture.rgba.some((_, index) => index % 4 === 3 && capture.rgba[index] !== 255)
    )
      context.addIssue({
        code: "custom",
        path: ["rgba"],
        message: "Opaque capture alpha bytes must be 255.",
      });
  });

export const browserCaptureSchemaFor = (pixelTarget: readonly [number, number]) =>
  browserCaptureSchema.superRefine((capture, context) => {
    if (capture.pixelSize[0] !== pixelTarget[0] || capture.pixelSize[1] !== pixelTarget[1])
      context.addIssue({
        code: "custom",
        path: ["pixelSize"],
        message: "Capture pixel size must match the requested target.",
      });
  });
