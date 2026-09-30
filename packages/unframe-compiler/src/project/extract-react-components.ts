import * as ts from "typescript";
import {
  buildOpaqueComponentManifest,
  validateStaticComponentMetadata,
  type StaticComponentMetadata,
} from "@unframe/unframe-authoring";
import {
  evaluateStaticAuthoringExpression,
  type DeclarationGraphValue,
  type DeclarationSourceOrigin,
} from "../lowering/lower-authoring-declaration.js";
import {
  normalizeDeclarationGraph,
  type DeclarationSourceMapEntry,
} from "../normalization/normalize-declaration-graph.js";
import type { AnalyzedAuthoringProject } from "../resolution/typecheck-authoring-project.js";

type Analyzed = Extract<AnalyzedAuthoringProject, { readonly ok: true }>;
type Diagnostic = DeclarationSourceOrigin & { readonly code: string; readonly message: string };

export type ExtractedReactComponent = {
  readonly exportName: string;
  readonly fileName: string;
  readonly manifest: ReturnType<typeof buildOpaqueComponentManifest>;
  readonly metadata: StaticComponentMetadata;
  readonly renderer: {
    readonly entrySource: string;
    readonly helperOrigins?: ReadonlyArray<DeclarationSourceOrigin>;
    readonly localDependencies: ReadonlyArray<string>;
    readonly packageImports: ReadonlyArray<string>;
    readonly renderOrigin?: DeclarationSourceOrigin;
  };
  readonly sourceMap: ReadonlyArray<DeclarationSourceMapEntry>;
};

export type ExtractedReactComponents =
  | {
      readonly components: ReadonlyArray<ExtractedReactComponent>;
      readonly diagnostics: readonly [];
      readonly ok: true;
    }
  | { readonly diagnostics: ReadonlyArray<Diagnostic>; readonly ok: false };

const staticFields = new Set(["id", "version", "props", "surface", "semantics"]);
const finiteFields = new Set(["interactions", "initialState", "states", "actions", "outputs"]);
const isExported = (statement: ts.VariableStatement) =>
  statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;

const sourceOrigin = (analyzed: Analyzed, node: ts.Node): DeclarationSourceOrigin => {
  const sourceFile = node.getSourceFile();
  const start = node.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    column: position.character + 1,
    end: node.getEnd(),
    fileName: analyzed.value.context.displayFileName(sourceFile),
    line: position.line + 1,
    start,
  };
};

const diagnostic = (
  analyzed: Analyzed,
  node: ts.Node,
  code: string,
  message: string,
): Diagnostic => ({
  code,
  message,
  ...sourceOrigin(analyzed, node),
});

const compareDiagnostics = (left: Diagnostic, right: Diagnostic) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0);

const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined => {
  if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
    return;
  }
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : undefined;
};

const isVerifiedComponentBuilder = (analyzed: Analyzed, expression: ts.LeftHandSideExpression) => {
  if (!ts.isIdentifier(expression)) {
    return false;
  }
  const symbol = analyzed.value.checker.getSymbolAtLocation(expression);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || !ts.isImportSpecifier(declaration)) {
    return false;
  }
  const importDeclaration = declaration.parent.parent.parent;
  return (
    ts.isImportDeclaration(importDeclaration) &&
    ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
    importDeclaration.moduleSpecifier.text === "@unframe/unframe-authoring" &&
    (declaration.propertyName?.text ?? declaration.name.text) === "defineComponent"
  );
};

const staticGraph = (
  analyzed: Analyzed,
  fields: ReadonlyMap<string, ts.PropertyAssignment>,
  root: ts.Node,
) => {
  const properties: Array<{
    key: string;
    origin: DeclarationSourceOrigin;
    value: DeclarationGraphValue;
  }> = [];
  const diagnostics: Array<Diagnostic> = [];
  for (const field of [...staticFields, ...finiteFields]) {
    const property = fields.get(field);
    if (!property) {
      continue;
    }
    const evaluated = evaluateStaticAuthoringExpression(analyzed, property.initializer);
    if (!evaluated.ok) {
      diagnostics.push(...evaluated.diagnostics);
    } else {
      properties.push({
        key: field,
        origin: sourceOrigin(analyzed, property.name),
        value: evaluated.value,
      });
    }
  }
  if (diagnostics.length) {
    return { diagnostics, ok: false as const };
  }
  const origin = sourceOrigin(analyzed, root);
  const normalized = normalizeDeclarationGraph({
    fileName: origin.fileName,
    root: {
      arguments: [{ kind: "object", origin, properties }],
      builder: "defineTheme",
      kind: "builder-call",
      origin,
    },
  });
  return normalized.ok
    ? { ok: true as const, sourceMap: normalized.sourceMap, value: normalized.value }
    : { diagnostics: normalized.diagnostics, ok: false as const };
};

const topLevelDeclaration = (node: ts.Node): ts.Statement | undefined => {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return ts.isStatement(current) ? current : undefined;
};

const normalizedStaticValue = (
  analyzed: Analyzed,
  initializer: ts.Expression,
): unknown | undefined => {
  const evaluated = evaluateStaticAuthoringExpression(analyzed, initializer);
  if (!evaluated.ok) {
    return;
  }
  const origin = sourceOrigin(analyzed, initializer);
  const normalized = normalizeDeclarationGraph({
    fileName: origin.fileName,
    root: {
      arguments: [
        { kind: "object", origin, properties: [{ key: "value", origin, value: evaluated.value }] },
      ],
      builder: "defineTheme",
      kind: "builder-call",
      origin,
    },
  });
  return normalized.ok ? (normalized.value as { value: unknown }).value : undefined;
};

const renderEntry = (
  analyzed: Analyzed,
  sourceFile: ts.SourceFile,
  render: ts.ArrowFunction,
  componentStatement: ts.VariableStatement,
):
  | {
      entrySource: string;
      helperOrigins: Array<DeclarationSourceOrigin>;
      localDependencies: Array<string>;
      packageImports: Array<string>;
      renderOrigin: DeclarationSourceOrigin;
    }
  | Diagnostic => {
  const { checker, context } = analyzed.value;
  const statements = new Set<ts.Statement>();
  const staticValues = new Map<string, unknown>();
  const imports = new Map<ts.ImportDeclaration, Set<string>>();
  const visited = new Set<ts.Symbol>();
  const failures: Array<Diagnostic> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        const alias =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        if (!visited.has(alias)) {
          const declaration = symbol.declarations?.[0] ?? alias.valueDeclaration;
          const top = declaration && topLevelDeclaration(declaration);
          if (
            top === componentStatement &&
            declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.parent.parent === componentStatement
          ) {
            failures.push(
              diagnostic(
                analyzed,
                node,
                "compiler-react-render-contract-reference",
                "Render must not reference the public component contract.",
              ),
            );
            return;
          }
          if (top && top.getSourceFile() === sourceFile && top !== componentStatement) {
            visited.add(alias);
            if (ts.isImportDeclaration(top)) {
              const clause = top.importClause;
              if (
                !clause?.isTypeOnly &&
                (!ts.isImportSpecifier(declaration) || !declaration.isTypeOnly)
              ) {
                const names = imports.get(top) ?? new Set<string>();
                names.add(node.text);
                imports.set(top, names);
              }
            } else if (ts.isFunctionDeclaration(top)) {
              statements.add(top);
              ts.forEachChild(top, visit);
            } else if (ts.isVariableStatement(top)) {
              const declaration = top.declarationList.declarations[0];
              if (
                top.declarationList.declarations.length !== 1 ||
                !declaration ||
                !ts.isIdentifier(declaration.name) ||
                !declaration.initializer
              ) {
                return;
              }
              if (ts.isArrowFunction(declaration.initializer)) {
                statements.add(top);
                ts.forEachChild(declaration.initializer, visit);
              } else {
                const value = normalizedStaticValue(analyzed, declaration.initializer);
                if (value === undefined) {
                  failures.push(
                    diagnostic(
                      analyzed,
                      declaration,
                      "compiler-react-render-reference-invalid",
                      "Render data must be statically resolvable.",
                    ),
                  );
                } else {
                  staticValues.set(declaration.name.text, value);
                }
              }
            } else {
              failures.push(
                diagnostic(
                  analyzed,
                  node,
                  "compiler-react-render-reference-invalid",
                  "Render may reference only imports, static data, and top-level render helpers.",
                ),
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(render);
  if (failures.length) {
    return failures[0]!;
  }
  const importLines: Array<string> = [];
  const localDependencies: Array<string> = [];
  const packageImports: Array<string> = [];
  for (const declaration of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(declaration) ||
      declaration.importClause ||
      !ts.isStringLiteralLike(declaration.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = declaration.moduleSpecifier.text;
    if (specifier === "@unframe/unframe-authoring") {
      return diagnostic(
        analyzed,
        declaration,
        "compiler-react-render-contract-reference",
        "Render must not import the public contract runtime.",
      );
    }
    const resolved = context.resolve(sourceFile.fileName, specifier);
    if (resolved.kind !== "resolved") {
      return diagnostic(
        analyzed,
        declaration,
        "compiler-react-render-import-unresolved",
        "Render side-effect import must resolve from the project snapshot.",
      );
    }
    if (specifier.startsWith(".")) {
      localDependencies.push(context.displayFileName(context.sourceFiles.get(resolved.fileName)!));
    } else {
      packageImports.push(specifier);
    }
    importLines.push(declaration.getText(sourceFile));
  }
  for (const [declaration, names] of imports) {
    const specifier = (declaration.moduleSpecifier as ts.StringLiteral).text;
    if (specifier === "@unframe/unframe-authoring") {
      return diagnostic(
        analyzed,
        declaration,
        "compiler-react-render-contract-reference",
        "Render must not import the public contract runtime.",
      );
    }
    const resolved = context.resolve(sourceFile.fileName, specifier);
    if (resolved.kind !== "resolved") {
      return diagnostic(
        analyzed,
        declaration,
        "compiler-react-render-import-unresolved",
        "Render import must resolve from the locked project.",
      );
    }
    const clause = declaration.importClause;
    if (!clause) {
      continue;
    }
    const selected: Array<string> = [];
    const runtimeNames = new Set(names);
    if (specifier.startsWith(".")) {
      const target = context.sourceFiles.get(resolved.fileName);
      if (!target) {
        return diagnostic(
          analyzed,
          declaration,
          "compiler-react-render-import-unresolved",
          "Render local import must resolve to a source module.",
        );
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) {
          if (!runtimeNames.has(item.name.text)) {
            continue;
          }
          const symbol = checker.getSymbolAtLocation(item.name);
          const targetSymbol =
            symbol &&
            (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
          const targetDeclaration = targetSymbol?.valueDeclaration;
          if (
            targetDeclaration &&
            ts.isVariableDeclaration(targetDeclaration) &&
            targetDeclaration.initializer
          ) {
            const value = normalizedStaticValue(analyzed, targetDeclaration.initializer);
            if (value !== undefined) {
              staticValues.set(item.name.text, value);
              runtimeNames.delete(item.name.text);
            }
          }
        }
      }
      if (
        runtimeNames.size &&
        (target === analyzed.value.entrySourceFile ||
          context.displayFileName(target).endsWith(".unframe.ts") ||
          context.displayFileName(target).endsWith(".component.tsx") ||
          context.displayFileName(target).endsWith(".manifest.ts") ||
          context.displayFileName(target).endsWith(".structure.tsx"))
      ) {
        return diagnostic(
          analyzed,
          declaration,
          "compiler-react-render-contract-reference",
          "Render must not import a public contract module.",
        );
      }
      if (runtimeNames.size) {
        localDependencies.push(context.displayFileName(target));
      }
    } else if (runtimeNames.size) {
      packageImports.push(specifier);
    }
    if (clause.name && runtimeNames.has(clause.name.text)) {
      selected.push(clause.name.text);
    }
    const named: Array<string> = [];
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) {
        if (runtimeNames.has(item.name.text))
          named.push(
            `${item.propertyName ? `${item.propertyName.text} as ` : ""}${item.name.text}`,
          );
      }
    }
    if (named.length) {
      selected.push(`{ ${named.join(", ")} }`);
    }
    if (
      clause.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings) &&
      runtimeNames.has(clause.namedBindings.name.text)
    ) {
      selected.push(`* as ${clause.namedBindings.name.text}`);
    }
    if (selected.length) {
      importLines.push(`import ${selected.join(", ")} from ${JSON.stringify(specifier)};`);
    }
  }
  const helperLines = [...statements]
    .sort((a, b) => a.getStart() - b.getStart())
    .map((statement) => statement.getText(sourceFile));
  const staticLines = [...staticValues]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`);
  const byName = new Map(
    [...context.sourceFiles.values()].map((file) => [context.displayFileName(file), file] as const),
  );
  let usesJsx = false;
  const dynamicModuleUse = (node: ts.Node): Diagnostic | undefined => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      usesJsx = true;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      return diagnostic(
        analyzed,
        node,
        "compiler-react-render-dynamic-import-invalid",
        "Render dependencies must use static imports.",
      );
    }
    for (const child of node.getChildren()) {
      const failure = dynamicModuleUse(child);
      if (failure) {
        return failure;
      }
    }
    return;
  };
  for (const node of [render, ...statements]) {
    const failure = dynamicModuleUse(node);
    if (failure) {
      return failure;
    }
  }
  const pending = [...localDependencies];
  const seen = new Set<string>();
  while (pending.length) {
    const fileName = pending.pop()!;
    if (seen.has(fileName)) {
      continue;
    }
    seen.add(fileName);
    const dependencyFile = byName.get(fileName);
    if (!dependencyFile || dependencyFile.isDeclarationFile) {
      continue;
    }
    const dynamicFailure = dynamicModuleUse(dependencyFile);
    if (dynamicFailure) {
      return dynamicFailure;
    }
    for (const statement of dependencyFile.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
        continue;
      }
      if (
        !statement.moduleSpecifier ||
        !ts.isStringLiteralLike(statement.moduleSpecifier) ||
        (ts.isImportDeclaration(statement)
          ? statement.importClause?.isTypeOnly
          : statement.isTypeOnly)
      ) {
        continue;
      }
      const dependency = statement.moduleSpecifier.text;
      if (dependency === "@unframe/unframe-authoring") {
        return diagnostic(
          analyzed,
          statement,
          "compiler-react-render-contract-reference",
          "Render helpers must not import the public contract runtime.",
        );
      }
      const resolved = context.resolve(dependencyFile.fileName, dependency);
      if (resolved.kind !== "resolved") {
        return diagnostic(
          analyzed,
          statement,
          "compiler-react-render-import-unresolved",
          "Render helper import must resolve from the project snapshot.",
        );
      }
      if (dependency.startsWith(".")) {
        const target = context.sourceFiles.get(resolved.fileName);
        if (!target) {
          return diagnostic(
            analyzed,
            statement,
            "compiler-react-render-import-unresolved",
            "Render helper import is unavailable.",
          );
        }
        const targetName = context.displayFileName(target);
        if (
          target === analyzed.value.entrySourceFile ||
          targetName.endsWith(".component.tsx") ||
          targetName.endsWith(".manifest.ts") ||
          targetName.endsWith(".structure.tsx") ||
          targetName.endsWith(".unframe.ts")
        ) {
          return diagnostic(
            analyzed,
            statement,
            "compiler-react-render-contract-reference",
            "Render helpers must not import public contract modules.",
          );
        }
        pending.push(targetName);
      } else {
        packageImports.push(dependency);
      }
    }
  }
  if (usesJsx) {
    const jsxRuntime = context.resolve(sourceFile.fileName, "react/jsx-runtime");
    if (jsxRuntime.kind !== "resolved") {
      return diagnostic(
        analyzed,
        render,
        "compiler-react-jsx-runtime-unresolved",
        "React JSX runtime must be a locked runtime dependency.",
      );
    }
    packageImports.push("react/jsx-runtime");
  }
  return {
    entrySource: [
      ...importLines,
      ...staticLines,
      ...helperLines,
      `export const render = ${render.getText(sourceFile)};`,
    ].join("\n"),
    helperOrigins: [...statements]
      .sort((a, b) => a.getStart() - b.getStart())
      .map((statement) => sourceOrigin(analyzed, statement)),
    localDependencies: [...seen].sort(),
    packageImports: [...new Set(packageImports)].sort(),
    renderOrigin: sourceOrigin(analyzed, render),
  };
};

export const extractReactComponents = (analyzed: Analyzed): ExtractedReactComponents => {
  const components: Array<ExtractedReactComponent> = [];
  const diagnostics: Array<Diagnostic> = [];
  const files = [...analyzed.value.context.sourceFiles.values()].filter((file) => {
    const context = analyzed.value.context;
    const owner = context.ownerFor(file);
    if (!context.displayFileName(file).endsWith(".component.tsx")) {
      return false;
    }
    if (owner?.kind === "project") {
      return true;
    }
    if (owner?.kind !== "package") {
      return false;
    }
    const path = context.relativeFileName(file);
    return (
      analyzed.value.context.projectRootFiles.some((root) => {
        const source = context.sourceFiles.get(root);
        return source?.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteralLike(statement.moduleSpecifier) &&
            (() => {
              const resolved = context.resolve(root, statement.moduleSpecifier.text);
              return resolved.kind === "resolved" && resolved.fileName === file.fileName;
            })(),
        );
      }) &&
      owner.package.exports.some((entry) => entry.runtimeImport === path || entry.types === path)
    );
  });
  for (const file of files) {
    const found: Array<{
      name: string;
      object: ts.ObjectLiteralExpression;
      statement: ts.VariableStatement;
    }> = [];
    for (const statement of file.statements) {
      if (
        ts.isImportDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)
      ) {
        continue;
      }
      if (ts.isFunctionDeclaration(statement)) {
        if (
          !statement.name ||
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          diagnostics.push(
            diagnostic(
              analyzed,
              statement,
              "compiler-react-top-level-invalid",
              "Render helper functions must be named and private.",
            ),
          );
        }
        continue;
      }
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const) ||
        statement.declarationList.declarations.length !== 1
      ) {
        diagnostics.push(
          diagnostic(
            analyzed,
            statement,
            "compiler-react-top-level-invalid",
            "Component files may contain imports, types, const data, render helpers, and one component export.",
          ),
        );
        continue;
      }
      const declaration = statement.declarationList.declarations[0]!;
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        diagnostics.push(
          diagnostic(
            analyzed,
            declaration,
            "compiler-react-top-level-invalid",
            "Top-level const requires one initialized identifier.",
          ),
        );
        continue;
      }
      const initializer = declaration.initializer;
      if (
        ts.isCallExpression(initializer) &&
        isVerifiedComponentBuilder(analyzed, initializer.expression)
      ) {
        const argument = initializer.arguments[0];
        if (
          !isExported(statement) ||
          initializer.arguments.length !== 1 ||
          !argument ||
          !ts.isObjectLiteralExpression(argument)
        ) {
          diagnostics.push(
            diagnostic(
              analyzed,
              initializer,
              "compiler-react-component-shape-invalid",
              "defineComponent requires a named export and direct object literal.",
            ),
          );
          continue;
        }
        found.push({ name: declaration.name.text, object: argument, statement });
      } else if (
        isExported(statement) ||
        (!ts.isArrowFunction(initializer) &&
          !evaluateStaticAuthoringExpression(analyzed, initializer).ok)
      ) {
        diagnostics.push(
          diagnostic(
            analyzed,
            declaration,
            "compiler-react-top-level-invalid",
            "Top-level values must be static data or arrow render helpers.",
          ),
        );
      }
    }
    if (found.length !== 1) {
      diagnostics.push(
        diagnostic(
          analyzed,
          file,
          "compiler-react-component-count-invalid",
          "Component files require exactly one named defineComponent export.",
        ),
      );
      continue;
    }
    const component = found[0]!;
    const fields = new Map<string, ts.PropertyAssignment>();
    for (const property of component.object.properties) {
      const key = propertyName(property);
      if (
        !key ||
        !ts.isPropertyAssignment(property) ||
        fields.has(key) ||
        (!staticFields.has(key) && !finiteFields.has(key) && key !== "render")
      ) {
        diagnostics.push(
          diagnostic(
            analyzed,
            property,
            "compiler-react-component-field-invalid",
            "Component fields must be unique, direct, and supported.",
          ),
        );
      } else {
        fields.set(key, property);
      }
    }
    if (
      !([...staticFields].every((key) => fields.has(key)) && fields.has("render")) ||
      ([...finiteFields].some((key) => fields.has(key)) &&
        ![...finiteFields].every((key) => fields.has(key)))
    ) {
      diagnostics.push(
        diagnostic(
          analyzed,
          component.object,
          "compiler-react-component-field-invalid",
          "Component requires all static fields and inline render.",
        ),
      );
      continue;
    }
    const render = fields.get("render")!.initializer;
    if (!ts.isArrowFunction(render)) {
      diagnostics.push(
        diagnostic(
          analyzed,
          render,
          "compiler-react-render-invalid",
          "Render must be an inline arrow function.",
        ),
      );
      continue;
    }
    const normalized = staticGraph(analyzed, fields, component.object);
    if (!normalized.ok) {
      diagnostics.push(...normalized.diagnostics);
      continue;
    }
    let metadata: StaticComponentMetadata;
    try {
      metadata = validateStaticComponentMetadata(normalized.value);
    } catch {
      diagnostics.push(
        diagnostic(
          analyzed,
          component.object,
          "compiler-react-contract-invalid",
          "Component public contract failed static validation.",
        ),
      );
      continue;
    }
    const renderer = renderEntry(analyzed, file, render, component.statement);
    if ("code" in renderer) {
      diagnostics.push(renderer);
      continue;
    }
    const fileName = analyzed.value.context.displayFileName(file);
    components.push({
      exportName: component.name,
      fileName,
      manifest: buildOpaqueComponentManifest(metadata, `${fileName}#render`),
      metadata,
      renderer,
      sourceMap: normalized.sourceMap,
    });
  }
  return diagnostics.length
    ? { diagnostics: diagnostics.sort(compareDiagnostics), ok: false }
    : {
        components: components.sort((a, b) =>
          a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
        ),
        diagnostics: [],
        ok: true,
      };
};
