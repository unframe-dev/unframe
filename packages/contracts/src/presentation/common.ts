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
  alt: z.string().optional(),
  id: idSchema,
  interactionId: idSchema.optional(),
  language: z.string().optional(),
  order: z.number(),
  parentId: idSchema.nullable(),
  role: z.enum(["heading", "paragraph", "image", "button", "table", "list", "listItem"]),
  text: z.string().optional(),
});

export const semanticTreeSchema = z.strictObject({
  nodes: z.record(z.string(), semanticNodeSchema),
  rootNodeIds: z.array(idSchema),
});

export const boundsSchema = z.strictObject({
  height: positiveNumberSchema,
  width: positiveNumberSchema,
  x: z.number(),
  y: z.number(),
});
