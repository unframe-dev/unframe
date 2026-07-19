import { z } from "zod";
import { TransformSchema } from "./transform";

const ElementBaseShape = {
  id: z.string().min(1),
  name: z.string().min(1),
  transform: TransformSchema,
  visible: z.boolean(),
  locked: z.boolean(),
};

export const ModelElementSchema = z.object({
  ...ElementBaseShape,
  type: z.literal("model"),
  assetId: z.string().min(1),
});

export const TextElementSchema = z.object({
  ...ElementBaseShape,
  type: z.literal("text"),
  content: z.string(),
});

export const ElementSchema = z.discriminatedUnion("type", [ModelElementSchema, TextElementSchema]);

export type ModelElement = z.infer<typeof ModelElementSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type Element = z.infer<typeof ElementSchema>;
