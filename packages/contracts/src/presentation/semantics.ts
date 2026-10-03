import * as z from "zod";

import { idSchema, uint32Schema } from "./common";

const base = { id: idSchema, parentId: idSchema.nullable(), order: uint32Schema };
const scalarText = z.string().regex(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/);
const nonEmptyScalarText = scalarText.min(1);
const languageTag = z
  .string()
  .regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|[xX](?:-[A-Za-z0-9]{1,8})+)$/);
const language = { language: languageTag.optional() };
const text = { text: nonEmptyScalarText, ...language };

export const semanticNodeDefinitionSchema = z.discriminatedUnion("role", [
  z.strictObject({
    ...base,
    role: z.literal("heading"),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    ...text,
  }),
  z.strictObject({ ...base, role: z.literal("paragraph"), ...text }),
  z.strictObject({ ...base, role: z.literal("image"), alt: nonEmptyScalarText, ...language }),
  z.strictObject({ ...base, role: z.literal("button"), interactionId: idSchema, ...text }),
  z.strictObject({ ...base, role: z.literal("list"), ordered: z.boolean() }),
  z.strictObject({ ...base, role: z.literal("listItem"), ...text }),
  z.strictObject({
    ...base,
    role: z.literal("table"),
    label: nonEmptyScalarText.optional(),
    ...language,
  }),
  z.strictObject({ ...base, role: z.literal("row") }),
  z.strictObject({ ...base, role: z.literal("cell"), ...text }),
  z.strictObject({ ...base, role: z.literal("columnHeader"), ...text }),
  z.strictObject({ ...base, role: z.literal("rowHeader"), ...text }),
]);

export const semanticTreeDefinitionSchema = z.strictObject({
  rootNodeIds: z.array(idSchema),
  nodes: z.record(idSchema, semanticNodeDefinitionSchema),
});

export const completedSemanticNodeSchema = z.discriminatedUnion("role", [
  z.strictObject({
    ...base,
    role: z.literal("heading"),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    ...text,
  }),
  z.strictObject({ ...base, role: z.literal("paragraph"), ...text }),
  z.strictObject({ ...base, role: z.literal("image"), alt: nonEmptyScalarText, ...language }),
  z.strictObject({
    ...base,
    role: z.literal("button"),
    interactionId: idSchema,
    stateEnabled: z.boolean(),
    ...text,
  }),
  z.strictObject({ ...base, role: z.literal("list"), ordered: z.boolean() }),
  z.strictObject({ ...base, role: z.literal("listItem"), ...text }),
  z.strictObject({
    ...base,
    role: z.literal("table"),
    label: nonEmptyScalarText.optional(),
    ...language,
  }),
  z.strictObject({ ...base, role: z.literal("row") }),
  z.strictObject({ ...base, role: z.literal("cell"), ...text }),
  z.strictObject({ ...base, role: z.literal("columnHeader"), ...text }),
  z.strictObject({ ...base, role: z.literal("rowHeader"), ...text }),
]);
export const completedSemanticTreeSchema = z.strictObject({
  rootNodeIds: z.array(idSchema),
  nodes: z.record(idSchema, completedSemanticNodeSchema),
});

export const surfaceSemanticOverrideSchema = z.strictObject({
  nodes: z.record(
    idSchema,
    z.strictObject({
      included: z.boolean().optional(),
      text: nonEmptyScalarText.optional(),
      language: languageTag.nullable().optional(),
      alt: nonEmptyScalarText.optional(),
      label: nonEmptyScalarText.nullable().optional(),
    }),
  ),
});

export type SemanticNodeDefinition = z.infer<typeof semanticNodeDefinitionSchema>;
export type SemanticTreeDefinition = z.infer<typeof semanticTreeDefinitionSchema>;
export type CompletedSemanticTree = z.infer<typeof completedSemanticTreeSchema>;
