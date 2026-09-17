import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  presentationDefinitionJsonSchema,
  renderBundleJsonSchema,
} from "../src/presentation/index";

const root = resolve(import.meta.dirname, "..");
const outputs = [
  ["presentation/presentation-definition.schema.json", presentationDefinitionJsonSchema],
  ["presentation/render-bundle.schema.json", renderBundleJsonSchema],
] as const;

for (const [relativePath, schema] of outputs) {
  const outputPath = resolve(root, relativePath);
  const output = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if ((await readFile(outputPath, "utf8")) !== output) process.exitCode = 1;
  } else {
    await writeFile(outputPath, output);
  }
}
