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
      readonly kind: "setProp";
      readonly instanceId: string;
      readonly propId: string;
      readonly value: Scalar;
    }
  | {
      readonly kind: "setTransform";
      readonly instanceId: string;
      readonly transform: ReactSceneTransform;
    }
  | {
      readonly kind: "inheritProp";
      readonly instanceId: string;
      readonly propId: string;
    }
  | {
      readonly kind: "restoreProp";
      readonly instanceId: string;
      readonly propId: string;
      readonly expression: string;
    }
  | {
      readonly kind: "inheritTransform";
      readonly instanceId: string;
    }
  | {
      readonly kind: "restoreTransform";
      readonly instanceId: string;
      readonly expression: string;
    };
export type ReactSceneEditDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly instanceId?: string;
  readonly propId?: string;
};
export type EditableReactSceneInstance = {
  readonly instanceId: string;
  readonly componentId: string;
  readonly version: number;
  readonly props: Readonly<
    Record<
      string,
      {
        readonly kind: "string" | "number" | "boolean";
        readonly value: Scalar;
        readonly editable: boolean;
        readonly inherited: boolean;
        readonly inheritanceExpression?: string;
        readonly reason?: string;
      }
    >
  >;
  readonly transform: ReactSceneTransform;
  readonly transformEditable: boolean;
  readonly transformInherited: boolean;
  readonly transformInheritanceExpression?: string;
  readonly reason?: string;
};
type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly ReactSceneEditDiagnostic[] };
type RecordValue = Record<string, unknown>;
type SceneSyntax = {
  readonly node: ts.ObjectLiteralExpression;
  readonly props: ts.Expression | undefined;
  readonly transform: ts.Expression | undefined;
};
type SceneItem = { readonly value: RecordValue; readonly syntax?: SceneSyntax };

const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (
  code: string,
  message: string,
  instanceId?: string,
  propId?: string,
): Result<never> => ({
  ok: false,
  diagnostics: [
    {
      code,
      message,
      ...(instanceId === undefined ? {} : { instanceId }),
      ...(propId === undefined ? {} : { propId }),
    },
  ],
});
const property = (node: ts.ObjectLiteralExpression, name: string) => {
  for (const item of [...node.properties].reverse()) {
    if (ts.isSpreadAssignment(item)) return undefined;
    if (
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name
    )
      return item;
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
  if (typeof expected === "string")
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text === expected
      : false;
  if (typeof expected === "boolean")
    return expected
      ? node.kind === ts.SyntaxKind.TrueKeyword
      : node.kind === ts.SyntaxKind.FalseKeyword;
  if (ts.isNumericLiteral(node)) return Number(node.text) === expected;
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
): ts.Expression[] | undefined => {
  if (!expression || !Array.isArray(values)) return;
  const node = unwrap(expression);
  if (!ts.isArrayLiteralExpression(node) || node.elements.length !== values.length) return;
  const elements: ts.Expression[] = [];
  for (const [index, item] of node.elements.entries()) {
    if (
      !ts.isExpression(item) ||
      typeof values[index] !== "number" ||
      !literal(item, values[index])
    )
      return;
    elements.push(item);
  }
  return elements;
};
const transformElements = (syntax: SceneSyntax | undefined, value: unknown) => {
  if (!syntax || !record(value)) return;
  const node = object(syntax.transform);
  if (!node || node.properties.some(ts.isSpreadAssignment)) return;
  const result: Record<"position" | "rotation" | "scale", ts.Expression[]> = {
    position: [],
    rotation: [],
    scale: [],
  };
  for (const key of ["position", "rotation", "scale"] as const) {
    const elements = vector(property(node, key)?.initializer, value[key]);
    if (!elements || elements.length !== (key === "rotation" ? 4 : 3)) return;
    result[key] = elements;
  }
  return result;
};
const sourceScene = (
  sourceText: string,
  fileName: string,
): ts.ObjectLiteralExpression[] | undefined => {
  const parsed = parseAuthoringSource({ fileName, sourceText });
  if (!parsed.ok) return;
  const file = parsed.value;
  const assignment = file.statements.find(
    (item): item is ts.ExportAssignment => ts.isExportAssignment(item) && !item.isExportEquals,
  );
  if (!assignment) return;
  const call = unwrap(assignment.expression);
  if (
    !ts.isCallExpression(call) ||
    call.arguments.length !== 1 ||
    !ts.isIdentifier(call.expression)
  )
    return;
  const root = object(call.arguments[0]);
  if (!root) return;
  const scene = property(root, "scene")?.initializer;
  if (!scene || !ts.isArrayLiteralExpression(unwrap(scene))) return;
  return (unwrap(scene) as ts.ArrayLiteralExpression).elements
    .map((item) => object(item))
    .filter((item): item is ts.ObjectLiteralExpression => item !== undefined);
};
const sceneItems = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<SceneItem[]> => {
  const declaration = collected.presentation;
  if (!declaration || !record(declaration.value) || !Array.isArray(declaration.value.scene))
    return fail("compiler-edit-scene-invalid", "A validated React scene is required.");
  const nodes = sourceScene(sourceText, declaration.fileName);
  if (!nodes || nodes.length !== declaration.value.scene.length)
    return fail(
      "compiler-edit-scene-unsupported",
      "Scene items must be direct object literals in the current source.",
    );
  const result: SceneItem[] = [];
  for (const [index, value] of declaration.value.scene.entries()) {
    if (!record(value)) return fail("compiler-edit-scene-invalid", "Scene item is invalid.");
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
    )
      return fail(
        "compiler-edit-scene-unsupported",
        "Scene item cannot be uniquely matched to a direct source declaration.",
      );
    result.push({
      value,
      syntax: {
        node,
        props: property(node, "props")?.initializer,
        transform: property(node, "transform")?.initializer,
      },
    });
  }
  return { ok: true, value: result, diagnostics: [] };
};
const propKind = (kind: unknown): kind is "string" | "number" | "boolean" =>
  kind === "string" || kind === "number" || kind === "boolean";
const propExpression = (item: SceneItem, propId: string, value: Scalar) => {
  const props = object(item.syntax?.props);
  if (!props) return;
  const field = property(props, propId);
  return field && literal(field.initializer, value) ? field.initializer : undefined;
};
const replace = (source: string, start: number, end: number, value: string) =>
  source.slice(0, start) + value + source.slice(end);
const propertyName = (name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
const containsComment = (source: string, node: ts.Node) => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source.slice(node.getStart(), node.getEnd()),
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    )
      return true;
  return false;
};
const validRestoreExpression = (expression: string) => {
  const parsed = ts.createSourceFile(
    "restore.ts",
    `const restored = ${expression};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return (
    (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
      .length === 0 && parsed.statements.length === 1
  );
};
const appendProperty = (source: string, node: ts.ObjectLiteralExpression, value: string) => {
  const last = node.properties[node.properties.length - 1];
  if (!last) return replace(source, node.getEnd() - 1, node.getEnd() - 1, ` ${value} `);
  const tail = source.slice(last.getEnd(), node.getEnd() - 1);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    tail,
  );
  let cutoff = tail.length;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
      cutoff = scanner.getTokenPos();
      break;
    }
  const prefix = tail.slice(0, cutoff).trimEnd();
  const offset = last.getEnd() + prefix.length;
  return replace(source, offset, offset, `${prefix.endsWith(",") ? "" : ","} ${value}`);
};
const removeLastProperty = (
  source: string,
  node: ts.ObjectLiteralExpression,
  field: ts.PropertyAssignment,
) => {
  const previous = node.properties[node.properties.length - 2];
  if (!previous || node.properties[node.properties.length - 1] !== field) return;
  const between = source.slice(previous.getEnd(), field.getStart());
  const comma = between.indexOf(",");
  if (comma < 0) return;
  return replace(source, previous.getEnd() + comma, field.getEnd(), "");
};
const inspect = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<{ items: SceneItem[]; instances: EditableReactSceneInstance[] }> => {
  const scene = sceneItems(collected, sourceText);
  if (!scene.ok) return scene;
  const instances: EditableReactSceneInstance[] = [];
  for (const item of scene.value) {
    const { id, component, props, transform } = item.value;
    if (
      typeof id !== "string" ||
      !record(component) ||
      typeof component.id !== "string" ||
      typeof component.version !== "number" ||
      !record(props) ||
      !record(transform)
    )
      return fail("compiler-edit-scene-invalid", "Scene item is invalid.");
    const descriptor = collected.components.find(
      (candidate) =>
        "metadata" in candidate &&
        candidate.metadata.id === component.id &&
        candidate.metadata.version === component.version,
    );
    if (!descriptor || !("metadata" in descriptor))
      return fail("compiler-edit-component-missing", "React component metadata is missing.", id);
    const fields: Record<string, EditableReactSceneInstance["props"][string]> = {};
    for (const [propId, definition] of Object.entries(descriptor.metadata.props)) {
      if (!propKind(definition.kind)) continue;
      const value = props[propId] ?? ("default" in definition ? definition.default : undefined);
      if (typeof value !== definition.kind) continue;
      const editable = props[propId] !== undefined && item.syntax?.props !== undefined;
      const inherited = propExpression(item, propId, value as Scalar) === undefined;
      const propsNode = object(item.syntax?.props);
      const sourceField = propsNode && property(propsNode, propId);
      fields[propId] = {
        kind: definition.kind,
        value: value as Scalar,
        editable,
        inherited,
        ...(inherited && sourceField
          ? { inheritanceExpression: sourceField.initializer.getText() }
          : {}),
        ...(!editable ? { reason: "Direct literal instance prop required." } : {}),
      };
    }
    const elements = transformElements(item.syntax, transform);
    const transformNode = item.syntax && property(item.syntax.node, "transform");
    instances.push({
      instanceId: id,
      componentId: component.id,
      version: component.version,
      props: fields,
      transform: transform as ReactSceneTransform,
      transformEditable: item.syntax !== undefined,
      transformInherited: elements === undefined,
      ...(elements === undefined && transformNode
        ? { transformInheritanceExpression: transformNode.initializer.getText() }
        : {}),
    });
  }
  return { ok: true, value: { items: scene.value, instances }, diagnostics: [] };
};
export const readEditableReactScene = (
  collected: PairedAuthoringDeclarationCatalog,
  sourceText: string,
): Result<readonly EditableReactSceneInstance[]> => {
  const result = inspect(collected, sourceText);
  return result.ok ? { ok: true, value: result.value.instances, diagnostics: [] } : result;
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
  if (!result.ok) return result;
  const index = result.value.instances.findIndex((item) => item.instanceId === command.instanceId);
  if (index < 0)
    return fail("compiler-edit-instance-missing", "Instance does not exist.", command.instanceId);
  const instance = result.value.instances[index]!;
  const item = result.value.items[index]!;
  if (command.kind === "restoreTransform") {
    const own = item.syntax && property(item.syntax.node, "transform");
    if (!own || !object(own.initializer) || !validRestoreExpression(command.expression))
      return fail(
        "compiler-edit-source-unsupported",
        "Shared transform expression cannot be restored.",
        command.instanceId,
      );
    return {
      ok: true,
      value: replace(
        sourceText,
        own.initializer.getStart(),
        own.initializer.getEnd(),
        command.expression,
      ),
      diagnostics: [],
    };
  }
  if (command.kind === "restoreProp") {
    const props = object(item.syntax?.props);
    const own = props && property(props, command.propId);
    const field = instance.props[command.propId];
    if (
      !own ||
      !field ||
      !literal(own.initializer, field.value) ||
      !validRestoreExpression(command.expression)
    )
      return fail(
        "compiler-edit-source-unsupported",
        "Shared prop expression cannot be restored.",
        command.instanceId,
        command.propId,
      );
    return {
      ok: true,
      value: replace(
        sourceText,
        own.initializer.getStart(),
        own.initializer.getEnd(),
        command.expression,
      ),
      diagnostics: [],
    };
  }
  if (command.kind === "inheritTransform") {
    const node = item.syntax?.node;
    const own = node && property(node, "transform");
    if (
      !node ||
      !own ||
      !object(own.initializer) ||
      node.properties[node.properties.length - 1] !== own ||
      !node.properties
        .slice(0, -1)
        .some(
          (entry) =>
            ts.isSpreadAssignment(entry) ||
            (ts.isPropertyAssignment(entry) &&
              (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
              entry.name.text === "transform"),
        )
    )
      return fail(
        "compiler-edit-source-unsupported",
        "No inherited transform exists.",
        command.instanceId,
      );
    const restored = removeLastProperty(sourceText, node, own);
    return restored
      ? { ok: true, value: restored, diagnostics: [] }
      : fail(
          "compiler-edit-source-unsupported",
          "Transform override cannot be removed.",
          command.instanceId,
        );
  }
  if (command.kind === "inheritProp") {
    const field = instance.props[command.propId];
    if (!field)
      return fail(
        "compiler-edit-prop-missing",
        "Published prop does not exist.",
        command.instanceId,
        command.propId,
      );
    const props = object(item.syntax?.props);
    const own = props && property(props, command.propId);
    if (!props || !own || !literal(own.initializer, field.value))
      return fail(
        "compiler-edit-source-unsupported",
        "No local literal override exists.",
        command.instanceId,
        command.propId,
      );
    const prior = props.properties
      .slice(0, -1)
      .some(
        (entry) =>
          ts.isSpreadAssignment(entry) ||
          (ts.isPropertyAssignment(entry) &&
            (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
            entry.name.text === command.propId),
      );
    if (!prior)
      return fail(
        "compiler-edit-source-unsupported",
        "No inherited prop exists.",
        command.instanceId,
        command.propId,
      );
    const without = removeLastProperty(sourceText, props, own);
    if (!without)
      return fail(
        "compiler-edit-source-unsupported",
        "Local override cannot be removed.",
        command.instanceId,
        command.propId,
      );
    const remaining = props.properties.slice(0, -1);
    if (
      remaining.length === 1 &&
      ts.isSpreadAssignment(remaining[0]!) &&
      remaining[0]!.expression.getText() !== "" &&
      !containsComment(sourceText, props)
    ) {
      const replacement = remaining[0]!.expression.getText();
      const clean =
        without.slice(0, props.getStart()) +
        replacement +
        without.slice(props.getEnd() - (sourceText.length - without.length));
      return { ok: true, value: clean, diagnostics: [] };
    }
    return { ok: true, value: without, diagnostics: [] };
  }
  if (command.kind === "setProp") {
    const field = instance.props[command.propId];
    if (!field)
      return fail(
        "compiler-edit-prop-missing",
        "Published prop does not exist.",
        command.instanceId,
        command.propId,
      );
    if (!field.editable)
      return fail(
        "compiler-edit-source-unsupported",
        "Prop source is unavailable.",
        command.instanceId,
        command.propId,
      );
    if (
      typeof command.value !== field.kind ||
      (typeof command.value === "number" && !Number.isFinite(command.value))
    )
      return fail(
        "compiler-edit-value-invalid",
        "Prop value does not match its published scalar type.",
        command.instanceId,
        command.propId,
      );
    const expression = propExpression(item, command.propId, field.value);
    if (!item.syntax)
      return fail(
        "compiler-edit-source-unsupported",
        "Instance source is unavailable.",
        command.instanceId,
        command.propId,
      );
    if (!expression) {
      const props = object(item.syntax.props);
      const own = props && property(props, command.propId);
      if (own)
        return {
          ok: true,
          value: replace(
            sourceText,
            own.initializer.getStart(),
            own.initializer.getEnd(),
            JSON.stringify(command.value),
          ),
          diagnostics: [],
        };
      if (props)
        return {
          ok: true,
          value: appendProperty(
            sourceText,
            props,
            `${propertyName(command.propId)}: ${JSON.stringify(command.value)}`,
          ),
          diagnostics: [],
        };
      if (item.syntax.props)
        return {
          ok: true,
          value: replace(
            sourceText,
            item.syntax.props.getStart(),
            item.syntax.props.getEnd(),
            `{ ...${item.syntax.props.getText()}, ${propertyName(command.propId)}: ${JSON.stringify(command.value)} }`,
          ),
          diagnostics: [],
        };
      return fail(
        "compiler-edit-source-unsupported",
        "Prop source is unavailable.",
        command.instanceId,
        command.propId,
      );
    }
    return {
      ok: true,
      value: replace(
        sourceText,
        expression.getStart(),
        expression.getEnd(),
        JSON.stringify(command.value),
      ),
      diagnostics: [],
    };
  }
  if (command.kind !== "setTransform" || !validTransform(command.transform))
    return fail(
      "compiler-edit-value-invalid",
      "Transform requires finite position and rotation and positive scale.",
      command.instanceId,
    );
  const elements = transformElements(item.syntax, instance.transform);
  if (!elements) {
    const node = item.syntax?.node;
    if (!node)
      return fail(
        "compiler-edit-source-unsupported",
        "Instance source is unavailable.",
        command.instanceId,
      );
    const serialized = `{ position: ${JSON.stringify(command.transform.position)}, rotation: ${JSON.stringify(command.transform.rotation)}, scale: ${JSON.stringify(command.transform.scale)} }`;
    const own = property(node, "transform");
    const transformObject = object(own?.initializer);
    if (transformObject) {
      const edits: { start: number; end: number; value: string }[] = [];
      const added: string[] = [];
      for (const key of ["position", "rotation", "scale"] as const) {
        const before = instance.transform[key];
        const after = command.transform[key];
        if (before.every((value, axis) => value === after[axis])) continue;
        const field = property(transformObject, key);
        if (!field) {
          added.push(`${key}: ${JSON.stringify(after)}`);
          continue;
        }
        const parts = vector(field.initializer, before);
        if (parts) {
          for (const [axis, part] of parts.entries())
            if (before[axis] !== after[axis])
              edits.push({
                start: part.getStart(),
                end: part.getEnd(),
                value: JSON.stringify(after[axis]),
              });
        } else {
          edits.push({
            start: field.initializer.getStart(),
            end: field.initializer.getEnd(),
            value: JSON.stringify(after),
          });
        }
      }
      let updated =
        added.length > 0
          ? appendProperty(sourceText, transformObject, added.join(", "))
          : sourceText;
      for (const edit of edits.sort((left, right) => right.start - left.start))
        updated = replace(updated, edit.start, edit.end, edit.value);
      return { ok: true, value: updated, diagnostics: [] };
    }
    if (own)
      return {
        ok: true,
        value: replace(
          sourceText,
          own.initializer.getStart(),
          own.initializer.getEnd(),
          serialized,
        ),
        diagnostics: [],
      };
    return {
      ok: true,
      value: appendProperty(sourceText, node, `transform: ${serialized}`),
      diagnostics: [],
    };
  }
  const edits = (["position", "rotation", "scale"] as const).flatMap((key) =>
    elements[key].map((expression, axis) => ({
      start: expression.getStart(),
      end: expression.getEnd(),
      value: JSON.stringify(command.transform[key][axis]),
    })),
  );
  let updated = sourceText;
  for (const edit of edits.sort((left, right) => right.start - left.start))
    updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
  return { ok: true, value: updated, diagnostics: [] };
};
