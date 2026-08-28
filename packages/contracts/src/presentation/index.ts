import * as z from "zod";

import { presentationDefinitionSchema } from "./definition";
import { renderBundleSchema } from "./render-bundle";

const draft202012 = "https://json-schema.org/draft/2020-12/schema";

const generateJsonSchema = (
  schema: z.ZodType,
  id: string,
  title: string,
): Record<string, unknown> => {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    reused: "ref",
    override: ({ jsonSchema }) => {
      if (!Array.isArray(jsonSchema.prefixItems)) return;
      jsonSchema.items = false;
      jsonSchema.minItems = jsonSchema.prefixItems.length;
      jsonSchema.maxItems = jsonSchema.prefixItems.length;
    },
  }) as Record<string, unknown>;
  const { $schema: _schema, id: _id, title: _title, ...shape } = generated;
  return { $schema: draft202012, $id: id, title, ...shape };
};

export { idSchema } from "./common";
export { presentationDefinitionSchema, semanticSurfaceSchema } from "./definition";
export { renderBundleSchema };
export type { SerializedPresentationDefinitionV1 } from "./definition";
export type { SerializedRenderBundleV1 } from "./render-bundle";

export const presentationDefinitionJsonSchema = generateJsonSchema(
  presentationDefinitionSchema,
  "https://contracts.unframe.dev/presentation/presentation-definition.v1.schema.json",
  "SerializedPresentationDefinitionV1",
);

export const renderBundleJsonSchema = generateJsonSchema(
  renderBundleSchema,
  "https://contracts.unframe.dev/presentation/render-bundle.v1.schema.json",
  "SerializedRenderBundleV1",
);
