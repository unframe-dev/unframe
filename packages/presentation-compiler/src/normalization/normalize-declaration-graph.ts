import type {
  DeclarationGraph,
  DeclarationSourceOrigin,
} from "../lowering/lower-authoring-declaration.js";

type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };
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
const objectBuilders = new Map<string, string>([
  ["stringProp", "string"],
  ["numberProp", "number"],
  ["booleanProp", "boolean"],
  ["slot", "slot"],
  ["part", "part"],
  ["variant", "variant"],
  ["state", "state"],
  ["action", "action"],
  ["output", "output"],
  ["invokeComponentAction", "component.action"],
  ["componentOutput", "component.output"],
  ["tokenRef", "token-ref"],
  ["namedStyleRef", "named-style-ref"],
  ["assetRef", "asset-ref"],
  ["spatial", "spatial"],
  ["frame", "frame"],
  ["text", "text"],
  ["surface", "surface"],
  ["semanticOverride", "semantic-override"],
  ["componentInstance", "component-instance"],
  ["detach", "detach"],
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
    const objectKind = objectBuilders.get(node.builder as string);
    if (objectKind) {
      const state = node.builder === "state";
      if (
        !requireArguments(
          node,
          state
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
      generated(result, "kind", objectKind, origin);
      return result;
    }
    if (node.builder === "cue") {
      if (!requireArguments(node, arguments_.length === 1 && isObjectNode(arguments_[0])))
        return undefined;
      return copyObject(arguments_[0], path, materialize);
    }
    if (node.builder === "surfaceState" || node.builder === "setSurfaceState") {
      if (
        !requireArguments(
          node,
          arguments_.length === 2 &&
            isStringLiteral(arguments_[0]) &&
            isStringLiteral(arguments_[1]),
        )
      )
        return undefined;
      const result = createObject();
      generated(result, "kind", node.builder as string, origin);
      const surface = materialize(arguments_[0], [...path, "surfaceId"]);
      const state = materialize(arguments_[1], [...path, "stateId"]);
      if (surface === undefined || state === undefined) return undefined;
      Object.defineProperty(result, "surfaceId", {
        value: surface,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(result, "stateId", {
        value: state,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return diagnostics.length === 0 ? result : undefined;
    }
    if (node.builder === "playTimeline") {
      if (
        !requireArguments(
          node,
          arguments_.length === 2 && isStringLiteral(arguments_[0]) && isObjectNode(arguments_[1]),
        )
      )
        return undefined;
      const result = createObject();
      generated(result, "kind", "playTimeline", origin);
      const timeline = materialize(arguments_[0], [...path, "timelineId"]);
      if (timeline === undefined) return undefined;
      Object.defineProperty(result, "timelineId", {
        value: timeline,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return copyObject(arguments_[1], path, materialize, result, new Set(["kind", "timelineId"]));
    }
    const stringField = new Map<string, string>([
      ["surfaceInteraction", "interactionId"],
      ["timelineCompleted", "timelineId"],
      ["mediaCompleted", "surfaceId"],
    ]).get(node.builder as string);
    if (stringField) {
      if (!requireArguments(node, arguments_.length === 1 && isStringLiteral(arguments_[0])))
        return undefined;
      const result = createObject();
      generated(result, "kind", node.builder as string, origin);
      const value = materialize(arguments_[0], [...path, stringField]);
      if (value === undefined) return undefined;
      Object.defineProperty(result, stringField, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return diagnostics.length === 0 ? result : undefined;
    }
    if (node.builder === "after") {
      if (!requireArguments(node, arguments_.length === 1 && isFiniteNumberLiteral(arguments_[0])))
        return undefined;
      const result = createObject();
      generated(result, "kind", "timer", origin);
      const value = materialize(arguments_[0], [...path, "afterMilliseconds"]);
      if (value === undefined) return undefined;
      Object.defineProperty(result, "afterMilliseconds", {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return diagnostics.length === 0 ? result : undefined;
    }
    fail(origin, "Unknown declaration builder.");
    return undefined;
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
