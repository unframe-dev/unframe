import * as z from "zod";

import { idV2Schema, uint32V2Schema } from "./common";

const base = { id: idV2Schema, parentId: idV2Schema.nullable(), order: uint32V2Schema };
const language = { language: z.string().min(1).optional() };
const text = { text: z.string().min(1), ...language };

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
  z.strictObject({ ...base, role: z.literal("image"), alt: z.string().min(1), ...language }),
  z.strictObject({ ...base, role: z.literal("button"), interactionId: idV2Schema, ...text }),
  z.strictObject({ ...base, role: z.literal("list"), ordered: z.boolean() }),
  z.strictObject({ ...base, role: z.literal("listItem"), ...text }),
  z.strictObject({
    ...base,
    role: z.literal("table"),
    label: z.string().min(1).optional(),
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
  z.strictObject({ ...base, role: z.literal("image"), alt: z.string().min(1), ...language }),
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
    label: z.string().min(1).optional(),
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
      text: z.string().min(1).optional(),
      language: z.string().min(1).nullable().optional(),
      alt: z.string().min(1).optional(),
      label: z.string().min(1).nullable().optional(),
    }),
  ),
});

export type SemanticNodeDefinitionV2 = z.infer<typeof semanticNodeDefinitionV2Schema>;
export type SemanticTreeDefinitionV2 = z.infer<typeof semanticTreeDefinitionV2Schema>;
export type CompletedSemanticTreeV2 = z.infer<typeof completedSemanticTreeV2Schema>;
