import Long from "long";
import protobuf from "protobufjs/minimal.js";

import { unframe } from "../../presentation/wire-static.js";
import { getInternalWireType, type WireMessageType } from "./wire-metadata";

export { getPresentationWireType } from "./wire-metadata";

protobuf.util.Long = Long;
protobuf.configure();

function initializeStaticConstructors(namespace: Record<string, unknown>): void {
  for (const value of Object.values(namespace)) {
    if (typeof value === "function" && "encode" in value) {
      (value as unknown as { ctor: unknown }).ctor = value;
    } else if (typeof value === "object" && value !== null) {
      initializeStaticConstructors(value as Record<string, unknown>);
    }
  }
}
initializeStaticConstructors(unframe as unknown as Record<string, unknown>);

interface StaticCodec {
  fromObject(value: object): unknown;
  encode(value: unknown, writer?: protobuf.Writer): { finish(): Uint8Array };
  decode(bytes: Uint8Array): unknown;
  toObject(value: unknown, options: object): Record<string, unknown>;
}

function staticCodec(typeName: string): StaticCodec {
  const parts = typeName.split(".");
  if (parts.shift() !== "unframe") throw new TypeError(`Unknown wire type: ${typeName}`);
  let node: unknown = unframe;
  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      throw new TypeError(`Unknown wire type: ${typeName}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "function" || !("encode" in node) || !("decode" in node)) {
    throw new TypeError(`Unknown wire message: ${typeName}`);
  }
  return node as unknown as StaticCodec;
}

function snapshotData(value: unknown, depth = 0, active = new Set<object>()): unknown {
  if (depth > 64) throw new TypeError("Wire input nesting is too deep");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (ArrayBuffer.isView(value)) {
    if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
      throw new TypeError("Wire input contains unsupported data");
    }
    return new Uint8Array(value as Uint8Array);
  }
  if (typeof value !== "object") throw new TypeError("Wire input contains unsupported data");
  if (active.has(value)) throw new TypeError("Wire input contains a cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        throw new TypeError("Wire array must be plain");
      const properties: Record<string, PropertyDescriptor> =
        Object.getOwnPropertyDescriptors(value);
      const length = properties["length"]?.value;
      if (!Number.isSafeInteger(length) || length > 100_000)
        throw new TypeError("Wire array is too large");
      if (Reflect.ownKeys(value).length !== length + 1)
        throw new TypeError("Wire array must be dense");
      const copy: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = properties[String(index)];
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError("Wire array elements must be data properties");
        }
        copy.push(snapshotData(item.value, depth + 1, active));
      }
      return copy;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError("Wire object must be plain");
    const properties = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== Object.keys(properties).length) {
      throw new TypeError("Wire object cannot have symbol fields");
    }
    const copy: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      if (!("value" in property) || !property.enumerable) {
        throw new TypeError(`${name} must be a data property`);
      }
      Object.defineProperty(copy, name, {
        value: snapshotData(property.value, depth + 1, active),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    active.delete(value);
  }
}

function validateObject(type: WireMessageType, value: Record<string, unknown>, depth = 0): void {
  if (depth > 64 || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Wire input must be a bounded plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const fields = new Map(type.fieldsArray.map((field) => [field.name, field]));
  const selected = new Map<string, number>();
  for (const [name, property] of Object.entries(descriptors)) {
    if (!("value" in property)) throw new TypeError(`${name} must be a data property`);
    const field = fields.get(name);
    if (!field) throw new TypeError(`${type.fullName}.${name} is not a wire field`);
    if (field.partOf) {
      const count = (selected.get(field.partOf.name) ?? 0) + 1;
      if (count > 1) throw new TypeError(`${field.partOf.name} has multiple selected fields`);
      selected.set(field.partOf.name, count);
    }
  }
  for (const oneof of type.oneofsArray) {
    if (oneof.name.startsWith("_") && oneof.oneof.length === 1) continue;
    if (type.fullName === ".unframe.realtime.CommandAccepted" && oneof.name === "cueEvaluation")
      continue;
    if ((selected.get(oneof.name) ?? 0) !== 1) {
      throw new TypeError(`${type.fullName} oneof ${oneof.name} requires exactly one field`);
    }
  }
  for (const field of type.fieldsArray) {
    const entry = descriptors[field.name]?.value;
    if (entry === undefined) continue;
    if (entry === null) throw new TypeError(`${field.name} cannot be null`);
    const values = field.repeated ? entry : [entry];
    if (!Array.isArray(values)) throw new TypeError(`${field.name} must be an array`);
    for (const item of values) {
      if (["uint64", "fixed64", "int64", "sint64", "sfixed64"].includes(field.type)) {
        const unsigned = field.type === "uint64" || field.type === "fixed64";
        const canonical = unsigned ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*|-[1-9]\d*)$/;
        if (typeof item !== "string" || !canonical.test(item)) {
          throw new TypeError(`${field.name} must be a decimal string`);
        }
        const integer = BigInt(item);
        if (
          (unsigned && (integer < 0n || integer > (1n << 64n) - 1n)) ||
          (!unsigned && (integer < -(1n << 63n) || integer > (1n << 63n) - 1n))
        ) {
          throw new RangeError(`${field.name} is outside the 64-bit range`);
        }
      } else if (field.resolvedType && "fieldsArray" in field.resolvedType) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new TypeError(`${field.name} must be an object`);
        }
        validateObject(field.resolvedType, item as Record<string, unknown>, depth + 1);
      } else if (field.resolvedType && "values" in field.resolvedType) {
        if (
          typeof item !== "number" ||
          !Number.isInteger(item) ||
          item === 0 ||
          !Object.values(field.resolvedType.values).includes(item)
        ) {
          throw new TypeError(`${field.name} must be a known nonzero enum`);
        }
      } else if (field.type === "bytes" && !(item instanceof Uint8Array)) {
        throw new TypeError(`${field.name} must be a Uint8Array`);
      } else if (field.type === "string" && typeof item !== "string") {
        throw new TypeError(`${field.name} must be a string`);
      } else if (field.type === "bool" && typeof item !== "boolean") {
        throw new TypeError(`${field.name} must be a boolean`);
      } else if (
        ["double", "float"].includes(field.type) &&
        (typeof item !== "number" || !Number.isFinite(item))
      ) {
        throw new TypeError(`${field.name} must be a finite number`);
      } else if (
        ["uint32", "fixed32"].includes(field.type) &&
        (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 0xffffffff)
      ) {
        throw new RangeError(`${field.name} must be a uint32`);
      } else if (
        ["int32", "sint32", "sfixed32"].includes(field.type) &&
        (typeof item !== "number" ||
          !Number.isInteger(item) ||
          item < -0x80000000 ||
          item > 0x7fffffff)
      ) {
        throw new RangeError(`${field.name} must be an int32`);
      }
    }
  }
}

export function encodeWireMessage(typeName: string, value: object): Uint8Array {
  const type = getInternalWireType(typeName);
  const snapshot = snapshotData(value) as Record<string, unknown>;
  validateObject(type, snapshot);
  const codec = staticCodec(typeName);
  // workerd's Buffer UTF-8 writer differs from Node when the remaining length is omitted.
  return codec.encode(codec.fromObject(snapshot), new protobuf.Writer()).finish();
}

export function decodeWireMessage(typeName: string, bytes: Uint8Array): Record<string, unknown> {
  const codec = staticCodec(typeName);
  const value = codec.toObject(codec.decode(bytes), {
    longs: String,
    enums: Number,
    arrays: true,
    objects: true,
  });
  validateObject(getInternalWireType(typeName), value);
  return value;
}
