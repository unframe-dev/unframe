import * as ts from "typescript";
import { z } from "zod";

import { safePlainClone } from "../validation/safe-plain-clone.js";

export type AuthoringSourceInput = {
  readonly fileName: string;
  readonly sourceText: string;
};

export type AuthoringSourceDiagnostic = {
  readonly code:
    | "compiler-invalid-input"
    | "compiler-source-kind-unsupported"
    | "compiler-source-syntax-error";
  readonly column: number;
  readonly fileName: string;
  readonly length: number;
  readonly line: number;
  readonly message: string;
  readonly start: number;
  readonly typescriptCode?: number;
};

export type ParsedAuthoringSource =
  | { readonly diagnostics: []; readonly ok: true; readonly value: ts.SourceFile }
  | { readonly diagnostics: Array<AuthoringSourceDiagnostic>; readonly ok: false };

const scriptKindFor = (fileName: string) => {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (
    fileName.endsWith(".ts") ||
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".mts") ||
    fileName.endsWith(".cts")
  ) {
    return ts.ScriptKind.TS;
  }
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

const authoringSourceInputSchema = z
  .object({ fileName: z.string(), sourceText: z.string() })
  .strict();

const hasAuthoringSourceKeys = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  Object.keys(value).every((key) => key === "fileName" || key === "sourceText");

export const parseAuthoringSource = (input: unknown): ParsedAuthoringSource => {
  const snapshot = safePlainClone(input);
  if (!snapshot.valid) {
    return {
      diagnostics: [
        {
          code: "compiler-invalid-input",
          fileName: "",
          message: "Authoring source input cannot be inspected safely.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
      ok: false,
    };
  }
  if (!hasAuthoringSourceKeys(snapshot.value)) {
    return {
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName: "",
          message: "Authoring source input must contain a file name and source text.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
      ok: false,
    };
  }
  const parsedInput = authoringSourceInputSchema.safeParse(snapshot.value);
  if (!parsedInput.success) {
    return {
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName: "",
          message: "Authoring source input must contain a file name and source text.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
      ok: false,
    };
  }
  const { fileName, sourceText } = parsedInput.data;
  const scriptKind = scriptKindFor(fileName);
  if (scriptKind === undefined) {
    return {
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName,
          message: "Authoring source must use a TypeScript source or declaration file name.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
      ok: false,
    };
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const program = ts.createProgram({
    host: compilerHostFor(sourceFile, sourceText),
    options: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@unframe/unframe-authoring",
      noLib: true,
      noResolve: true,
    },
    rootNames: [fileName],
  });
  const diagnostics = program
    .getSyntacticDiagnostics(sourceFile)
    .map((item): AuthoringSourceDiagnostic => {
      const start = item.start ?? 0;
      const position = sourceFile.getLineAndCharacterOfPosition(start);
      return {
        code: "compiler-source-syntax-error",
        column: position.character + 1,
        fileName,
        length: item.length ?? 0,
        line: position.line + 1,
        message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
        start,
        typescriptCode: item.code,
      };
    })
    .sort(compareDiagnostics);

  return diagnostics.length === 0
    ? { diagnostics: [], ok: true, value: sourceFile }
    : { diagnostics, ok: false };
};
