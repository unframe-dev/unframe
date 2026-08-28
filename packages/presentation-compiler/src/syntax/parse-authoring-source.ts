import * as ts from "typescript";

export type AuthoringSourceInput = {
  readonly fileName: string;
  readonly sourceText: string;
};

export type AuthoringSourceDiagnostic = {
  readonly code: "compiler-source-kind-unsupported" | "compiler-source-syntax-error";
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
  readonly typescriptCode?: number;
};

export type ParsedAuthoringSource =
  | { readonly ok: true; readonly value: ts.SourceFile; readonly diagnostics: [] }
  | { readonly ok: false; readonly diagnostics: AuthoringSourceDiagnostic[] };

const scriptKindFor = (fileName: string) => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".ts")) return ts.ScriptKind.TS;
  return undefined;
};

const compareDiagnostics = (left: AuthoringSourceDiagnostic, right: AuthoringSourceDiagnostic) =>
  left.start - right.start ||
  (left.typescriptCode ?? 0) - (right.typescriptCode ?? 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const compilerHostFor = (sourceFile: ts.SourceFile, sourceText: string): ts.CompilerHost => ({
  fileExists: (fileName) => fileName === sourceFile.fileName,
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => "",
  getDefaultLibFileName: () => "lib.d.ts",
  getDirectories: () => [],
  getNewLine: () => "\n",
  getSourceFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined),
  readFile: (fileName) => (fileName === sourceFile.fileName ? sourceText : undefined),
  useCaseSensitiveFileNames: () => true,
  writeFile: () => undefined,
});

export const parseAuthoringSource = (input: AuthoringSourceInput): ParsedAuthoringSource => {
  const scriptKind = scriptKindFor(input.fileName);
  if (scriptKind === undefined)
    return {
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName: input.fileName,
          message: "Authoring source must use a .ts or .tsx file name.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
    };

  const sourceFile = ts.createSourceFile(
    input.fileName,
    input.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const program = ts.createProgram({
    rootNames: [input.fileName],
    options: { jsx: ts.JsxEmit.Preserve, noLib: true, noResolve: true },
    host: compilerHostFor(sourceFile, input.sourceText),
  });
  const diagnostics = program
    .getSyntacticDiagnostics(sourceFile)
    .map((item): AuthoringSourceDiagnostic => {
      const start = item.start ?? 0;
      const position = sourceFile.getLineAndCharacterOfPosition(start);
      return {
        code: "compiler-source-syntax-error",
        fileName: input.fileName,
        message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
        start,
        length: item.length ?? 0,
        line: position.line + 1,
        column: position.character + 1,
        typescriptCode: item.code,
      };
    })
    .sort(compareDiagnostics);

  return diagnostics.length === 0
    ? { ok: true, value: sourceFile, diagnostics: [] }
    : { ok: false, diagnostics };
};
