import * as ts from "typescript";

import type { PairedAuthoringDeclarationCatalog } from "../project/pair-authoring-declarations.js";
import { parseAuthoringSource } from "../syntax/parse-authoring-source.js";

type Scalar = string | number | boolean;
export type ReactSceneTransform = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
};
export type ReactSceneEditCommand =
  | {
      readonly instanceId: string;
      readonly kind: "setProp";
      readonly propId: string;
      readonly value: Scalar;
    }
  | {
      readonly instanceId: string;
      readonly kind: "setTransform";
      readonly transform: ReactSceneTransform;
    };
export type ReactSceneEditDiagnostic = {
  readonly code: string;
  readonly instanceId?: string;
  readonly message: string;
  readonly propId?: string;
};
export type EditableReactSceneInstance = {
  readonly componentId: string;
  readonly instanceId: string;
  readonly props: Readonly<
    Record<
      string,
      {
        readonly editable: boolean;
        readonly kind: "string" | "number" | "boolean";
        readonly reason?: string;
        readonly value: Scalar;
      }
    >
  >;
  readonly reason?: string;
  readonly transform: ReactSceneTransform;
  readonly transformEditable: boolean;
  readonly version: number;
};
type Result<T> =
  | { readonly diagnostics: readonly []; readonly ok: true; readonly value: T }
  | { readonly diagnostics: ReadonlyArray<ReactSceneEditDiagnostic>; readonly ok: false };
type RecordValue = Record<string, unknown>;
type SceneSyntax = {
  readonly node: ts.ObjectLiteralExpression;
  readonly props: ts.Expression | undefined;
  readonly transform: ts.Expression | undefined;
};
type SceneItem = { readonly syntax?: SceneSyntax; readonly value: RecordValue };

const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (
  code: string,
  message: string,
  instanceId?: string,
  propId?: string,
): Result<never> => ({
  diagnostics: [
    {
      code,
      message,
      ...(instanceId === undefined ? {} : { instanceId }),
      ...(propId === undefined ? {} : { propId }),
    },
  ],
  ok: false,
});
const property = (node: ts.ObjectLiteralExpression, name: string) => {
  for (const item of [...node.properties].reverse()) {
    if (ts.isSpreadAssignment(item)) {
      return undefined;
    }
    if (
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name
    ) {
      return item;
    }
  }
  return undefined;
};
const unwrap = (expression: ts.Expression): ts.Expression =>
  ts.isAsExpression(expression) ||
  ts.isSatisfiesExpression(expression) ||
  ts.isParenthesizedExpression(expression)
    ? unwrap(expression.expression)
    : expression;
const object = (expression: ts.Expression | undefined) =>
  expression && ts.isObjectLiteralExpression(unwrap(expression))
    ? (unwrap(expression) as ts.ObjectLiteralExpression)
    : undefined;
const literal = (expression: ts.Expression, expected: Scalar): boolean => {
  const node = unwrap(expression);
  if (typeof expected === "string") {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text === expected
      : false;
  }
  if (typeof expected === "boolean") {
    return expected
      ? node.kind === ts.SyntaxKind.TrueKeyword
      : node.kind === ts.SyntaxKind.FalseKeyword;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text) === expected;
  }
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand) &&
    -Number(node.operand.text) === expected
  );
};
const vector = (
  expression: ts.Expression | undefined,
  values: unknown,
): Array<ts.Expression> | undefined => {
  if (!expression || !Array.isArray(values)) {
    return;
  }
  const node = unwrap(expression);
  if (!ts.isArrayLiteralExpression(node) || node.elements.length !== values.length) {
    return;
  }
  const elements: Array<ts.Expression> = [];
  for (const [index, item] of node.elements.entries()) {
    if (
      !ts.isExpression(item) ||
      typeof values[index] !== "number" ||
      !literal(item, values[index])
    ) {
      return;
    }
    elements.push(item);
  }
  return elements;
};
const transformElements = (syntax: SceneSyntax | undefined, value: unknown) => {
  if (!syntax || !record(value)) {
    return;
  }
  const node = object(syntax.transform);
  if (!node || node.properties.some(ts.isSpreadAssignment)) {
    return;
  }
  const result: Record<"position" | "rotation" | "scale", Array<ts.Expression>> = {
    position: [],
    rotation: [],
    scale: [],
  };
  for (const key of ["position", "rotation", "scale"] as const) {
    const elements = vector(property(node, key)?.initializer, value[key]);
    if (!elements || elements.length !== (key === "rotation" ? 4 : 3)) {
      return;
    }
    result[key] = elements;
  }
  return result;
};
const sourceScene = (
  sourceText: string,
  fileName: string,
): Array<ts.ObjectLiteralExpression> | undefined => {
  const parsed = parseAuthoringSource({ fileName, sourceText });
  if (!parsed.ok) {
    return;
  }
  const file = parsed.value;
  const assignment = file.statements.find(
    (item): item is ts.ExportAssignment => ts.isExportAssignment(item) && !item.isExportEquals,
  );
  if (!assignment) {
    return;
  }
  const call = unwrap(assignment.expression);
  if (
    !ts.isCallExpression(call) ||
    call.arguments.length !== 1 ||
    !ts.isIdentifier(call.expression)
  ) {
    return;
  }
  const root = object(call.arguments[0]);
  if (!root) {
    return;
  }
  const scene = property(root, "scene")?.initializer;
  if (!scene || !ts.isArrayLiteralExpression(unwrap(scene))) {
    return;
  }
  return (unwrap(scene) as ts.ArrayLiteralExpression).elements
    .map((item) => object(item))
    .filter((item): item is ts.ObjectLiteralExpression => item !== undefined);
};
const sceneItems = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<Array<SceneItem>> => {
  const declaration = collected.presentation;
  if (!declaration || !record(declaration.value) || !Array.isArray(declaration.value.scene)) {
    return fail("compiler-edit-scene-invalid", "A validated React scene is required.");
  }
  const nodes = sourceScene(sourceText, declaration.fileName);
  if (!nodes || nodes.length !== declaration.value.scene.length) {
    return fail(
      "compiler-edit-scene-unsupported",
      "Scene items must be direct object literals in the current source.",
    );
  }
  const result: Array<SceneItem> = [];
  for (const [index, value] of declaration.value.scene.entries()) {
    if (!record(value)) {
      return fail("compiler-edit-scene-invalid", "Scene item is invalid.");
    }
    const node = nodes[index]!;
    const source = declaration.sourceMap.find(
      (entry) => entry.path.length === 2 && entry.path[0] === "scene" && entry.path[1] === index,
    );
    if (
      !source ||
      source.origin.fileName !== declaration.fileName ||
      source.origin.start !== node.getStart() ||
      source.origin.end !== node.getEnd() ||
      !literal(property(node, "id")?.initializer ?? node, value.id as Scalar)
    ) {
      return fail(
        "compiler-edit-scene-unsupported",
        "Scene item cannot be uniquely matched to a direct source declaration.",
      );
    }
    result.push({
      syntax: {
        node,
        props: property(node, "props")?.initializer,
        transform: property(node, "transform")?.initializer,
      },
      value,
    });
  }
  return { diagnostics: [], ok: true, value: result };
};
const propKind = (kind: unknown): kind is "string" | "number" | "boolean" =>
  kind === "string" || kind === "number" || kind === "boolean";
const propExpression = (item: SceneItem, propId: string, value: Scalar) => {
  const props = object(item.syntax?.props);
  if (!props || props.properties.some(ts.isSpreadAssignment)) {
    return;
  }
  const field = property(props, propId);
  return field && literal(field.initializer, value) ? field.initializer : undefined;
};
const inspect = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<{ instances: Array<EditableReactSceneInstance>; items: Array<SceneItem> }> => {
  const scene = sceneItems(collected, sourceText);
  if (!scene.ok) {
    return scene;
  }
  const instances: Array<EditableReactSceneInstance> = [];
  for (const item of scene.value) {
    const { component, id, props, transform } = item.value;
    if (
      typeof id !== "string" ||
      !record(component) ||
      typeof component.id !== "string" ||
      typeof component.version !== "number" ||
      !record(props) ||
      !record(transform)
    ) {
      return fail("compiler-edit-scene-invalid", "Scene item is invalid.");
    }
    const descriptor = collected.components.find(
      (candidate) =>
        "metadata" in candidate &&
        candidate.metadata.id === component.id &&
        candidate.metadata.version === component.version,
    );
    if (!descriptor || !("metadata" in descriptor)) {
      return fail("compiler-edit-component-missing", "React component metadata is missing.", id);
    }
    const fields: Record<string, EditableReactSceneInstance["props"][string]> = {};
    for (const [propId, definition] of Object.entries(descriptor.metadata.props)) {
      if (!propKind(definition.kind)) {
        continue;
      }
      const value = props[propId] ?? ("default" in definition ? definition.default : undefined);
      if (typeof value !== definition.kind) {
        continue;
      }
      const editable =
        props[propId] !== undefined && propExpression(item, propId, value as Scalar) !== undefined;
      fields[propId] = {
        editable,
        kind: definition.kind,
        value: value as Scalar,
        ...(!editable ? { reason: "Direct literal instance prop required." } : {}),
      };
    }
    const elements = transformElements(item.syntax, transform);
    instances.push({
      componentId: component.id,
      instanceId: id,
      props: fields,
      transform: transform as ReactSceneTransform,
      transformEditable: elements !== undefined,
      version: component.version,
      ...(elements ? {} : { reason: "Direct literal transform required." }),
    });
  }
  return { diagnostics: [], ok: true, value: { instances, items: scene.value } };
};
export const readEditableReactScene = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<ReadonlyArray<EditableReactSceneInstance>> => {
  const result = inspect(collected, sourceText);
  return result.ok ? { diagnostics: [], ok: true, value: result.value.instances } : result;
};
const validTransform = (value: unknown): value is ReactSceneTransform =>
  record(value) &&
  Object.keys(value).length === 3 &&
  (["position", "rotation", "scale"] as const).every(
    (key) =>
      Array.isArray(value[key]) &&
      value[key].length === (key === "rotation" ? 4 : 3) &&
      value[key].every(
        (part: unknown) =>
          typeof part === "number" && Number.isFinite(part) && (key !== "scale" || part > 0),
      ),
  );
export const patchEditableReactScene = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
  command: ReactSceneEditCommand,
): Result<string> => {
  const result = inspect(collected, sourceText);
  if (!result.ok) {
    return result;
  }
  const index = result.value.instances.findIndex((item) => item.instanceId === command.instanceId);
  if (index < 0) {
    return fail("compiler-edit-instance-missing", "Instance does not exist.", command.instanceId);
  }
  const instance = result.value.instances[index]!;
  const item = result.value.items[index]!;
  if (command.kind === "setProp") {
    const field = instance.props[command.propId];
    if (!field) {
      return fail(
        "compiler-edit-prop-missing",
        "Published prop does not exist.",
        command.instanceId,
        command.propId,
      );
    }
    if (
      typeof command.value !== field.kind ||
      (typeof command.value === "number" && !Number.isFinite(command.value))
    ) {
      return fail(
        "compiler-edit-value-invalid",
        "Prop value does not match its published scalar type.",
        command.instanceId,
        command.propId,
      );
    }
    const expression = propExpression(item, command.propId, field.value);
    if (!expression) {
      return fail(
        "compiler-edit-source-unsupported",
        "Prop must be a direct instance literal; shared values and spreads are not editable yet.",
        command.instanceId,
        command.propId,
      );
    }
    return {
      diagnostics: [],
      ok: true,
      value:
        sourceText.slice(0, expression.getStart()) +
        JSON.stringify(command.value) +
        sourceText.slice(expression.getEnd()),
    };
  }
  if (command.kind !== "setTransform" || !validTransform(command.transform)) {
    return fail(
      "compiler-edit-value-invalid",
      "Transform requires finite position and rotation and positive scale.",
      command.instanceId,
    );
  }
  const elements = transformElements(item.syntax, instance.transform);
  if (!elements) {
    return fail(
      "compiler-edit-source-unsupported",
      "Transform must contain direct instance literals; shared values and spreads are not editable yet.",
      command.instanceId,
    );
  }
  const edits = (["position", "rotation", "scale"] as const).flatMap((key) =>
    elements[key].map((expression, axis) => ({
      end: expression.getEnd(),
      start: expression.getStart(),
      value: JSON.stringify(command.transform[key][axis]),
    })),
  );
  let updated = sourceText;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
  }
  return { diagnostics: [], ok: true, value: updated };
};
