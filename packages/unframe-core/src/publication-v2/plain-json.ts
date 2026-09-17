type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type PlainJsonFailure = {
  path: readonly (string | number)[];
  message: string;
};

type PlainJsonResult =
  | { valid: true; value: JsonValue }
  | { valid: false; failure: PlainJsonFailure };

class InvalidPlainJson extends Error {
  constructor(
    readonly path: readonly (string | number)[],
    message: string,
  ) {
    super(message);
  }
}

const reject = (path: readonly (string | number)[], message: string): never => {
  throw new InvalidPlainJson(path, message);
};

const assertValidUnicode = (value: string, path: readonly (string | number)[]) => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) reject(path, "Lone Unicode surrogates are not JSON values.");
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff)
        reject(path, "Lone Unicode surrogates are not JSON values.");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      reject(path, "Lone Unicode surrogates are not JSON values.");
    }
  }
};

const arrayIndex = (key: string): number | undefined => {
  if (key === "0") return 0;
  if (!/^[1-9][0-9]*$/u.test(key)) return undefined;
  const value = Number(key);
  return Number.isSafeInteger(value) && value < 2 ** 32 - 1 ? value : undefined;
};

const snapshotValue = (
  value: unknown,
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): JsonValue => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertValidUnicode(value, path);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(path, "Non-finite numbers are not JSON values.");
    if (Object.is(value, -0)) reject(path, "Negative zero is not a canonical JSON value.");
    return value;
  }
  if (typeof value !== "object" || value === null)
    return reject(path, "Only plain JSON values are accepted.");
  if (ancestors.has(value)) return reject(path, "Cyclic values are not JSON values.");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        return reject(path, "Arrays must use the standard Array prototype.");
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor))
        return reject(path, "Array length must be a data property.");
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0 || length >= 2 ** 32)
        return reject(path, "Array length is invalid.");
      const seen = new Set<number>();
      const elements: { index: number; value: unknown }[] = [];
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string") return reject(path, "Symbol properties are not JSON values.");
        const index = arrayIndex(key);
        if (index === undefined || index >= length)
          return reject(path, "Arrays may only contain indexed data properties.");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          seen.has(index)
        )
          return reject([...path, index], "Array elements must be enumerable data properties.");
        seen.add(index);
        elements.push({ index, value: descriptor.value });
      }
      if (seen.size !== length) return reject(path, "Sparse arrays are not JSON values.");
      const result: JsonValue[] = [];
      for (const element of elements)
        result[element.index] = snapshotValue(element.value, [...path, element.index], ancestors);
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return reject(path, "Objects must use Object.prototype or a null prototype.");
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return reject(path, "Symbol properties are not JSON values.");
      assertValidUnicode(key, [...path, key]);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
        return reject([...path, key], "Object members must be enumerable data properties.");
      result[key] = snapshotValue(descriptor.value, [...path, key], ancestors);
    }
    return result;
  } catch (error) {
    if (error instanceof InvalidPlainJson) throw error;
    return reject(path, "The input could not be inspected as plain JSON.");
  } finally {
    ancestors.delete(value);
  }
};

export const snapshotPlainJson = (value: unknown): PlainJsonResult => {
  try {
    return { valid: true, value: snapshotValue(value, [], new WeakSet()) };
  } catch (error) {
    const failure =
      error instanceof InvalidPlainJson
        ? { path: error.path, message: error.message }
        : { path: [], message: "The input could not be inspected as plain JSON." };
    return { valid: false, failure };
  }
};
