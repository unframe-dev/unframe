import {
  ScriptTarget,
  createSourceFile,
  isExportAssignment,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  type Expression,
} from "typescript";
import { idSchema } from "@unframe/contracts/presentation";
import { z } from "zod";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const sourceAssetMediaTypeSchema = z.enum([
  "font/ttf",
  "font/otf",
  "image/png",
  "image/jpeg",
  "model/gltf-binary",
  "video/mp4",
]);
export const sourceAssetPathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      path.isWellFormed() &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      path
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            ![".git", ".unframe", "dist", "node_modules"].includes(part),
        ),
  );
const projectConfigSchema = z.strictObject({
  entryFile: z
    .string()
    .min(1)
    .refine((value) => value.isWellFormed()),
  assets: z
    .record(
      idSchema,
      z.strictObject({
        path: sourceAssetPathSchema,
        mediaType: sourceAssetMediaTypeSchema,
      }),
    )
    .default({}),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

const staticData = (expression: Expression, depth = 0): unknown => {
  if (isStringLiteral(expression))
    return expression.text.isWellFormed() ? expression.text : undefined;
  if (!isObjectLiteralExpression(expression) || depth > 2) return undefined;
  const values = new Map<string, unknown>();
  for (const property of expression.properties) {
    if (
      !isPropertyAssignment(property) ||
      !(isIdentifier(property.name) || isStringLiteral(property.name)) ||
      (depth === 0 && !isIdentifier(property.name)) ||
      values.has(property.name.text)
    )
      return undefined;
    const value = staticData(property.initializer, depth + 1);
    if (value === undefined) return undefined;
    values.set(property.name.text, value);
  }
  return Object.fromEntries(values);
};

export const loadProjectConfig = (bytes: Uint8Array): ProjectConfig | undefined => {
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  if (source.charCodeAt(0) === 0xfeff || !source.isWellFormed()) return undefined;
  const file = createSourceFile("unframe.config.ts", source, ScriptTarget.ES2022, true);
  const diagnostics = (file as unknown as { readonly parseDiagnostics: readonly unknown[] })
    .parseDiagnostics;
  if (diagnostics.length !== 0 || file.statements.length !== 1) return undefined;
  const statement = file.statements[0]!;
  if (
    !isExportAssignment(statement) ||
    statement.isExportEquals ||
    !isObjectLiteralExpression(statement.expression)
  )
    return undefined;
  const parsed = projectConfigSchema.safeParse(staticData(statement.expression));
  return parsed.success ? parsed.data : undefined;
};
