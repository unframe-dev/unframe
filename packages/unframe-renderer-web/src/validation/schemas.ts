import * as z from "zod";

const nonEmptyStringSchema = z.string().min(1);

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
    fontFingerprint: nonEmptyStringSchema,
    id: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
  }),
  clock: z.literal("fixed"),
  colorSpace: z.literal("srgb"),
  deviceScaleFactor: z.literal(1),
  filesystem: z.literal("deny"),
  locale: nonEmptyStringSchema,
  network: z.literal("deny"),
  random: z.literal("fixed"),
  timezone: nonEmptyStringSchema,
});

export const webRendererConfigSchema = z.strictObject({});

export const browserCaptureSchema = z
  .strictObject({
    alphaMode: z.enum(["opaque", "straight"]),
    colorSpace: z.literal("srgb"),
    pixelSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    rgba: z.instanceof(Uint8Array),
  })
  .superRefine((capture, context) => {
    const [width, height] = capture.pixelSize;
    if (capture.rgba.byteLength !== width * height * 4) {
      context.addIssue({
        code: "custom",
        message: "RGBA byte length must match pixel size.",
        path: ["rgba"],
      });
    }
    if (
      capture.alphaMode === "opaque" &&
      capture.rgba.some((_, index) => index % 4 === 3 && capture.rgba[index] !== 255)
    ) {
      context.addIssue({
        code: "custom",
        message: "Opaque capture alpha bytes must be 255.",
        path: ["rgba"],
      });
    }
  });

export const browserCaptureSchemaFor = (pixelTarget: readonly [number, number]) =>
  browserCaptureSchema.superRefine((capture, context) => {
    if (capture.pixelSize[0] !== pixelTarget[0] || capture.pixelSize[1] !== pixelTarget[1]) {
      context.addIssue({
        code: "custom",
        message: "Capture pixel size must match the requested target.",
        path: ["pixelSize"],
      });
    }
  });
