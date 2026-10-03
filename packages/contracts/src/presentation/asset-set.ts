import * as z from "zod";

import { contentHashSchema, idSchema, safeUIntSchema } from "./common";

export const assetDescriptorSchema = z.strictObject({
  checksum: contentHashSchema,
  mediaType: z.enum([
    "image/png",
    "image/jpeg",
    "font/ttf",
    "font/otf",
    "video/mp4",
    "model/gltf-binary",
  ]),
  encodedSizeBytes: safeUIntSchema,
});

export const assetSetManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  assets: z.record(idSchema, assetDescriptorSchema),
});

export type AssetDescriptor = z.infer<typeof assetDescriptorSchema>;
export type AssetSetManifest = z.infer<typeof assetSetManifestSchema>;
