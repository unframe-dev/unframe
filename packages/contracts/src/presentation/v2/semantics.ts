import * as z from "zod";

import { idV2Schema, uint32V2Schema } from "./common";

const base = { id: idV2Schema, parentId: idV2Schema.nullable(), order: uint32V2Schema };
const scalarText = z.string().regex(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/);
const nonEmptyScalarText = scalarText.min(1);
const languageTag = z
  .string()
  .regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|[xX](?:-[A-Za-z0-9]{1,8})+)$/);
const language = { language: languageTag.optional() };
const text = { text: nonEmptyScalarText, ...language };

export const semanticNodeDefinitionV2Schema = z.discriminatedUnion("role", [
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
  z.strictObject({ ...base, role: z.literal("button"), interactionId: idV2Schema, ...text }),
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

export const semanticTreeDefinitionV2Schema = z.strictObject({
  rootNodeIds: z.array(idV2Schema),
  nodes: z.record(idV2Schema, semanticNodeDefinitionV2Schema),
});

export const completedSemanticNodeV2Schema = z.discriminatedUnion("role", [
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
    interactionId: idV2Schema,
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
export const completedSemanticTreeV2Schema = z.strictObject({
  rootNodeIds: z.array(idV2Schema),
  nodes: z.record(idV2Schema, completedSemanticNodeV2Schema),
});

export const surfaceSemanticOverrideV2Schema = z.strictObject({
  nodes: z.record(
    idV2Schema,
    z.strictObject({
      included: z.boolean().optional(),
      text: nonEmptyScalarText.optional(),
      language: languageTag.nullable().optional(),
      alt: nonEmptyScalarText.optional(),
      label: nonEmptyScalarText.nullable().optional(),
    }),
  ),
});

export type SemanticNodeDefinitionV2 = z.infer<typeof semanticNodeDefinitionV2Schema>;
export type SemanticTreeDefinitionV2 = z.infer<typeof semanticTreeDefinitionV2Schema>;
export type CompletedSemanticTreeV2 = z.infer<typeof completedSemanticTreeV2Schema>;
