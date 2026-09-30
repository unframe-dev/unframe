import { z } from "zod";

export const AssetReferenceSchema = z.object({
  id: z.string().min(1),
  mediaType: z.literal("model/gltf-binary"),
  name: z.string().min(1),
});

export type AssetReference = z.infer<typeof AssetReferenceSchema>;
