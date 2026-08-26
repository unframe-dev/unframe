import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "json-schema-to-typescript";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const sources = [
  [
    "presentation/presentation-definition.schema.json",
    "SerializedPresentationDefinitionV1",
    "presentationDefinitionSchema",
  ],
  ["presentation/render-bundle.schema.json", "SerializedRenderBundleV1", "renderBundleSchema"],
] as const;
const outputPath = resolve(root, "src/presentation.schema.ts");

const forTypeGeneration = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(forTypeGeneration);
  if (value === null || typeof value !== "object") return value;

  const schema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, forTypeGeneration(child)]),
  );
  if (Array.isArray(schema["prefixItems"]) && schema["items"] === false) {
    schema["items"] = schema["prefixItems"];
    schema["additionalItems"] = false;
    delete schema["prefixItems"];
  }
  return schema;
};

const generated = await Promise.all(
  sources.map(async ([relativePath, typeName, schemaName]) => {
    const schema = JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
    // json-schema-to-typescript still expects the pre-2020 tuple keywords. The
    // exported runtime schema remains untouched and uses Draft 2020-12.
    const typeSchema = forTypeGeneration(schema) as Parameters<typeof compile>[0];
    const type = await compile(typeSchema, typeName, {
      bannerComment: "",
      declareExternallyReferenced: true,
      style: { singleQuote: true },
    });

    const namespace = `${typeName}Schema`;
    return `export const ${schemaName} = ${JSON.stringify(schema, null, 2)} as const;\n\nexport namespace ${namespace} {\n${type.trim()}\n}\n\nexport type ${typeName} = ${namespace}.${typeName};\n`;
  }),
);
const output = await format(
  `// Generated from presentation/*.schema.json. Do not edit.\n\n${generated.join("\n")}`,
  { parser: "typescript" },
);

if (process.argv.includes("--check")) {
  if ((await readFile(outputPath, "utf8")) !== output) process.exitCode = 1;
} else {
  await writeFile(outputPath, output);
}
