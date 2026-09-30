import { z } from "zod";
import { ElementSchema } from "@/features/editor/model/element";
import { TransformSchema } from "@/features/editor/model/transform";

export const ElementChangesSchema = z
  .object({
    content: z.string().optional(),
    locked: z.boolean().optional(),
    name: z.string().min(1).optional(),
    visible: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    "Element changes must contain at least one value",
  );

export const EditorCommandSchema = z.discriminatedUnion("type", [
  z.object({
    element: ElementSchema,
    index: z.number().int().nonnegative().optional(),
    slideId: z.string().min(1),
    type: z.literal("element.add"),
  }),
  z.object({
    elementId: z.string().min(1),
    slideId: z.string().min(1),
    type: z.literal("element.remove"),
  }),
  z.object({
    elementId: z.string().min(1),
    transform: TransformSchema,
    type: z.literal("element.transform"),
  }),
  z.object({
    changes: ElementChangesSchema,
    elementId: z.string().min(1),
    type: z.literal("element.update"),
  }),
  z.object({
    slideId: z.string().min(1),
    toIndex: z.number().int().nonnegative(),
    type: z.literal("slide.reorder"),
  }),
]);

export type ElementChanges = z.infer<typeof ElementChangesSchema>;
export type EditorCommand = z.infer<typeof EditorCommandSchema>;
