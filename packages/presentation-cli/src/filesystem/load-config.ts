import {
  ScriptTarget,
  createSourceFile,
  isExportAssignment,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
} from "typescript";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const hasLoneSurrogate = (source: string) => {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (
        index + 1 >= source.length ||
        source.charCodeAt(index + 1) < 0xdc00 ||
        source.charCodeAt(index + 1) > 0xdfff
      )
        return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

export const loadProjectConfig = (bytes: Uint8Array): string | undefined => {
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  if (source.charCodeAt(0) === 0xfeff || hasLoneSurrogate(source)) return undefined;
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
  const properties = statement.expression.properties;
  if (properties.length !== 1) return undefined;
  const property = properties[0]!;
  if (
    !isPropertyAssignment(property) ||
    !isIdentifier(property.name) ||
    property.name.text !== "entryFile"
  )
    return undefined;
  if (!isStringLiteral(property.initializer) || hasLoneSurrogate(property.initializer.text))
    return undefined;
  return property.initializer.text;
};
