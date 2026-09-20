import * as ts from "typescript";
import { validateStaticBuilderResult } from "@unframe/unframe-authoring";
import { builderResultShape } from "../normalization/builder-result-shape.js";
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
type Property = {
  readonly key: string;
  readonly origin: DeclarationSourceOrigin;
  readonly value: DeclarationGraphValue;
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
      readonly properties: readonly Property[];
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
export type StaticDeclarationDiagnostic = DeclarationSourceOrigin & {
  readonly code: string;
  readonly message: string;
};
export type LoweredAuthoringDeclaration =
  | {
      readonly ok: true;
      readonly graph: DeclarationGraph;
      readonly diagnostics: [];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly StaticDeclarationDiagnostic[];
    };

const MAX_DEPTH = 128;
const MAX_NODES = 50_000;
const roots = new Set([
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]);
const nested = new Set([
  "stringProp",
  "numberProp",
  "booleanProp",
  "propRef",
  "slot",
  "slotPlaceholder",
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
const builders = new Set([...roots, ...nested]);
const jsxTags = new Map([
  ["Surface", "surface"],
  ["Frame", "frame"],
  ["Text", "text"],
  ["Slot", "slotPlaceholder"],
  ["ComponentInstance", "componentInstance"],
]);
const objectLiteralKind = (value: DeclarationGraphValue) => {
  if (value.kind !== "object") return undefined;
  const kind = value.properties.find((property) => property.key === "kind")?.value;
  return kind?.kind === "literal" && typeof kind.value === "string" ? kind.value : undefined;
};
const isBuilderOrCanonicalKind = (value: DeclarationGraphValue, builder: string, kind: string) =>
  (value.kind === "builder-call" && value.builder === builder) || objectLiteralKind(value) === kind;
const canonicalBuilderProperties = (
  value: DeclarationGraphValue,
): readonly Property[] | undefined => {
  if (value.kind !== "builder-call") return undefined;
  const shape = builderResultShape(value.builder);
  if (!shape) return undefined;
  const properties = new Map<string, Property>();
  const copyObject = (argument: number, rejectedKeys: readonly string[] = []) => {
    const object = value.arguments[argument];
    if (object?.kind !== "object") return false;
    if (object.properties.some((property) => rejectedKeys.includes(property.key))) return false;
    for (const property of object.properties) properties.set(property.key, property);
    return true;
  };
  if (shape.kind === "identity") {
    if (!copyObject(shape.objectArgument)) return undefined;
  } else if (shape.kind === "object") {
    const omittedOptionalInput = value.arguments.length === 0 && shape.objectArgumentOptional;
    if (!omittedOptionalInput && !copyObject(shape.objectArgument, ["kind"])) return undefined;
    properties.set("kind", {
      key: "kind",
      origin: value.origin,
      value: { kind: "literal", origin: value.origin, value: shape.resultKind },
    });
  } else {
    properties.set("kind", {
      key: "kind",
      origin: value.origin,
      value: { kind: "literal", origin: value.origin, value: shape.resultKind },
    });
    for (const field of shape.fields) {
      const argument = value.arguments[field.argument];
      if (!argument) return undefined;
      properties.set(field.key, { key: field.key, origin: argument.origin, value: argument });
    }
    if (
      shape.spreadObjectArgument !== undefined &&
      !copyObject(shape.spreadObjectArgument, ["kind", ...shape.fields.map((field) => field.key)])
    )
      return undefined;
  }
  return [...properties.values()];
};
const invalidStaticValue = Symbol("invalid-static-value");
const materializeStaticValue = (
  value: DeclarationGraphValue,
): unknown | typeof invalidStaticValue => {
  if (value.kind === "literal") return value.value;
  if (value.kind === "array") {
    const result: unknown[] = [];
    for (const child of value.values) {
      const materialized = materializeStaticValue(child);
      if (materialized === invalidStaticValue) return invalidStaticValue;
      result.push(materialized);
    }
    return result;
  }
  const properties = value.kind === "object" ? value.properties : canonicalBuilderProperties(value);
  if (!properties) return invalidStaticValue;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const property of properties) {
    const materialized = materializeStaticValue(property.value);
    if (materialized === invalidStaticValue) return invalidStaticValue;
    Object.defineProperty(result, property.key, {
      value: materialized,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (value.kind === "builder-call" && !validateStaticBuilderResult(value.builder, result))
    return invalidStaticValue;
  return result;
};
const builderProperties = (value: DeclarationGraphValue): readonly Property[] | undefined => {
  if (!graphWithinLimit(value)) return undefined;
  const properties = canonicalBuilderProperties(value);
  return properties && materializeStaticValue(value) !== invalidStaticValue
    ? properties
    : undefined;
};
const compare = (a: StaticDeclarationDiagnostic, b: StaticDeclarationDiagnostic) =>
  (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0) ||
  a.start - b.start ||
  a.end - b.end ||
  a.code.localeCompare(b.code) ||
  a.message.localeCompare(b.message);
const unwrap = (value: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(value) ||
  ts.isAsExpression(value) ||
  ts.isTypeAssertionExpression(value) ||
  ts.isSatisfiesExpression(value) ||
  ts.isNonNullExpression(value)
    ? unwrap(value.expression)
    : value;
const isSdk = (p: PackageValueProvenance | undefined) =>
  p?.packageName === "@unframe/unframe-authoring" && p.subpath === ".";

const createEvaluator = (analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>) => {
  const { checker, context } = analyzed.value;
  const diagnostics: StaticDeclarationDiagnostic[] = [];
  const origins = (node: ts.Node): DeclarationSourceOrigin => {
    const file = node.getSourceFile();
    const start = node.getStart(file);
    const pos = file.getLineAndCharacterOfPosition(start);
    return {
      fileName: context.displayFileName(file),
      start,
      end: node.getEnd(),
      line: pos.line + 1,
      column: pos.character + 1,
    };
  };
  const report = (node: ts.Node, code: string, message: string) =>
    diagnostics.push({ code, message, ...origins(node) });
  const byRange = new Map(
    collectPackageValueProvenance(analyzed).map((p) => [`${p.fileName}:${p.start}:${p.end}`, p]),
  );
  const provenance = new Map<ts.Symbol, PackageValueProvenance>();
  for (const file of context.sourceFiles.values())
    for (const statement of file.statements)
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      )
        for (const item of statement.importClause.namedBindings.elements) {
          const symbol = checker.getSymbolAtLocation(item.name);
          const p = byRange.get(
            `${context.displayFileName(file)}:${item.name.getStart(file)}:${item.name.getEnd()}`,
          );
          if (symbol && p) provenance.set(symbol, p);
        }
  const builderFor = (raw: ts.Expression) => {
    const node = unwrap(raw);
    if (!ts.isIdentifier(node)) return;
    const symbol = checker.getSymbolAtLocation(node);
    const p = symbol ? provenance.get(symbol) : undefined;
    return isSdk(p) && p && builders.has(p.exportName) ? p.exportName : undefined;
  };
  const jsxTagFor = (name: ts.JsxTagNameExpression) => {
    if (!ts.isIdentifier(name)) return undefined;
    const symbol = checker.getSymbolAtLocation(name);
    const p = symbol ? provenance.get(symbol) : undefined;
    return isSdk(p) && p ? jsxTags.get(p.exportName) : undefined;
  };
  const cache = new Map<ts.Symbol, DeclarationGraphValue | undefined>();
  const stack: ts.Symbol[] = [];
  let expressionDepth = 0;
  let evaluate: (raw: ts.Expression) => DeclarationGraphValue | undefined;
  const evaluateIdentifier = (node: ts.Identifier) => {
    const local = ts.isShorthandPropertyAssignment(node.parent)
      ? (checker.getShorthandAssignmentValueSymbol(node.parent) ??
        checker.getSymbolAtLocation(node))
      : checker.getSymbolAtLocation(node);
    if (!local) {
      report(
        node,
        "compiler-static-reference-unresolved",
        "Static declaration reference cannot be resolved.",
      );
      return;
    }
    if (provenance.has(local)) {
      report(
        node,
        "compiler-static-reference-invalid",
        "SDK builders may only appear as direct verified calls.",
      );
      return;
    }
    let symbol = local;
    while (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (cache.has(symbol)) return cache.get(symbol);
    if (stack.includes(symbol)) {
      report(
        node,
        "compiler-static-reference-cycle",
        "Static declaration references must not form a cycle.",
      );
      return;
    }
    if (stack.length >= MAX_DEPTH) {
      report(
        node,
        "compiler-static-expansion-limit",
        `Static declaration references may not exceed ${MAX_DEPTH} levels.`,
      );
      return;
    }
    const declarations = [symbol.valueDeclaration, ...(symbol.declarations ?? [])].filter(
      (item): item is ts.Declaration => item !== undefined,
    );
    const declaration = declarations.find(
      (d): d is ts.VariableDeclaration | ts.ExportAssignment =>
        ts.isVariableDeclaration(d) || ts.isExportAssignment(d),
    );
    const initializer =
      declaration &&
      (ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration.expression);
    if (!initializer) {
      report(
        node,
        "compiler-static-reference-invalid",
        "Only initialized top-level const declarations may be referenced.",
      );
      return;
    }
    stack.push(symbol);
    const result = evaluate(initializer);
    stack.pop();
    cache.set(symbol, result);
    return result;
  };
  const evaluateExpression = (raw: ts.Expression): DeclarationGraphValue | undefined => {
    const node = unwrap(raw);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const diagnosticCount = diagnostics.length;
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const builder = jsxTagFor(opening.tagName);
      if (!builder) {
        report(
          opening.tagName,
          "compiler-static-jsx-tag-invalid",
          "JSX tags must be direct verified Authoring SDK imports.",
        );
        return;
      }
      const properties = new Map<string, Property>();
      const explicit = new Set<string>();
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          const spread = evaluate(attribute.expression);
          const spreadProperties =
            spread && (spread.kind === "object" ? spread.properties : builderProperties(spread));
          if (spreadProperties)
            for (const property of spreadProperties) properties.set(property.key, property);
          else
            report(
              attribute,
              "compiler-static-object-spread-invalid",
              "JSX attribute spread requires a static object value.",
            );
          continue;
        }
        if (!ts.isIdentifier(attribute.name)) {
          report(
            attribute.name,
            "compiler-static-jsx-attribute-invalid",
            "Namespaced JSX attributes are not supported.",
          );
          continue;
        }
        const key = attribute.name.text;
        if (
          key === "key" ||
          key === "ref" ||
          key === "kind" ||
          key === "__proto__" ||
          explicit.has(key)
        ) {
          report(
            attribute.name,
            "compiler-static-jsx-attribute-invalid",
            "JSX attributes must be unique and may not use key, ref, or unsafe names.",
          );
          continue;
        }
        explicit.add(key);
        let value: DeclarationGraphValue | undefined;
        if (!attribute.initializer)
          value = { kind: "literal", origin: origins(attribute), value: true };
        else if (ts.isStringLiteral(attribute.initializer))
          value = {
            kind: "literal",
            origin: origins(attribute.initializer),
            value: attribute.initializer.text,
          };
        else if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression)
          value = evaluate(attribute.initializer.expression);
        else
          report(
            attribute,
            "compiler-static-jsx-attribute-invalid",
            "JSX attributes require static values.",
          );
        if (value) properties.set(key, { key, origin: origins(attribute.name), value });
      }
      const body: DeclarationGraphValue[] = [];
      let hasBodyChild = false;
      if (ts.isJsxElement(node))
        for (const child of node.children) {
          if (ts.isJsxText(child)) {
            const lines = child.text.split(/\r\n?|\n/u);
            let lastNonEmptyLine = lines.length - 1;
            while (lastNonEmptyLine > 0 && !lines[lastNonEmptyLine]!.trim()) lastNonEmptyLine -= 1;
            const text = lines
              .map((line, index) => {
                const withoutTabs = line.replace(/\t/gu, " ");
                const left = index === 0 ? withoutTabs : withoutTabs.replace(/^ +/u, "");
                const trimmed = index === lines.length - 1 ? left : left.replace(/ +$/u, "");
                return trimmed && index !== lastNonEmptyLine ? `${trimmed} ` : trimmed;
              })
              .join("");
            if (text && builder === "text" && !child.text.includes("&")) {
              hasBodyChild = true;
              body.push({
                kind: "literal",
                origin: origins(child),
                value: text,
              });
            } else if (text) {
              hasBodyChild = true;
              report(
                child,
                "compiler-static-jsx-child-invalid",
                "Raw JSX text is supported by Text when it does not contain an entity reference.",
              );
            }
          } else if (ts.isJsxExpression(child)) {
            if (child.expression) {
              const value = evaluate(child.expression);
              if (value) {
                hasBodyChild = true;
                body.push(value);
              }
            }
          } else {
            const value = evaluate(child);
            if (value) {
              hasBodyChild = true;
              body.push(value);
            }
          }
        }
      const attributeChildren = properties.get("children");
      for (const forbidden of ["key", "ref", "kind", "__proto__"])
        if (properties.has(forbidden))
          report(
            opening,
            "compiler-static-jsx-attribute-invalid",
            "JSX attributes may not use key, ref, kind, or unsafe names.",
          );
      if (attributeChildren && hasBodyChild)
        report(
          opening,
          "compiler-static-jsx-child-invalid",
          "JSX body children conflict with the children attribute.",
        );
      const suppliedChildren = attributeChildren
        ? hasBodyChild
          ? body
          : [attributeChildren.value]
        : body;
      properties.delete("children");
      const set = (key: string, value: DeclarationGraphValue) =>
        properties.set(key, { key, origin: origins(opening), value });
      if (builder === "surface") {
        if (properties.has("root"))
          report(
            opening,
            "compiler-static-jsx-attribute-invalid",
            "Surface uses its JSX child as root.",
          );
        if (
          suppliedChildren.length !== 1 ||
          !suppliedChildren[0] ||
          !isBuilderOrCanonicalKind(suppliedChildren[0], "frame", "frame")
        )
          report(
            opening,
            "compiler-static-jsx-child-invalid",
            "Surface requires exactly one Frame child.",
          );
        else set("root", suppliedChildren[0]);
      } else if (builder === "frame") {
        const children: DeclarationGraphValue[] = [];
        let flattened = 0;
        const appendChild = (value: DeclarationGraphValue, depth = 0): boolean => {
          if (depth > MAX_DEPTH || ++flattened > MAX_NODES) return false;
          if (value.kind === "array")
            return value.values.every((child) => appendChild(child, depth + 1));
          children.push(value);
          return true;
        };
        if (!suppliedChildren.every((child) => appendChild(child)))
          report(
            opening,
            "compiler-static-expansion-limit",
            `Frame children may contain at most ${MAX_NODES} expanded values and ${MAX_DEPTH} levels.`,
          );
        const contentKinds = new Map([
          ["frame", "frame"],
          ["text", "text"],
          ["slotPlaceholder", "slot-placeholder"],
          ["componentInstance", "component-instance"],
        ]);
        if (
          children.some(
            (child) =>
              ![...contentKinds].some(([childBuilder, kind]) =>
                isBuilderOrCanonicalKind(child, childBuilder, kind),
              ),
          )
        )
          report(
            opening,
            "compiler-static-jsx-child-invalid",
            "Frame children must be Authoring content elements.",
          );
        else
          set("children", {
            kind: "array",
            origin: origins(opening),
            values: children,
          });
      } else if (builder === "text") {
        const existing = properties.get("value");
        if (existing && (attributeChildren !== undefined || hasBodyChild))
          report(
            opening,
            "compiler-static-jsx-child-invalid",
            "Text accepts either value or children.",
          );
        else if (
          !existing &&
          suppliedChildren.length === 1 &&
          ((suppliedChildren[0]?.kind === "literal" &&
            typeof suppliedChildren[0].value === "string") ||
            (suppliedChildren[0] !== undefined &&
              isBuilderOrCanonicalKind(suppliedChildren[0], "propRef", "prop-ref")))
        )
          set("value", suppliedChildren[0]);
        else if (!existing)
          report(opening, "compiler-static-jsx-child-invalid", "Text requires value or one child.");
        if (
          existing &&
          !(
            (existing.value.kind === "literal" && typeof existing.value.value === "string") ||
            isBuilderOrCanonicalKind(existing.value, "propRef", "prop-ref")
          )
        )
          report(
            opening,
            "compiler-static-jsx-child-invalid",
            "Text value must be a string or Prop reference.",
          );
      } else if (attributeChildren !== undefined || hasBodyChild)
        report(
          opening,
          "compiler-static-jsx-child-invalid",
          "This JSX tag does not accept children.",
        );
      if (diagnostics.length !== diagnosticCount) return;
      return {
        kind: "builder-call",
        builder,
        origin: origins(node),
        arguments: [
          {
            kind: "object",
            origin: origins(opening),
            properties: [...properties.values()],
          },
        ],
      };
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return { kind: "literal", origin: origins(node), value: node.text };
    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      if (Number.isFinite(value)) return { kind: "literal", origin: origins(node), value };
      report(node, "compiler-static-number-invalid", "Numbers must be finite.");
      return;
    }
    if (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    )
      return {
        kind: "literal",
        origin: origins(node),
        value:
          node.kind === ts.SyntaxKind.TrueKeyword
            ? true
            : node.kind === ts.SyntaxKind.FalseKeyword
              ? false
              : null,
      };
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      if (ts.isNumericLiteral(node.operand)) {
        const value = -Number(node.operand.text);
        if (Number.isFinite(value))
          return {
            kind: "literal",
            origin: origins(node),
            value: Object.is(value, -0) ? 0 : value,
          };
      }
      report(
        node,
        "compiler-static-expression-unsupported",
        "Only finite numeric literals may be negated.",
      );
      return;
    }
    if (ts.isIdentifier(node)) return evaluateIdentifier(node);
    if (ts.isArrayLiteralExpression(node)) {
      const diagnosticCount = diagnostics.length;
      const values: DeclarationGraphValue[] = [];
      for (const item of node.elements) {
        if (ts.isOmittedExpression(item))
          report(item, "compiler-static-array-hole", "Arrays must be dense.");
        else if (ts.isSpreadElement(item)) {
          const spread = evaluate(item.expression);
          if (spread?.kind === "array") {
            if (values.length + spread.values.length > MAX_NODES)
              report(
                item,
                "compiler-static-expansion-limit",
                `A static array may contain at most ${MAX_NODES} expanded values.`,
              );
            else values.push(...spread.values);
          } else
            report(
              item,
              "compiler-static-array-spread-invalid",
              "Array spread requires a static array value.",
            );
        } else {
          const value = evaluate(item);
          if (value) values.push(value);
        }
      }
      return diagnostics.length !== diagnosticCount
        ? undefined
        : { kind: "array", origin: origins(node), values };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const diagnosticCount = diagnostics.length;
      const properties = new Map<string, Property>();
      const explicit = new Set<string>();
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) {
          const spread = evaluate(item.expression);
          const spreadProperties =
            spread && (spread.kind === "object" ? spread.properties : builderProperties(spread));
          if (spreadProperties)
            for (const property of spreadProperties) properties.set(property.key, property);
          else
            report(
              item,
              "compiler-static-object-spread-invalid",
              "Object spread requires a static object value.",
            );
          continue;
        }
        let key: string | undefined;
        let init: ts.Expression | undefined;
        let keyNode: ts.Node = item;
        if (ts.isPropertyAssignment(item) && !ts.isComputedPropertyName(item.name)) {
          keyNode = item.name;
          key =
            ts.isIdentifier(item.name) ||
            ts.isStringLiteral(item.name) ||
            ts.isNumericLiteral(item.name)
              ? item.name.text
              : undefined;
          init = item.initializer;
        } else if (ts.isShorthandPropertyAssignment(item)) {
          key = item.name.text;
          keyNode = item.name;
          init = item.name;
        } else {
          report(
            item,
            "compiler-static-object-property-invalid",
            "Objects require static properties, shorthand properties, or spreads.",
          );
          continue;
        }
        if (!key || key === "__proto__") {
          report(
            keyNode,
            "compiler-static-object-property-invalid",
            "Object property names are not allowed.",
          );
          continue;
        }
        if (explicit.has(key)) {
          report(
            keyNode,
            "compiler-static-object-key-duplicate",
            "Explicit object property names must be unique.",
          );
          continue;
        }
        explicit.add(key);
        const value = evaluate(init);
        if (value) properties.set(key, { key, origin: origins(keyNode), value });
      }
      return diagnostics.length !== diagnosticCount
        ? undefined
        : {
            kind: "object",
            origin: origins(node),
            properties: [...properties.values()],
          };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const target = evaluate(node.expression);
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression &&
            (ts.isStringLiteral(node.argumentExpression) ||
              ts.isNumericLiteral(node.argumentExpression))
          ? node.argumentExpression.text
          : undefined;
      if (key !== undefined && target?.kind === "object") {
        const found = target.properties.find((p) => p.key === key);
        if (found) return found.value;
      }
      if (key !== undefined && target?.kind === "builder-call") {
        const found = builderProperties(target)?.find((property) => property.key === key);
        if (found) return found.value;
      }
      if (key !== undefined && target?.kind === "array" && /^\d+$/.test(key)) {
        const found = target.values[Number(key)];
        if (found) return found;
      }
      report(
        node,
        "compiler-static-property-access-invalid",
        "Property access requires an existing static string or number key.",
      );
      return;
    }
    if (ts.isCallExpression(node)) {
      const builder = !node.questionDotToken && builderFor(node.expression);
      if (!builder) {
        report(
          node.expression,
          "compiler-static-builder-invalid",
          "Calls must target a verified declaration builder.",
        );
        return;
      }
      const args: DeclarationGraphValue[] = [];
      const diagnosticCount = diagnostics.length;
      for (const argument of node.arguments)
        if (ts.isSpreadElement(argument))
          report(
            argument,
            "compiler-static-builder-arguments-invalid",
            "Builder arguments cannot use spread syntax.",
          );
        else {
          const value = evaluate(argument);
          if (value) args.push(value);
        }
      if (diagnostics.length !== diagnosticCount) return;
      const kinds =
        builder === "state"
          ? [[], ["object"]]
          : builder === "surfaceState" || builder === "setSurfaceState"
            ? [["string", "string"]]
            : builder === "playTimeline"
              ? [["string", "object"]]
              : ["surfaceInteraction", "timelineCompleted", "mediaCompleted"].includes(builder)
                ? [["string"]]
                : builder === "after"
                  ? [["number"]]
                  : [["object"]];
      const matches = (v: DeclarationGraphValue, k: string) =>
        k === "object" ? v.kind === "object" : v.kind === "literal" && typeof v.value === k;
      if (
        !kinds.some(
          (signature) =>
            signature.length === args.length &&
            signature.every((kind, i) => matches(args[i]!, kind)),
        )
      ) {
        report(
          node,
          "compiler-static-builder-arguments-invalid",
          "Builder arguments do not match the static declaration signature.",
        );
        return;
      }
      return diagnostics.length
        ? undefined
        : {
            kind: "builder-call",
            builder,
            origin: origins(node),
            arguments: args,
          };
    }
    report(
      node,
      "compiler-static-expression-unsupported",
      "Expression is not supported by the static declaration DSL.",
    );
  };
  evaluate = (raw) => {
    if (expressionDepth >= MAX_DEPTH) {
      report(
        unwrap(raw),
        "compiler-static-expansion-limit",
        `Static expressions may not exceed ${MAX_DEPTH} levels.`,
      );
      return;
    }
    expressionDepth += 1;
    try {
      return evaluateExpression(raw);
    } finally {
      expressionDepth -= 1;
    }
  };
  const validateImport = (file: ts.SourceFile, statement: ts.ImportDeclaration) => {
    const clause = statement.importClause;
    if (!clause || statement.attributes || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      report(
        statement,
        "compiler-static-import-invalid",
        "Static modules require explicit imports without attributes or side effects.",
      );
      return;
    }
    if (clause.isTypeOnly) return;
    const resolved = context.resolve(file.fileName, statement.moduleSpecifier.text);
    if (resolved.kind !== "resolved") return;
    const target = context.sourceFiles.get(resolved.fileName);
    const owner = target && context.ownerFor(target);
    if (owner?.kind === "project") {
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        report(
          clause.namedBindings,
          "compiler-static-import-invalid",
          "Project value imports must be named or default imports.",
        );
      return;
    }
    if (
      resolved.packageExport?.packageName !== "@unframe/unframe-authoring" ||
      clause.name ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    ) {
      report(
        statement,
        "compiler-static-import-invalid",
        "Package value imports are limited to verified Authoring SDK builders.",
      );
      return;
    }
    for (const item of clause.namedBindings.elements)
      if (!item.isTypeOnly) {
        const symbol = checker.getSymbolAtLocation(item.name);
        const p = symbol ? provenance.get(symbol) : undefined;
        if (!isSdk(p) || !p || (!builders.has(p.exportName) && !jsxTags.has(p.exportName)))
          report(
            item,
            "compiler-static-import-invalid",
            "Package value imports are limited to verified Authoring SDK builders.",
          );
      }
  };
  const validExport = (file: ts.SourceFile, statement: ts.ExportDeclaration) => {
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
    if (!statement.moduleSpecifier) return true;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return false;
    const resolved = context.resolve(file.fileName, statement.moduleSpecifier.text);
    if (resolved.kind !== "resolved") return false;
    if (
      statement.isTypeOnly ||
      statement.exportClause.elements.every((element) => element.isTypeOnly)
    )
      return true;
    const target = context.sourceFiles.get(resolved.fileName);
    return target !== undefined && context.ownerFor(target)?.kind === "project";
  };
  const validateProject = () => {
    const files = [...context.sourceFiles.values()]
      .filter((f) => context.ownerFor(f)?.kind === "project")
      .sort((a, b) => context.displayFileName(a).localeCompare(context.displayFileName(b)));
    for (const file of files)
      if (!file.isDeclarationFile)
        for (const statement of file.statements) {
          if (ts.isImportDeclaration(statement)) validateImport(file, statement);
          else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
            continue;
          else if (ts.isVariableStatement(statement)) {
            if (!(statement.declarationList.flags & ts.NodeFlags.Const))
              report(
                statement,
                "compiler-static-top-level-unsupported",
                "Static modules may declare top-level const bindings only.",
              );
            else
              for (const declaration of statement.declarationList.declarations)
                if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
                  report(
                    declaration,
                    "compiler-static-top-level-unsupported",
                    "Static const declarations require an identifier and initializer.",
                  );
                else {
                  const value = evaluate(declaration.initializer);
                  if (value && !graphWithinLimit(value))
                    report(
                      declaration.initializer,
                      "compiler-static-expansion-limit",
                      `A declaration graph may contain at most ${MAX_NODES} nodes and ${MAX_DEPTH} levels.`,
                    );
                }
          } else if (ts.isExportAssignment(statement) && !statement.isExportEquals)
            evaluate(statement.expression);
          else if (ts.isExportDeclaration(statement) && validExport(file, statement)) continue;
          else
            report(
              statement,
              "compiler-static-top-level-unsupported",
              "Static modules may contain imports, type declarations, const declarations, and exports only.",
            );
        }
    return diagnostics.sort(compare);
  };
  return { evaluate, validateProject, diagnostics, origins };
};

export const validateStaticAuthoringProject = (
  analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>,
) => createEvaluator(analyzed).validateProject();
const graphWithinLimit = (value: DeclarationGraphValue) => {
  const measures = new WeakMap<object, { readonly nodes: number; readonly levels: number }>();
  const measure = (v: DeclarationGraphValue) => {
    const cached = measures.get(v);
    if (cached !== undefined) return cached;
    let nodes = 1;
    let levels = 1;
    const children =
      v.kind === "array"
        ? v.values
        : v.kind === "object"
          ? v.properties.map((property) => property.value)
          : v.kind === "builder-call"
            ? v.arguments
            : [];
    for (const child of children) {
      const childMeasure = measure(child);
      nodes += childMeasure.nodes;
      levels = Math.max(levels, childMeasure.levels + 1);
      if (nodes > MAX_NODES || levels > MAX_DEPTH + 1)
        return { nodes: MAX_NODES + 1, levels: MAX_DEPTH + 2 };
    }
    const result = { nodes, levels };
    measures.set(v, result);
    return result;
  };
  const result = measure(value);
  return result.nodes <= MAX_NODES && result.levels <= MAX_DEPTH + 1;
};
const hasNestedRootBuilder = (value: DeclarationGraphValue, isRoot = true): boolean => {
  if (!isRoot && value.kind === "builder-call" && roots.has(value.builder)) return true;
  return value.kind === "array"
    ? value.values.some((child) => hasNestedRootBuilder(child, false))
    : value.kind === "object"
      ? value.properties.some((property) => hasNestedRootBuilder(property.value, false))
      : value.kind === "builder-call"
        ? value.arguments.some((argument) => hasNestedRootBuilder(argument, false))
        : false;
};
export const lowerAuthoringDeclarationFile = (
  analyzed: Extract<AnalyzedAuthoringProject, { ok: true }>,
  sourceFile = analyzed.value.entrySourceFile,
  validateProject = true,
): LoweredAuthoringDeclaration => {
  const evaluator = createEvaluator(analyzed);
  if (validateProject && evaluator.validateProject().length)
    return { ok: false, diagnostics: evaluator.diagnostics.sort(compare) };
  const defaults = sourceFile.statements.filter(
    (s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals,
  );
  if (defaults.length !== 1) {
    const node = defaults[1] ?? sourceFile;
    return {
      ok: false,
      diagnostics: [
        {
          code: "compiler-static-root-invalid",
          message: "Declaration files must contain exactly one default export.",
          ...evaluator.origins(node),
        },
      ],
    };
  }
  const value = evaluator.evaluate(defaults[0]!.expression);
  if (value && (value.kind !== "builder-call" || !roots.has(value.builder)))
    evaluator.diagnostics.push({
      code: "compiler-static-root-invalid",
      message: "Default export must resolve to a verified root builder call.",
      ...(value.kind === "builder-call"
        ? value.origin
        : evaluator.origins(defaults[0]!.expression)),
    });
  else if (value && !graphWithinLimit(value))
    evaluator.diagnostics.push({
      code: "compiler-static-expansion-limit",
      message: `A declaration graph may contain at most ${MAX_NODES} nodes and ${MAX_DEPTH} levels.`,
      ...value.origin,
    });
  else if (value && hasNestedRootBuilder(value))
    evaluator.diagnostics.push({
      code: "compiler-static-builder-invalid",
      message: "Root declaration builders may not be nested as values.",
      ...value.origin,
    });
  if (!value || value.kind !== "builder-call" || evaluator.diagnostics.length)
    return { ok: false, diagnostics: evaluator.diagnostics.sort(compare) };
  return {
    ok: true,
    graph: {
      fileName: analyzed.value.context.displayFileName(sourceFile),
      root: value,
    },
    diagnostics: [],
  };
};
