import type {
  DeclarationGraph,
  DeclarationSourceOrigin,
} from "../lowering/lower-authoring-declaration.js";
import { builderResultShape } from "./builder-result-shape.js";

export type NormalizedDeclarationValue =
  | null
  | boolean
  | number
  | string
  | readonly NormalizedDeclarationValue[]
  | { readonly [key: string]: NormalizedDeclarationValue };
type Json = NormalizedDeclarationValue;
type PathSegment = string | number;

export type DeclarationSourceMapEntry = {
  readonly path: readonly PathSegment[];
  readonly origin: DeclarationSourceOrigin;
  readonly keyOrigin?: DeclarationSourceOrigin;
};

export type NormalizationDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type NormalizedDeclarationGraph =
  | {
      readonly ok: true;
      readonly rootBuilder: string;
      readonly rootOrigin: DeclarationSourceOrigin;
      readonly value: Json;
      readonly sourceMap: readonly DeclarationSourceMapEntry[];
      readonly diagnostics: [];
    }
  | { readonly ok: false; readonly diagnostics: readonly NormalizationDiagnostic[] };

const diagnosticCode = "compiler-normalization-invalid-graph";
const rootBuilders = new Set([
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]);
const fallbackOrigin: DeclarationSourceOrigin = {
  fileName: "",
  start: 0,
  end: 0,
  line: 1,
  column: 1,
};

const compareDiagnostics = (left: NormalizationDiagnostic, right: NormalizationDiagnostic) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOrigin = (value: unknown): value is DeclarationSourceOrigin =>
  isRecord(value) &&
  typeof value.fileName === "string" &&
  typeof value.start === "number" &&
  typeof value.end === "number" &&
  typeof value.line === "number" &&
  typeof value.column === "number" &&
  Number.isFinite(value.start) &&
  Number.isFinite(value.end) &&
  Number.isFinite(value.line) &&
  Number.isFinite(value.column);

const isNode = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isOrigin(value.origin);
type ObjectNode = Record<string, unknown> & { readonly properties: readonly unknown[] };
type BuilderNode = Record<string, unknown> & {
  readonly builder: string;
  readonly arguments: readonly unknown[];
};

const isObjectNode = (value: unknown): value is ObjectNode =>
  isNode(value) && value.kind === "object" && Array.isArray(value.properties);
const isBuilderNode = (value: unknown): value is BuilderNode =>
  isNode(value) &&
  value.kind === "builder-call" &&
  typeof value.builder === "string" &&
  Array.isArray(value.arguments);
const isLiteralNode = (value: unknown): value is Record<string, unknown> =>
  isNode(value) && value.kind === "literal";
const isStringLiteral = (value: unknown) => isLiteralNode(value) && typeof value.value === "string";
const isFiniteNumberLiteral = (value: unknown) =>
  isLiteralNode(value) && typeof value.value === "number" && Number.isFinite(value.value);
const createObject = (): Record<string, Json> => Object.create(null) as Record<string, Json>;

export const normalizeDeclarationGraph = (graph: DeclarationGraph): NormalizedDeclarationGraph => {
  const diagnostics: NormalizationDiagnostic[] = [];
  const entries = new Map<string, DeclarationSourceMapEntry>();
  const fail = (origin: DeclarationSourceOrigin, message: string) => {
    diagnostics.push({ code: diagnosticCode, ...origin, message });
  };
  const addSource = (
    path: readonly PathSegment[],
    origin: DeclarationSourceOrigin,
    keyOrigin?: DeclarationSourceOrigin,
  ) => {
    const key = JSON.stringify(path);
    if (entries.has(key)) fail(origin, "Source map paths must be unique.");
    else
      entries.set(
        key,
        keyOrigin ? { path: [...path], origin, keyOrigin } : { path: [...path], origin },
      );
  };
  const requireArguments = (node: Record<string, unknown>, valid: boolean) => {
    if (valid) return true;
    fail(node.origin as DeclarationSourceOrigin, "Builder arguments are invalid.");
    return false;
  };

  const copyObject = (
    node: unknown,
    path: readonly PathSegment[],
    materialize: (
      node: unknown,
      path: readonly PathSegment[],
      keyOrigin?: DeclarationSourceOrigin,
    ) => Json | undefined,
    target = createObject(),
    rejectedKeys: ReadonlySet<string> = new Set(),
  ): Record<string, Json> | undefined => {
    if (!isObjectNode(node)) {
      fail(
        isNode(node) ? (node.origin as DeclarationSourceOrigin) : fallbackOrigin,
        "Object value is invalid.",
      );
      return undefined;
    }
    const keys = new Set<string>();
    for (const property of node.properties) {
      if (!isRecord(property) || typeof property.key !== "string" || !isOrigin(property.origin)) {
        fail(node.origin as DeclarationSourceOrigin, "Object property is invalid.");
        continue;
      }
      if (property.key === "__proto__" || keys.has(property.key)) {
        fail(property.origin, "Object keys must be unique and safe.");
        continue;
      }
      keys.add(property.key);
      if (rejectedKeys.has(property.key)) {
        fail(property.origin, "Builder fields conflict with input.");
        continue;
      }
      const value = materialize(property.value, [...path, property.key], property.origin);
      if (value !== undefined)
        Object.defineProperty(target, property.key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    return diagnostics.length === 0 ? target : undefined;
  };

  const materialize = (
    node: unknown,
    path: readonly PathSegment[],
    keyOrigin?: DeclarationSourceOrigin,
  ): Json | undefined => {
    if (!isNode(node) || typeof node.kind !== "string") {
      fail(keyOrigin ?? fallbackOrigin, "Declaration graph value is invalid.");
      return undefined;
    }
    const origin = node.origin as DeclarationSourceOrigin;
    addSource(path, origin, keyOrigin);
    if (node.kind === "literal") {
      if (node.value !== null && !["string", "boolean", "number"].includes(typeof node.value)) {
        fail(origin, "Literal values must be JSON primitives.");
        return undefined;
      }
      if (typeof node.value === "number" && !Number.isFinite(node.value)) {
        fail(origin, "Numbers must be finite.");
        return undefined;
      }
      return node.value as Json;
    }
    if (node.kind === "array") {
      if (!Array.isArray(node.values)) {
        fail(origin, "Array values are invalid.");
        return undefined;
      }
      const result: Json[] = [];
      for (const [index, child] of node.values.entries()) {
        const value = materialize(child, [...path, index]);
        if (value !== undefined) result.push(value);
      }
      return diagnostics.length === 0 ? result : undefined;
    }
    if (node.kind === "object") return copyObject(node, path, materialize);
    if (!isBuilderNode(node)) {
      fail(origin, "Declaration graph value kind is unknown.");
      return undefined;
    }
    const generated = (
      target: Record<string, Json>,
      key: string,
      value: Json,
      fieldOrigin: DeclarationSourceOrigin,
    ) => {
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      addSource([...path, key], fieldOrigin);
    };
    const arguments_ = node.arguments;
    const shape = builderResultShape(node.builder as string);
    if (!shape || rootBuilders.has(node.builder as string)) {
      fail(origin, "Unknown declaration builder.");
      return undefined;
    }
    if (shape.kind === "object") {
      if (
        !requireArguments(
          node,
          shape.objectArgumentOptional
            ? arguments_.length <= 1 && (arguments_.length === 0 || isObjectNode(arguments_[0]))
            : arguments_.length === 1 && isObjectNode(arguments_[0]),
        )
      )
        return undefined;
      const result =
        arguments_.length === 0
          ? createObject()
          : copyObject(arguments_[0], path, materialize, createObject(), new Set(["kind"]));
      if (!result) return undefined;
      generated(result, "kind", shape.resultKind, origin);
      return result;
    }
    if (shape.kind === "identity") {
      if (!requireArguments(node, arguments_.length === 1 && isObjectNode(arguments_[0])))
        return undefined;
      return copyObject(arguments_[0], path, materialize);
    }
    const requiredArguments =
      Math.max(...shape.fields.map((field) => field.argument), shape.spreadObjectArgument ?? -1) +
      1;
    if (
      !requireArguments(
        node,
        arguments_.length === requiredArguments &&
          shape.fields.every((field) =>
            field.valueType === "string"
              ? isStringLiteral(arguments_[field.argument])
              : isFiniteNumberLiteral(arguments_[field.argument]),
          ) &&
          (shape.spreadObjectArgument === undefined ||
            isObjectNode(arguments_[shape.spreadObjectArgument])),
      )
    )
      return undefined;
    const result = createObject();
    generated(result, "kind", shape.resultKind, origin);
    for (const field of shape.fields) {
      const value = materialize(arguments_[field.argument], [...path, field.key]);
      if (value === undefined) return undefined;
      Object.defineProperty(result, field.key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return shape.spreadObjectArgument === undefined
      ? diagnostics.length === 0
        ? result
        : undefined
      : copyObject(
          arguments_[shape.spreadObjectArgument],
          path,
          materialize,
          result,
          new Set(["kind", ...shape.fields.map((field) => field.key)]),
        );
  };

  const root = isRecord(graph as unknown)
    ? (graph as unknown as Record<string, unknown>).root
    : undefined;
  if (!isBuilderNode(root) || !rootBuilders.has(root.builder as string)) {
    fail(
      isNode(root) ? (root.origin as DeclarationSourceOrigin) : fallbackOrigin,
      "Root builder is invalid.",
    );
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  }
  if (!requireArguments(root, root.arguments.length === 1 && isObjectNode(root.arguments[0])))
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  const value = materialize(root.arguments[0], []);
  if (diagnostics.length !== 0 || value === undefined)
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  return {
    ok: true,
    rootBuilder: root.builder as string,
    rootOrigin: root.origin as DeclarationSourceOrigin,
    value,
    sourceMap: [...entries.values()],
    diagnostics: [],
  };
};
