import * as ts from "typescript";

import type { ParsedAuthoringProjectValue } from "../project/parse-authoring-project.js";

type AuthoringProjectDiagnostic = {
  readonly code:
    | "compiler-module-root-escape"
    | "compiler-module-unresolved"
    | "compiler-module-package-unsupported"
    | "compiler-source-type-error";
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly typescriptCode?: number;
};

export type TypecheckedAuthoringProject =
  | { readonly ok: true; readonly diagnostics: [] }
  | { readonly ok: false; readonly diagnostics: readonly AuthoringProjectDiagnostic[] };

type ModuleResolution =
  | { readonly kind: "resolved"; readonly fileName: string }
  | {
      readonly kind: "failed";
      readonly code:
        | "compiler-module-root-escape"
        | "compiler-module-unresolved"
        | "compiler-module-package-unsupported";
      readonly message: string;
    };

const sourceExtensions = [".ts", ".tsx", ".d.ts"] as const;

const compareDiagnostics = (left: AuthoringProjectDiagnostic, right: AuthoringProjectDiagnostic) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.typescriptCode ?? 0) - (right.typescriptCode ?? 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const relativePath = (projectRoot: string, fileName: string) =>
  projectRoot === "/" ? fileName.slice(1) : fileName.slice(projectRoot.length + 1);

const absolutePath = (projectRoot: string, fileName: string) =>
  `${projectRoot === "/" ? "" : projectRoot}/${fileName}`;

const relativeModulePath = (
  projectRoot: string,
  containingFile: string,
  specifier: string,
): string | undefined => {
  if (specifier.startsWith("/")) return undefined;
  const segments = relativePath(projectRoot, containingFile).split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
};

const moduleCandidates = (path: string) => {
  if (sourceExtensions.some((extension) => path.endsWith(extension))) return [path];
  if (path.endsWith(".js")) {
    const withoutJs = path.slice(0, -".js".length);
    return sourceExtensions.map((extension) => `${withoutJs}${extension}`);
  }
  return [
    path,
    ...sourceExtensions.map((extension) => `${path}${extension}`),
    ...sourceExtensions.map((extension) => `${path}/index${extension}`),
  ];
};

const moduleSpecifierRange = (sourceFile: ts.SourceFile, specifier: ts.StringLiteralLike) => {
  const start = specifier.getStart(sourceFile) + 1;
  const end = specifier.getEnd() - 1;
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: position.line + 1, column: position.character + 1 };
};

const moduleSpecifiersFor = (sourceFile: ts.SourceFile) => {
  const specifiers: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specifiers.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
};

const extensionFor = (fileName: string) => {
  if (fileName.endsWith(".d.ts")) return ts.Extension.Dts;
  if (fileName.endsWith(".tsx")) return ts.Extension.Tsx;
  return ts.Extension.Ts;
};

const isRelativeSpecifier = (specifier: string) =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

const moduleResolutionFor = (
  project: ParsedAuthoringProjectValue,
  containingFile: string,
  specifier: string,
): ModuleResolution => {
  if (specifier.startsWith("/"))
    return {
      kind: "failed",
      code: "compiler-module-root-escape",
      message: "Relative import must remain inside the virtual project root.",
    };
  if (!isRelativeSpecifier(specifier))
    return {
      kind: "failed",
      code: "compiler-module-package-unsupported",
      message: "Bare package imports are not supported before locked package resolution.",
    };
  const path = relativeModulePath(project.projectRoot, containingFile, specifier);
  if (path === undefined)
    return {
      kind: "failed",
      code: "compiler-module-root-escape",
      message: "Relative import must remain inside the virtual project root.",
    };
  const resolved = moduleCandidates(path).find(
    (candidate) => project.files[candidate] !== undefined,
  );
  return resolved === undefined
    ? {
        kind: "failed",
        code: "compiler-module-unresolved",
        message: "Relative import must resolve to one virtual project file.",
      }
    : { kind: "resolved", fileName: absolutePath(project.projectRoot, resolved) };
};

const compilerHostFor = (
  project: ParsedAuthoringProjectValue,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
): ts.CompilerHost => ({
  fileExists: (fileName) => sourceFiles.has(fileName),
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => project.projectRoot,
  getDefaultLibFileName: () => "",
  getDirectories: () => [],
  getNewLine: () => "\n",
  getSourceFile: (fileName) => sourceFiles.get(fileName),
  readFile: (fileName) => sourceFiles.get(fileName)?.text,
  resolveModuleNames: (moduleNames, containingFile) =>
    moduleNames.map((specifier) => {
      const resolved = moduleResolutionFor(project, containingFile, specifier);
      return resolved.kind === "resolved"
        ? { resolvedFileName: resolved.fileName, extension: extensionFor(resolved.fileName) }
        : undefined;
    }),
  useCaseSensitiveFileNames: () => true,
  writeFile: () => undefined,
});

export const typecheckAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): TypecheckedAuthoringProject => {
  const sourceFiles = new Map(
    Object.entries(project.files).map(([relativeFileName, sourceFile]) => [
      absolutePath(project.projectRoot, relativeFileName),
      sourceFile,
    ]),
  );
  const diagnostics: AuthoringProjectDiagnostic[] = [];
  for (const [relativeFileName, sourceFile] of Object.entries(project.files))
    for (const specifier of moduleSpecifiersFor(sourceFile)) {
      const resolution = moduleResolutionFor(project, sourceFile.fileName, specifier.text);
      if (resolution.kind === "resolved") continue;
      diagnostics.push({
        code: resolution.code,
        fileName: relativeFileName,
        message: resolution.message,
        ...moduleSpecifierRange(sourceFile, specifier),
      });
    }
  if (diagnostics.length > 0)
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const program = ts.createProgram({
    rootNames: [...sourceFiles.keys()],
    options: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noLib: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
    host: compilerHostFor(project, sourceFiles),
  });
  for (const item of program.getSemanticDiagnostics()) {
    const sourceFile = item.file;
    if (sourceFile === undefined) continue;
    const fileName = relativePath(project.projectRoot, sourceFile.fileName);
    const start = item.start ?? 0;
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    diagnostics.push({
      code: "compiler-source-type-error",
      fileName,
      message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
      start,
      end: start + (item.length ?? 0),
      line: position.line + 1,
      column: position.character + 1,
      typescriptCode: item.code,
    });
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) }
    : { ok: true, diagnostics: [] };
};
