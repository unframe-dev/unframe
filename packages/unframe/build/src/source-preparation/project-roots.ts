import * as ts from "typescript";
import { z } from "zod";

const configPattern =
  /^(?:postcss\.config\.(?:js|cjs|mjs|ts|cts|mts)|\.postcssrc(?:\.(?:json|yaml|yml|js|cjs|mjs|ts|cts|mts))?)$/;
export const hasPostcssConfig = (found: {
  localFiles: readonly { path: string; bytes: Uint8Array }[];
}): boolean => {
  if (found.localFiles.some(({ path }) => configPattern.test(path))) return true;
  const manifest = found.localFiles.find(({ path }) => path === "package.json");
  if (!manifest) return false;
  try {
    return z
      .object({ postcss: z.unknown() })
      .safeParse(JSON.parse(new TextDecoder().decode(manifest.bytes))).success;
  } catch {
    return false;
  }
};

/** Browser roots include authoring imports and the renderer bootstrap; config runs in Node. */
export const authoringPackageRoots = (found: {
  entryFile: string;
  files: readonly { fileName: string; sourceText: string }[];
  localFiles?: readonly { path: string; bytes: Uint8Array }[];
}): string[] => {
  const files = new Map<string, string | Uint8Array>(
    found.files.map((file) => [file.fileName, file.sourceText]),
  );
  for (const file of found.localFiles ?? [])
    if (/\.(?:[cm]?js|jsx)$/.test(file.path)) files.set(file.path, file.bytes);
  const visited = new Set<string>();
  const roots = new Set(["react", "react-dom", "@types/react", "@types/react-dom"]);
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const content = files.get(name);
    if (content === undefined) return;
    const text =
      typeof content === "string"
        ? content
        : new TextDecoder("utf-8", { fatal: true }).decode(content);
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const collect = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        specifiers.push(node.moduleSpecifier.text);
      else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        specifiers.push(node.argument.literal.text);
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        specifiers.push(node.arguments[0].text);
      ts.forEachChild(node, collect);
    };
    collect(file);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) {
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!;
        roots.add(root);
        roots.add(`@types/${root.replace(/^@/, "").replace("/", "__")}`);
        continue;
      }
      const segments = name.split("/").slice(0, -1);
      for (const part of specifier.split("/")) {
        if (part === "..") segments.pop();
        else if (part !== ".") segments.push(part);
      }
      const path = segments.join("/");
      const candidates = [
        path,
        `${path}.ts`,
        `${path}.tsx`,
        `${path}.d.ts`,
        `${path}.js`,
        `${path}.jsx`,
        `${path}.mjs`,
        `${path}.cjs`,
        `${path}/index.ts`,
        `${path}/index.tsx`,
        `${path}/index.d.ts`,
        `${path}/index.js`,
        `${path}/index.jsx`,
        `${path}/index.mjs`,
        `${path}/index.cjs`,
        path.replace(/\.js$/, ".ts"),
        path.replace(/\.js$/, ".tsx"),
      ];
      // Declarations and runtime modules can import different packages.
      const typeTarget = candidates.find((candidate) => files.has(candidate));
      const runtimeTarget = candidates.find(
        (candidate) => !candidate.endsWith(".d.ts") && files.has(candidate),
      );
      if (typeTarget) visit(typeTarget);
      if (runtimeTarget) visit(runtimeTarget);
    }
  };
  visit(found.entryFile);
  return [...roots].sort();
};
