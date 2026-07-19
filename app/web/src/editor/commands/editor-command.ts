import { z } from "zod";
import { ElementSchema } from "../../document/schema/element";
import { TransformSchema } from "../../document/schema/transform";

export const ElementChangesSchema = z
  .object({
    name: z.string().min(1).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    content: z.string().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    "Element changes must contain at least one value",
  );

export const EditorCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("element.add"),
    slideId: z.string().min(1),
    element: ElementSchema,
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("element.remove"),
    slideId: z.string().min(1),
    elementId: z.string().min(1),
  }),
  z.object({
    type: z.literal("element.transform"),
    elementId: z.string().min(1),
    transform: TransformSchema,
  }),
  z.object({
    type: z.literal("element.update"),
    elementId: z.string().min(1),
    changes: ElementChangesSchema,
  }),
  z.object({
    type: z.literal("slide.reorder"),
    slideId: z.string().min(1),
    toIndex: z.number().int().nonnegative(),
  }),
]);

export type ElementChanges = z.infer<typeof ElementChangesSchema>;
export type EditorCommand = z.infer<typeof EditorCommandSchema>;
