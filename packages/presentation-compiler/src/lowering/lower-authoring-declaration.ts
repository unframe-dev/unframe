import * as ts from "typescript";

import {
  collectPackageValueProvenance,
  type PackageValueProvenance,
} from "../resolution/symbol-provenance.js";
import type { AnalyzedAuthoringProject } from "../resolution/typecheck-authoring-project.js";

export type DeclarationSourceOrigin = {
  readonly fileName: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type DeclarationGraphValue =
  | {
      readonly kind: "literal";
      readonly origin: DeclarationSourceOrigin;
      readonly value: null | string | number | boolean;
    }
  | {
      readonly kind: "array";
      readonly origin: DeclarationSourceOrigin;
      readonly values: readonly DeclarationGraphValue[];
    }
  | {
      readonly kind: "object";
      readonly origin: DeclarationSourceOrigin;
      readonly properties: readonly {
        readonly key: string;
        readonly origin: DeclarationSourceOrigin;
        readonly value: DeclarationGraphValue;
      }[];
    }
  | {
      readonly kind: "builder-call";
      readonly builder: string;
      readonly origin: DeclarationSourceOrigin;
      readonly arguments: readonly DeclarationGraphValue[];
    };

export type DeclarationGraph = {
  readonly fileName: string;
  readonly root: Extract<DeclarationGraphValue, { readonly kind: "builder-call" }>;
};

export type StaticDeclarationDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type LoweredAuthoringDeclaration =
  | { readonly ok: true; readonly graph: DeclarationGraph; readonly diagnostics: [] }
  | { readonly ok: false; readonly diagnostics: readonly StaticDeclarationDiagnostic[] };

const rootBuilders = new Set([
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]);

const nestedBuilders = new Set([
  "stringProp",
  "numberProp",
  "booleanProp",
  "slot",
  "part",
  "variant",
  "state",
  "action",
  "output",
  "surfaceState",
  "setSurfaceState",
  "playTimeline",
  "surfaceInteraction",
  "timelineCompleted",
  "mediaCompleted",
  "after",
  "invokeComponentAction",
  "componentOutput",
  "cue",
  "tokenRef",
  "namedStyleRef",
  "assetRef",
  "spatial",
  "frame",
  "text",
  "surface",
  "semanticOverride",
  "componentInstance",
  "detach",
]);

type BuilderArgumentKind = "object" | "string" | "number";
type BuilderSignature = readonly (readonly BuilderArgumentKind[])[];

const rootSignature: BuilderSignature = [["object"]];
const nestedSignatures = new Map<string, BuilderSignature>([
  ["state", [[], ["object"]]],
  ["surfaceState", [["string", "string"]]],
  ["setSurfaceState", [["string", "string"]]],
  ["playTimeline", [["string", "object"]]],
  ["surfaceInteraction", [["string"]]],
  ["timelineCompleted", [["string"]]],
  ["mediaCompleted", [["string"]]],
  ["after", [["number"]]],
  ...[...nestedBuilders]
    .filter(
      (builder) =>
        ![
          "state",
          "surfaceState",
          "setSurfaceState",
          "playTimeline",
          "surfaceInteraction",
          "timelineCompleted",
          "mediaCompleted",
          "after",
        ].includes(builder),
    )
    .map((builder) => [builder, [["object"]]] as const),
]);

const compareDiagnostics = (
  left: StaticDeclarationDiagnostic,
  right: StaticDeclarationDiagnostic,
) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const displayDiagnostic = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
  displayFileName: string,
): StaticDeclarationDiagnostic => {
  const start = node.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    code,
    fileName: displayFileName,
    message,
    start,
    end: node.getEnd(),
    line: position.line + 1,
    column: position.character + 1,
  };
};

const isPresentationBuilder = (provenance: PackageValueProvenance | undefined) =>
  provenance?.packageName === "@unframe/presentation" && provenance.subpath === ".";

const argumentMatches = (argument: ts.Expression, kind: BuilderArgumentKind) =>
  (kind === "object" && ts.isObjectLiteralExpression(argument)) ||
  (kind === "string" && ts.isStringLiteral(argument)) ||
  (kind === "number" &&
    (ts.isNumericLiteral(argument) ||
      (ts.isPrefixUnaryExpression(argument) &&
        argument.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(argument.operand))));

export const lowerAuthoringDeclarationFile = (
  analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>,
  sourceFile = analyzed.value.entrySourceFile,
): LoweredAuthoringDeclaration => {
  const displayFileName = analyzed.value.context.displayFileName(sourceFile);
  const provenanceByRange = new Map(
    collectPackageValueProvenance(analyzed)
      .filter((item) => item.fileName === displayFileName)
      .map((item) => [`${item.start}:${item.end}`, item]),
  );
  const provenanceByBinding = new Map<ts.Symbol, PackageValueProvenance>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    )
      continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const provenance = provenanceByRange.get(
        `${element.name.getStart(sourceFile)}:${element.name.getEnd()}`,
      );
      const binding = analyzed.value.checker.getSymbolAtLocation(element.name);
      if (provenance && binding) provenanceByBinding.set(binding, provenance);
    }
  }
  const diagnostics: StaticDeclarationDiagnostic[] = [];
  const originFor = (node: ts.Node): DeclarationSourceOrigin => ({
    fileName: displayFileName,
    start: node.getStart(sourceFile),
    end: node.getEnd(),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    column: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character + 1,
  });
  const report = (node: ts.Node, code: string, message: string) =>
    diagnostics.push(displayDiagnostic(sourceFile, node, code, message, displayFileName));
  const provenanceFor = (node: ts.Identifier) => {
    const binding = analyzed.value.checker.getSymbolAtLocation(node);
    return binding ? provenanceByBinding.get(binding) : undefined;
  };
  const verifiedBuilder = (node: ts.Expression, allowed: ReadonlySet<string>) => {
    if (!ts.isIdentifier(node)) return undefined;
    const provenance = provenanceFor(node);
    return isPresentationBuilder(provenance) && provenance && allowed.has(provenance.exportName)
      ? provenance.exportName
      : undefined;
  };
  const validateArguments = (call: ts.CallExpression, signatures: BuilderSignature) => {
    const signature = signatures.find((candidate) => candidate.length === call.arguments.length);
    if (!signature) {
      report(
        call,
        "compiler-static-builder-arguments-invalid",
        "Builder arguments do not match the static declaration signature.",
      );
      return false;
    }
    let valid = true;
    for (const [index, kind] of signature.entries()) {
      const argument = call.arguments[index]!;
      if (ts.isSpreadElement(argument) || !argumentMatches(argument, kind)) {
        report(
          argument,
          "compiler-static-builder-arguments-invalid",
          "Builder arguments do not match the static declaration signature.",
        );
        valid = false;
      }
    }
    return valid;
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@unframe/presentation" ||
      statement.attributes ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      statement.importClause.name ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      report(
        statement,
        "compiler-static-import-invalid",
        "Declaration files may import verified named builders from @unframe/presentation only.",
      );
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      const provenance = provenanceByRange.get(
        `${element.name.getStart(sourceFile)}:${element.name.getEnd()}`,
      );
      if (
        element.isTypeOnly ||
        !isPresentationBuilder(provenance) ||
        !provenance ||
        (!rootBuilders.has(provenance.exportName) && !nestedBuilders.has(provenance.exportName))
      )
        report(
          element,
          "compiler-static-import-invalid",
          "Declaration files may import verified named builders from @unframe/presentation only.",
        );
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  let defaultExport: ts.ExportAssignment | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && !defaultExport) {
      defaultExport = statement;
      continue;
    }
    report(
      statement,
      "compiler-static-top-level-unsupported",
      "Declaration files may contain imports and one default export only.",
    );
  }
  if (!defaultExport)
    report(
      sourceFile,
      "compiler-static-root-invalid",
      "Declaration files must default-export a recognized root builder call.",
    );
  if (diagnostics.length) return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const lowerValue = (node: ts.Expression): DeclarationGraphValue | undefined => {
    if (ts.isStringLiteral(node))
      return { kind: "literal", origin: originFor(node), value: node.text };
    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      if (Number.isFinite(value)) return { kind: "literal", origin: originFor(node), value };
      report(node, "compiler-static-number-invalid", "Numbers must be finite.");
      return undefined;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword)
      return { kind: "literal", origin: originFor(node), value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword)
      return { kind: "literal", origin: originFor(node), value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword)
      return { kind: "literal", origin: originFor(node), value: null };
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      if (!ts.isNumericLiteral(node.operand)) {
        report(
          node,
          "compiler-static-expression-unsupported",
          "Only numeric literals may be negated.",
        );
        return undefined;
      }
      const value = -Number(node.operand.text);
      if (Number.isFinite(value))
        return {
          kind: "literal",
          origin: originFor(node),
          value: Object.is(value, -0) ? 0 : value,
        };
      report(node, "compiler-static-number-invalid", "Numbers must be finite.");
      return undefined;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values: DeclarationGraphValue[] = [];
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) {
          report(element, "compiler-static-array-hole", "Arrays must be dense.");
          continue;
        }
        if (ts.isSpreadElement(element)) {
          report(
            element,
            "compiler-static-expression-unsupported",
            "Spread expressions are not allowed.",
          );
          continue;
        }
        const value = lowerValue(element);
        if (value !== undefined) values.push(value);
      }
      return diagnostics.length ? undefined : { kind: "array", origin: originFor(node), values };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const properties: Extract<DeclarationGraphValue, { kind: "object" }>["properties"][number][] =
        [];
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
          report(
            property,
            "compiler-static-object-property-invalid",
            "Objects require explicit non-computed property assignments.",
          );
          continue;
        }
        const key =
          ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
            ? property.name.text
            : undefined;
        if (key === undefined || key === "__proto__") {
          report(
            property.name,
            "compiler-static-object-property-invalid",
            "Object property names are not allowed.",
          );
          continue;
        }
        if (keys.has(key)) {
          report(
            property.name,
            "compiler-static-object-key-duplicate",
            "Object property names must be unique.",
          );
          continue;
        }
        keys.add(key);
        const value = lowerValue(property.initializer);
        if (value !== undefined) properties.push({ key, origin: originFor(property.name), value });
      }
      return diagnostics.length
        ? undefined
        : { kind: "object", origin: originFor(node), properties };
    }
    if (ts.isCallExpression(node)) {
      if (node.questionDotToken) {
        report(
          node,
          "compiler-static-builder-invalid",
          "Calls must target a verified nested declaration builder.",
        );
        return undefined;
      }
      const builder = verifiedBuilder(node.expression, nestedBuilders);
      if (!builder) {
        report(
          node.expression,
          "compiler-static-builder-invalid",
          "Calls must target a verified nested declaration builder.",
        );
        return undefined;
      }
      const signature = nestedSignatures.get(builder)!;
      if (!validateArguments(node, signature)) return undefined;
      const arguments_: DeclarationGraphValue[] = [];
      for (const argument of node.arguments) {
        if (ts.isSpreadElement(argument)) {
          report(
            argument,
            "compiler-static-expression-unsupported",
            "Spread expressions are not allowed.",
          );
          continue;
        }
        const value = lowerValue(argument);
        if (value !== undefined) arguments_.push(value);
      }
      return diagnostics.length
        ? undefined
        : { kind: "builder-call", builder, origin: originFor(node), arguments: arguments_ };
    }
    report(
      node,
      "compiler-static-expression-unsupported",
      "Expression is not supported by the static declaration DSL.",
    );
    return undefined;
  };

  const rootExpression = defaultExport!.expression;
  if (!ts.isCallExpression(rootExpression)) {
    report(
      rootExpression,
      "compiler-static-root-invalid",
      "Default export must be a direct root builder call.",
    );
  } else {
    if (rootExpression.questionDotToken) {
      report(
        rootExpression,
        "compiler-static-root-invalid",
        "Default export must be a direct root builder call.",
      );
      return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
    }
    const builder = verifiedBuilder(rootExpression.expression, rootBuilders);
    if (!builder)
      report(
        rootExpression.expression,
        "compiler-static-root-invalid",
        "Default export must call a verified root builder.",
      );
    else {
      if (!validateArguments(rootExpression, rootSignature))
        return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
      const arguments_: DeclarationGraphValue[] = [];
      for (const argument of rootExpression.arguments) {
        if (ts.isSpreadElement(argument))
          report(
            argument,
            "compiler-static-expression-unsupported",
            "Spread expressions are not allowed.",
          );
        else {
          const value = lowerValue(argument);
          if (value !== undefined) arguments_.push(value);
        }
      }
      if (!diagnostics.length)
        return {
          ok: true,
          graph: {
            fileName: displayFileName,
            root: {
              kind: "builder-call",
              builder,
              origin: originFor(rootExpression),
              arguments: arguments_,
            },
          },
          diagnostics: [],
        };
    }
  }
  return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
};
