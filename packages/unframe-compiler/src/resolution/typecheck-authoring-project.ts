import * as ts from "typescript";

import type { ParsedAuthoringProjectValue } from "../project/parse-authoring-project.js";
import { virtualCompilerHostFor } from "./virtual-compiler-host.js";
import { moduleSpecifiersFor, VirtualModuleContext } from "./virtual-module-context.js";

type AuthoringProjectDiagnostic = {
  readonly code: string;
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

export type AnalyzedAuthoringProject =
  | { readonly ok: false; readonly diagnostics: readonly AuthoringProjectDiagnostic[] }
  | {
      readonly ok: true;
      readonly value: {
        readonly program: ts.Program;
        readonly checker: ts.TypeChecker;
        readonly context: VirtualModuleContext;
        readonly entrySourceFile: ts.SourceFile;
      };
      readonly diagnostics: [];
    };

const compareDiagnostics = (left: AuthoringProjectDiagnostic, right: AuthoringProjectDiagnostic) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.typescriptCode ?? 0) - (right.typescriptCode ?? 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const rangeFor = (sourceFile: ts.SourceFile, start: number, end: number) => {
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: position.line + 1, column: position.character + 1 };
};

export const analyzeAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): AnalyzedAuthoringProject => {
  const context = new VirtualModuleContext(project);
  const diagnostics: AuthoringProjectDiagnostic[] = [];
  for (const sourceFile of context.sourceFiles.values())
    for (const specifier of moduleSpecifiersFor(sourceFile)) {
      const resolved = context.resolve(sourceFile.fileName, specifier.text);
      if (resolved.kind === "resolved") continue;
      const start = specifier.getStart(sourceFile) + 1;
      diagnostics.push({
        code: resolved.code,
        fileName: context.displayFileName(sourceFile),
        message: resolved.message,
        ...rangeFor(sourceFile, start, specifier.getEnd() - 1),
      });
    }
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const program = ts.createProgram({
    rootNames: context.projectRootFiles,
    options: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noLib: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
    host: virtualCompilerHostFor(context),
  });
  for (const item of program.getSemanticDiagnostics()) {
    if (!item.file) continue;
    const start = item.start ?? 0;
    diagnostics.push({
      code: "compiler-source-type-error",
      fileName: context.displayFileName(item.file),
      message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
      ...rangeFor(item.file, start, start + (item.length ?? 0)),
      typescriptCode: item.code,
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  const entrySourceFile = project.files[project.entryFile];
  if (!entrySourceFile)
    return {
      ok: false,
      diagnostics: [
        {
          code: "compiler-project-entry-invariant-invalid",
          fileName: "",
          message: "Parsed project entry source is unavailable.",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    };
  return {
    ok: true,
    value: { program, checker: program.getTypeChecker(), context, entrySourceFile },
    diagnostics: [],
  };
};

export const typecheckAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): TypecheckedAuthoringProject => {
  const analyzed = analyzeAuthoringProject(project);
  return analyzed.ok ? { ok: true, diagnostics: [] } : analyzed;
};
