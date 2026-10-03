import descriptor from "../../presentation/wire-descriptor.json";

export interface WireEnumType {
  readonly values: Readonly<Record<string, number>>;
}
export interface WireOneof {
  readonly name: string;
  readonly oneof: readonly string[];
}
export interface WireField {
  readonly name: string;
  readonly type: string;
  readonly repeated: boolean;
  readonly map: boolean;
  readonly partOf?: WireOneof | undefined;
  readonly resolvedType?: WireMessageType | WireEnumType;
}
export interface WireMessageType {
  readonly fullName: string;
  readonly fieldsArray: readonly WireField[];
  readonly oneofsArray: readonly WireOneof[];
}
interface JsonField {
  type: string;
  rule?: string;
  keyType?: string;
}
interface JsonNode {
  nested?: Record<string, JsonNode>;
  fields?: Record<string, JsonField>;
  oneofs?: Record<string, { oneof: string[] }>;
  values?: Record<string, number>;
}

const messages = new Map<string, WireMessageType>();
const enums = new Map<string, WireEnumType>();
const rawFields = new Map<string, Record<string, JsonField>>();
function indexNode(node: JsonNode, path: string): void {
  if (node.fields) {
    const oneofsArray = Object.entries(node.oneofs ?? {}).map(([name, oneof]) => ({
      name,
      oneof: oneof.oneof,
    }));
    const fieldsArray = Object.entries(node.fields).map(([name, field]) => ({
      name,
      type: field.type,
      repeated: field.rule === "repeated",
      map: field.keyType !== undefined,
      partOf: oneofsArray.find((oneof) => oneof.oneof.includes(name)),
    }));
    messages.set(path, { fullName: `.${path}`, fieldsArray, oneofsArray });
    rawFields.set(path, node.fields);
  }
  if (node.values) enums.set(path, { values: node.values });
  for (const [name, child] of Object.entries(node.nested ?? {})) {
    indexNode(child, path ? `${path}.${name}` : name);
  }
}
indexNode(descriptor as JsonNode, "");
for (const [path, type] of messages) {
  for (const field of type.fieldsArray) {
    const target = rawFields.get(path)![field.name]!.type.replace(/^\./, "");
    const scopes = path.split(".");
    let resolved: WireMessageType | WireEnumType | undefined;
    while (scopes.length && !resolved) {
      resolved =
        messages.get(`${scopes.join(".")}.${target}`) ?? enums.get(`${scopes.join(".")}.${target}`);
      scopes.pop();
    }
    resolved ??= messages.get(target) ?? enums.get(target);
    if (resolved)
      (field as WireField & { resolvedType: WireMessageType | WireEnumType }).resolvedType =
        resolved;
  }
}

export function getInternalWireType(typeName: string): WireMessageType {
  const type = messages.get(typeName);
  if (!type) throw new TypeError(`Unknown wire message: ${typeName}`);
  return type;
}

function copyMetadata<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (typeof value !== "object" || value === null) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) {
    (copy as Record<string, unknown>)[key] = copyMetadata(child, seen);
  }
  return copy as T;
}

export function getPresentationWireType(typeName: string): WireMessageType {
  return copyMetadata(getInternalWireType(typeName), new WeakMap());
}
