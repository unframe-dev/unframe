import { z } from "zod";

export const assetMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "model/gltf-binary",
]);
export const assetInitInputSchema = z
  .object({
    mediaType: assetMediaTypeSchema,
    name: z.string().min(1).max(512),
    presentationId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    sha256Hex: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();

export type AssetInitInput = z.infer<typeof assetInitInputSchema>;
export type AssetMediaType = z.infer<typeof assetMediaTypeSchema>;
