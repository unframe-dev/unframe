import * as ts from "typescript";

import type { AnalyzedAuthoringProject } from "./typecheck-authoring-project.js";

export type PackageValueProvenance = {
  readonly column: number;
  readonly declarationFile: string;
  readonly end: number;
  readonly exportName: string;
  readonly fileName: string;
  readonly line: number;
  readonly packageIntegrity: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly start: number;
  readonly subpath: string;
  readonly targetFile: string;
};

const compare = (left: PackageValueProvenance, right: PackageValueProvenance) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  (left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0);

export const collectPackageValueProvenance = (
  analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>,
) => {
  const result: Array<PackageValueProvenance> = [];
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
            if (element.isTypeOnly) {
              continue;
            }
            const local = analyzed.value.checker.getSymbolAtLocation(element.name);
            if (!local || !(local.flags & ts.SymbolFlags.Alias)) {
              continue;
            }
            const actual = analyzed.value.checker.getAliasedSymbol(local);
            const exportName = (element.propertyName ?? element.name).text;
            const exported =
              moduleSymbol &&
              analyzed.value.checker
                .getExportsOfModule(moduleSymbol)
                .find((item) => item.name === exportName);
            if (!exported) {
              continue;
            }
            const exportedActual =
              exported.flags & ts.SymbolFlags.Alias
                ? analyzed.value.checker.getAliasedSymbol(exported)
                : exported;
            if (exportedActual !== actual) {
              continue;
            }
            if (!(actual.flags & ts.SymbolFlags.Value) || !actual.declarations?.length) {
              continue;
            }
            const declarationSources = actual.declarations.map((declaration) =>
              declaration.getSourceFile(),
            );
            if (
              !declarationSources.every((declarationSource) => {
                const owner = analyzed.value.context.ownerFor(declarationSource);
                return (
                  owner?.kind === "package" &&
                  owner.package.name === packageExport.packageName &&
                  owner.package.version === packageExport.packageVersion &&
                  owner.package.contentIntegrity === packageExport.packageIntegrity
                );
              })
            ) {
              continue;
            }
            const declarationSource = [...declarationSources].sort((left, right) => {
              const a = analyzed.value.context.relativeFileName(left)!;
              const b = analyzed.value.context.relativeFileName(right)!;
              return a < b ? -1 : a > b ? 1 : 0;
            })[0]!;
            const start = element.name.getStart(sourceFile);
            const position = sourceFile.getLineAndCharacterOfPosition(start);
            result.push({
              ...packageExport,
              column: position.character + 1,
              declarationFile: analyzed.value.context.relativeFileName(declarationSource)!,
              end: element.name.getEnd(),
              exportName,
              fileName: analyzed.value.context.displayFileName(sourceFile),
              line: position.line + 1,
              start,
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
