import * as ts from "typescript";

import type { ParsedAuthoringProjectValue } from "../project/parse-authoring-project.js";
import { reactCompilerHostFor, virtualCompilerHostFor } from "./virtual-compiler-host.js";
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
  | {
      readonly ok: false;
      readonly diagnostics: readonly AuthoringProjectDiagnostic[];
    };

export type AnalyzedAuthoringProject =
  | {
      readonly ok: false;
      readonly diagnostics: readonly AuthoringProjectDiagnostic[];
    }
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
  return {
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
  };
};

export const analyzeAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): AnalyzedAuthoringProject => {
  const context = new VirtualModuleContext(project);
  const diagnostics: AuthoringProjectDiagnostic[] = [];
  const pending = context.projectRootFiles.map((name) => context.sourceFiles.get(name)!);
  const visited = new Set<string>();
  while (pending.length) {
    const sourceFile = pending.pop()!;
    if (visited.has(sourceFile.fileName)) continue;
    visited.add(sourceFile.fileName);
    for (const specifier of moduleSpecifiersFor(sourceFile)) {
      const resolved = context.resolve(sourceFile.fileName, specifier.text);
      if (resolved.kind === "resolved") {
        const target = context.sourceFiles.get(resolved.fileName);
        if (target && !visited.has(target.fileName)) pending.push(target);
        continue;
      }
      const start = specifier.getStart(sourceFile) + 1;
      diagnostics.push({
        code: resolved.code,
        fileName: context.displayFileName(sourceFile),
        message: resolved.message,
        ...rangeFor(sourceFile, start, specifier.getEnd() - 1),
      });
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const options = {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  } satisfies ts.CompilerOptions;
  const host = virtualCompilerHostFor(context);
  const program = ts.createProgram({
    rootNames: context.projectRootFiles,
    options: { ...options, jsxImportSource: "@unframe/unframe-authoring" },
    host,
  });
  const isReactProjectFile = (file: ts.SourceFile, programContext: VirtualModuleContext) => {
    if (!programContext.ownerFor(file)) return false;
    const name = programContext.displayFileName(file);
    if (name.endsWith(".component.tsx")) return true;
    if (programContext.ownerFor(file)?.kind !== "project") return false;
    if (
      name === project.entryFile ||
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name.endsWith(".unframe.ts")
    )
      return false;
    return !name.endsWith(".d.ts");
  };
  const hasReactComponents = [...context.sourceFiles.values()].some((file) =>
    context.displayFileName(file).endsWith(".component.tsx"),
  );
  let reactContext: VirtualModuleContext | undefined;
  let reactDiagnostics: readonly ts.Diagnostic[] = [];
  if (hasReactComponents) {
    const cloneSource = (source: ts.SourceFile) =>
      ts.createSourceFile(
        source.fileName,
        source.text,
        ts.ScriptTarget.ES2022,
        true,
        source.fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    reactContext = new VirtualModuleContext({
      ...project,
      files: Object.fromEntries(
        Object.entries(project.files).map(([name, file]) => [name, cloneSource(file)]),
      ),
      packages: project.packages.map((pkg) => ({
        ...pkg,
        files: Object.fromEntries(
          Object.entries(pkg.files).map(([name, file]) => [name, cloneSource(file)]),
        ),
      })),
    });
    const reactOptions = {
      ...options,
      baseUrl: project.projectRoot,
      noLib: false,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      jsxImportSource: "react",
    } satisfies ts.CompilerOptions;
    const reactProgram = ts.createProgram({
      rootNames: reactContext.projectRootFiles,
      options: reactOptions,
      host: reactCompilerHostFor(reactContext, reactOptions),
    });
    reactDiagnostics = reactProgram
      .getSemanticDiagnostics()
      .filter(
        (item) =>
          item.file &&
          (isReactProjectFile(item.file, reactContext!) ||
            reactContext!.ownerFor(item.file)?.kind === "package"),
      );
  }
  const seen = new Set<string>();
  const semanticDiagnostics = [
    ...program
      .getSemanticDiagnostics()
      .filter(
        (item) =>
          !hasReactComponents ||
          !item.file ||
          (context.ownerFor(item.file)?.kind === "project" &&
            !isReactProjectFile(item.file, context)),
      ),
    ...reactDiagnostics,
  ];
  for (const item of semanticDiagnostics) {
    if (!item.file) continue;
    const start = item.start ?? 0;
    const key = `${item.file.fileName}:${start}:${item.code}:${item.length ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      code: "compiler-source-type-error",
      fileName: (reactContext?.ownerFor(item.file) ? reactContext : context).displayFileName(
        item.file,
      ),
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
    value: {
      program,
      checker: program.getTypeChecker(),
      context,
      entrySourceFile,
    },
    diagnostics: [],
  };
};

export const typecheckAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): TypecheckedAuthoringProject => {
  const analyzed = analyzeAuthoringProject(project);
  return analyzed.ok ? { ok: true, diagnostics: [] } : analyzed;
};
