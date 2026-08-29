import type { DeclarationSourceOrigin } from "../lowering/lower-authoring-declaration.js";
import {
  normalizeDeclarationGraph,
  type DeclarationSourceMapEntry,
  type NormalizedDeclarationValue,
} from "../normalization/normalize-declaration-graph.js";
import type { AnalyzedAuthoringProject } from "../resolution/typecheck-authoring-project.js";
import { lowerAuthoringDeclarationFile } from "../lowering/lower-authoring-declaration.js";

export type AuthoringDeclarationRole =
  | "presentation"
  | "theme"
  | "component-manifest"
  | "component-structure";
export type AuthoringDeclarationRootBuilder =
  | "definePresentation"
  | "defineTheme"
  | "defineComponentManifest"
  | "defineComponentStructure";

export type DeclarationCollectionDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type CollectedAuthoringDeclaration = {
  readonly role: AuthoringDeclarationRole;
  readonly fileName: string;
  readonly rootBuilder: AuthoringDeclarationRootBuilder;
  readonly value: NormalizedDeclarationValue;
  readonly sourceMap: readonly DeclarationSourceMapEntry[];
};

export type CollectedAuthoringDeclarations =
  | {
      readonly ok: true;
      readonly declarations: readonly CollectedAuthoringDeclaration[];
      readonly diagnostics: readonly [];
    }
  | { readonly ok: false; readonly diagnostics: readonly DeclarationCollectionDiagnostic[] };

export type CollectedAuthoringDeclarationsSuccess = Extract<
  CollectedAuthoringDeclarations,
  { readonly ok: true }
>;

const roleFor = (fileName: string, entryFileName: string) => {
  if (fileName === entryFileName)
    return { role: "presentation", rootBuilder: "definePresentation" } as const;
  if (fileName.endsWith(".unframe.ts"))
    return { role: "theme", rootBuilder: "defineTheme" } as const;
  if (fileName.endsWith(".manifest.ts"))
    return { role: "component-manifest", rootBuilder: "defineComponentManifest" } as const;
  if (fileName.endsWith(".structure.tsx"))
    return { role: "component-structure", rootBuilder: "defineComponentStructure" } as const;
  return undefined;
};

const compareDiagnostics = (
  left: DeclarationCollectionDiagnostic,
  right: DeclarationCollectionDiagnostic,
) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const diagnosticAt = (
  origin: DeclarationSourceOrigin,
  code: string,
  message: string,
): DeclarationCollectionDiagnostic => ({ code, message, ...origin });

export const collectAuthoringDeclarations = (
  analyzed: Extract<AnalyzedAuthoringProject, { readonly ok: true }>,
): CollectedAuthoringDeclarations => {
  const { context, entrySourceFile } = analyzed.value;
  const entryFileName = context.displayFileName(entrySourceFile);
  const diagnostics: DeclarationCollectionDiagnostic[] = [];
  if (entryFileName.endsWith(".d.ts"))
    diagnostics.push({
      code: "compiler-declaration-entry-file-unsupported",
      fileName: entryFileName,
      message: "The declaration entry file must not use the .d.ts suffix.",
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  const files = [...context.sourceFiles.values()]
    .filter((sourceFile) => context.ownerFor(sourceFile)?.kind === "project")
    .map((sourceFile) => ({ sourceFile, fileName: context.displayFileName(sourceFile) }))
    .sort((left, right) =>
      left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
    );
  const declarations: CollectedAuthoringDeclaration[] = [];
  for (const { sourceFile, fileName } of files) {
    if (fileName.endsWith(".d.ts")) continue;
    const role = roleFor(fileName, entryFileName);
    if (!role) {
      diagnostics.push({
        code: "compiler-declaration-file-role-unsupported",
        fileName,
        message: "Project declaration files must use a recognized declaration suffix.",
        start: 0,
        end: 0,
        line: 1,
        column: 1,
      });
      continue;
    }
    const lowered = lowerAuthoringDeclarationFile(analyzed, sourceFile);
    if (!lowered.ok) {
      diagnostics.push(...lowered.diagnostics);
      continue;
    }
    if (lowered.graph.root.builder !== role.rootBuilder) {
      diagnostics.push(
        diagnosticAt(
          lowered.graph.root.origin,
          "compiler-declaration-root-mismatch",
          "Declaration file root builder does not match its file role.",
        ),
      );
      continue;
    }
    const normalized = normalizeDeclarationGraph(lowered.graph);
    if (!normalized.ok) {
      diagnostics.push(...normalized.diagnostics);
      continue;
    }
    declarations.push({
      role: role.role,
      fileName,
      rootBuilder: role.rootBuilder,
      value: normalized.value,
      sourceMap: normalized.sourceMap,
    });
  }
  if (diagnostics.length !== 0)
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  return { ok: true, declarations, diagnostics: [] };
};
