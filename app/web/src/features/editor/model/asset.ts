import { z } from "zod";

export const AssetReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mediaType: z.literal("model/gltf-binary"),
});

export type AssetReference = z.infer<typeof AssetReferenceSchema>;
