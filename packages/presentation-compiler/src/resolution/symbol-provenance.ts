import * as ts from "typescript";

import type { AnalyzedAuthoringProject } from "./typecheck-authoring-project.js";

export type PackageValueProvenance = {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageIntegrity: string;
  readonly subpath: string;
  readonly exportName: string;
  readonly targetFile: string;
  readonly declarationFile: string;
  readonly fileName: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

const compare = (left: PackageValueProvenance, right: PackageValueProvenance) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  (left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0);

export const collectPackageValueProvenance = (
  analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>,
) => {
  const result: PackageValueProvenance[] = [];
  for (const sourceFile of analyzed.value.context.sourceFiles.values()) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const resolved = analyzed.value.context.resolve(
          sourceFile.fileName,
          node.moduleSpecifier.text,
        );
        if (resolved.kind === "resolved" && resolved.packageExport) {
          const packageExport = resolved.packageExport;
          const moduleSymbol = analyzed.value.checker.getSymbolAtLocation(node.moduleSpecifier);
          for (const element of node.importClause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
            const local = analyzed.value.checker.getSymbolAtLocation(element.name);
            if (!local || !(local.flags & ts.SymbolFlags.Alias)) continue;
            const actual = analyzed.value.checker.getAliasedSymbol(local);
            const exportName = (element.propertyName ?? element.name).text;
            const exported =
              moduleSymbol &&
              analyzed.value.checker
                .getExportsOfModule(moduleSymbol)
                .find((item) => item.name === exportName);
            if (!exported) continue;
            const exportedActual =
              exported.flags & ts.SymbolFlags.Alias
                ? analyzed.value.checker.getAliasedSymbol(exported)
                : exported;
            if (exportedActual !== actual) continue;
            if (!(actual.flags & ts.SymbolFlags.Value) || !actual.declarations?.length) continue;
            const declarationSources = actual.declarations.map((declaration) =>
              declaration.getSourceFile(),
            );
            if (
              !declarationSources.every((declarationSource) => {
                const owner = analyzed.value.context.ownerFor(declarationSource);
                return (
                  owner?.kind === "package" &&
                  owner.package.packageName === packageExport.packageName &&
                  owner.package.packageVersion === packageExport.packageVersion &&
                  owner.package.packageIntegrity === packageExport.packageIntegrity
                );
              })
            )
              continue;
            const declarationSource = [...declarationSources].sort((left, right) => {
              const a = analyzed.value.context.relativeFileName(left)!;
              const b = analyzed.value.context.relativeFileName(right)!;
              return a < b ? -1 : a > b ? 1 : 0;
            })[0]!;
            const start = element.name.getStart(sourceFile);
            const position = sourceFile.getLineAndCharacterOfPosition(start);
            result.push({
              ...packageExport,
              exportName,
              declarationFile: analyzed.value.context.relativeFileName(declarationSource)!,
              fileName: analyzed.value.context.displayFileName(sourceFile),
              start,
              end: element.name.getEnd(),
              line: position.line + 1,
              column: position.character + 1,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }
  return result.sort(compare);
};
