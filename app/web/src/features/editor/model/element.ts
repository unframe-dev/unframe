import { z } from "zod";
import { TransformSchema } from "./transform";

const ElementBaseShape = {
  id: z.string().min(1),
  locked: z.boolean(),
  name: z.string().min(1),
  transform: TransformSchema,
  visible: z.boolean(),
};

export const ModelElementSchema = z.object({
  ...ElementBaseShape,
  assetId: z.string().min(1),
  type: z.literal("model"),
});

export const TextElementSchema = z.object({
  ...ElementBaseShape,
  content: z.string(),
  type: z.literal("text"),
});

export const ElementSchema = z.discriminatedUnion("type", [ModelElementSchema, TextElementSchema]);

export type ModelElement = z.infer<typeof ModelElementSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type Element = z.infer<typeof ElementSchema>;
