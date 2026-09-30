import type { DeclarationSourceOrigin } from "../lowering/lower-authoring-declaration.js";
import {
  normalizeDeclarationGraph,
  type DeclarationSourceMapEntry,
  type NormalizedDeclarationValue,
} from "../normalization/normalize-declaration-graph.js";
import type { AnalyzedAuthoringProject } from "../resolution/typecheck-authoring-project.js";
import {
  extractReactComponents,
  type ExtractedReactComponent,
} from "./extract-react-components.js";
import {
  lowerAuthoringDeclarationFile,
  validateStaticAuthoringProject,
} from "../lowering/lower-authoring-declaration.js";

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
  readonly column: number;
  readonly end: number;
  readonly fileName: string;
  readonly line: number;
  readonly message: string;
  readonly start: number;
};

export type CollectedAuthoringDeclaration = {
  readonly fileName: string;
  readonly role: AuthoringDeclarationRole;
  readonly rootBuilder: AuthoringDeclarationRootBuilder;
  readonly sourceMap: ReadonlyArray<DeclarationSourceMapEntry>;
  readonly value: NormalizedDeclarationValue;
};

export type CollectedAuthoringDeclarations =
  | {
      readonly declarations: ReadonlyArray<CollectedAuthoringDeclaration>;
      readonly diagnostics: readonly [];
      readonly ok: true;
      readonly reactComponents: ReadonlyArray<ExtractedReactComponent>;
    }
  | {
      readonly diagnostics: ReadonlyArray<DeclarationCollectionDiagnostic>;
      readonly ok: false;
    };

export type CollectedAuthoringDeclarationsSuccess = Extract<
  CollectedAuthoringDeclarations,
  { readonly ok: true }
>;

const roleFor = (fileName: string, entryFileName: string) => {
  if (fileName === entryFileName) {
    return { role: "presentation", rootBuilder: "definePresentation" } as const;
  }
  if (fileName.endsWith(".unframe.ts")) {
    return { role: "theme", rootBuilder: "defineTheme" } as const;
  }
  if (fileName.endsWith(".manifest.ts")) {
    return {
      role: "component-manifest",
      rootBuilder: "defineComponentManifest",
    } as const;
  }
  if (fileName.endsWith(".structure.tsx")) {
    return {
      role: "component-structure",
      rootBuilder: "defineComponentStructure",
    } as const;
  }
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
  const diagnostics: Array<DeclarationCollectionDiagnostic> = [];
  const extracted = extractReactComponents(analyzed);
  if (!extracted.ok) {
    diagnostics.push(...extracted.diagnostics);
  }
  const reactFacades = new Map(
    extracted.ok
      ? extracted.components.map(
          (component) =>
            [
              component.fileName,
              {
                exportName: component.exportName,
                id: component.metadata.id,
                version: component.metadata.version,
              },
            ] as const,
        )
      : [],
  );
  const renderOnlyFiles = new Set(
    extracted.ok
      ? extracted.components.flatMap((component) => component.renderer.localDependencies)
      : [],
  );
  diagnostics.push(...validateStaticAuthoringProject(analyzed, reactFacades, renderOnlyFiles));
  if (entryFileName.endsWith(".d.ts")) {
    diagnostics.push({
      code: "compiler-declaration-entry-file-unsupported",
      column: 1,
      end: 0,
      fileName: entryFileName,
      line: 1,
      message: "The declaration entry file must not use the .d.ts suffix.",
      start: 0,
    });
  }
  if (diagnostics.length !== 0) {
    return { diagnostics: diagnostics.sort(compareDiagnostics), ok: false };
  }
  const files = [...context.sourceFiles.values()]
    .filter((sourceFile) => context.ownerFor(sourceFile)?.kind === "project")
    .map((sourceFile) => ({
      fileName: context.displayFileName(sourceFile),
      sourceFile,
    }))
    .sort((left, right) =>
      left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
    );
  const declarations: Array<CollectedAuthoringDeclaration> = [];
  for (const { fileName, sourceFile } of files) {
    if (fileName.endsWith(".d.ts")) {
      continue;
    }
    const role = roleFor(fileName, entryFileName);
    if (!role) {
      continue;
    }
    const lowered = lowerAuthoringDeclarationFile(analyzed, sourceFile, false, reactFacades);
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
      fileName,
      role: role.role,
      rootBuilder: role.rootBuilder,
      sourceMap: normalized.sourceMap,
      value: normalized.value,
    });
  }
  if (diagnostics.length !== 0) {
    return { diagnostics: diagnostics.sort(compareDiagnostics), ok: false };
  }
  return {
    declarations,
    diagnostics: [],
    ok: true,
    reactComponents: extracted.ok ? extracted.components : [],
  };
};
