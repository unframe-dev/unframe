import * as z from "zod";

export const idSchema = z.string().min(1);
export const positiveNumberSchema = z.number().positive();
export const vector2Schema = z.tuple([positiveNumberSchema, positiveNumberSchema]);
export const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const positiveVector3Schema = z.tuple([
  positiveNumberSchema,
  positiveNumberSchema,
  positiveNumberSchema,
]);
export const quaternionSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const semanticNodeSchema = z.strictObject({
  id: idSchema,
  parentId: idSchema.nullable(),
  order: z.number(),
  role: z.enum(["heading", "paragraph", "image", "button", "table", "list", "listItem"]),
  text: z.string().optional(),
  language: z.string().optional(),
  alt: z.string().optional(),
  interactionId: idSchema.optional(),
});

export const semanticTreeSchema = z.strictObject({
  rootNodeIds: z.array(idSchema),
  nodes: z.record(z.string(), semanticNodeSchema),
});

export const boundsSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: positiveNumberSchema,
  height: positiveNumberSchema,
});
