import { z } from "zod";
import { AssetReferenceSchema } from "./asset";
import { SlideSchema } from "./slide";

export const PresentationMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

export const PresentationDocumentSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    metadata: PresentationMetadataSchema,
    slides: z.array(SlideSchema).min(1),
    assets: z.array(AssetReferenceSchema),
  })
  .superRefine((document, context) => {
    const assetIds = new Set<string>();
    for (const [index, asset] of document.assets.entries()) {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          message: `Asset ID ${asset.id} must be unique`,
          path: ["assets", index, "id"],
        });
      }
      assetIds.add(asset.id);
    }

    const slideIds = new Set<string>();
    const elementIds = new Set<string>();
    for (const [slideIndex, slide] of document.slides.entries()) {
      if (slideIds.has(slide.id)) {
        context.addIssue({
          code: "custom",
          message: `Slide ID ${slide.id} must be unique`,
          path: ["slides", slideIndex, "id"],
        });
      }
      slideIds.add(slide.id);

      for (const [elementIndex, element] of slide.elements.entries()) {
        if (elementIds.has(element.id)) {
          context.addIssue({
            code: "custom",
            message: `Element ID ${element.id} must be unique`,
            path: ["slides", slideIndex, "elements", elementIndex, "id"],
          });
        }
        elementIds.add(element.id);

        if (element.type === "model" && !assetIds.has(element.assetId)) {
          context.addIssue({
            code: "custom",
            message: `Asset ${element.assetId} does not exist`,
            path: ["slides", slideIndex, "elements", elementIndex, "assetId"],
          });
        }
      }
    }
  });

export type PresentationMetadata = z.infer<typeof PresentationMetadataSchema>;
export type PresentationDocument = z.infer<typeof PresentationDocumentSchema>;
