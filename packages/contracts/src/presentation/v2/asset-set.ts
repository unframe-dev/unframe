import * as z from "zod";

import { contentHashV2Schema, idV2Schema, safeUIntV2Schema } from "./common";

export const assetDescriptorV2Schema = z.strictObject({
  checksum: contentHashV2Schema,
  mediaType: z.enum([
    "image/png",
    "image/jpeg",
    "font/ttf",
    "font/otf",
    "video/mp4",
    "model/gltf-binary",
  ]),
  encodedSizeBytes: safeUIntV2Schema,
});

export const assetSetManifestV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  assets: z.record(idV2Schema, assetDescriptorV2Schema),
});

export type AssetDescriptorV2 = z.infer<typeof assetDescriptorV2Schema>;
export type AssetSetManifestV2 = z.infer<typeof assetSetManifestV2Schema>;
