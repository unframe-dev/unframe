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
    override: ({ jsonSchema }) => {
      if (!Array.isArray(jsonSchema.prefixItems)) {
        return;
      }
      jsonSchema.items = false;
      jsonSchema.minItems = jsonSchema.prefixItems.length;
      jsonSchema.maxItems = jsonSchema.prefixItems.length;
    },
    reused: "ref",
    target: "draft-2020-12",
    unrepresentable: "throw",
  }) as Record<string, unknown>;
  const { $schema: _schema, id: _id, title: _title, ...shape } = generated;
  return { $id: id, $schema: draft202012, title, ...shape };
};

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
