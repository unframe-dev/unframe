import canonicalize from "canonicalize";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, unknown>;

const setArrayKeys = new Set([
  "rootNodeIds",
  "enabledInteractionIds",
  "stateIds",
  "events",
  "renderSurfaceIds",
  "artifactIds",
]);

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertValidUnicode = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff)
        throw new TypeError("Canonical JSON does not permit lone Unicode surrogates.");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("Canonical JSON does not permit lone Unicode surrogates.");
    }
  }
};

const assertCanonicalUnicode = (value: unknown): void => {
  if (typeof value === "string") {
    assertValidUnicode(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalUnicode(item);
    return;
  }
  if (isRecord(value))
    for (const [key, item] of Object.entries(value)) {
      assertValidUnicode(key);
      assertCanonicalUnicode(item);
    }
};

export const normalizePresentationValue = (value: unknown, key?: string): JsonValue => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON does not permit non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizePresentationValue(item));
    return key !== undefined && setArrayKeys.has(key)
      ? [...normalized].sort((left, right) => compareStrings(String(left), String(right)))
      : normalized;
  }
  if (isRecord(value)) {
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const entryKey of Object.keys(value))
      result[entryKey] = normalizePresentationValue(value[entryKey], entryKey);

    const nodes = value.nodes;
    if (Array.isArray(result.rootNodeIds) && isRecord(nodes)) {
      result.rootNodeIds.sort((left, right) => {
        const leftNode = nodes[String(left)];
        const rightNode = nodes[String(right)];
        const order =
          isRecord(leftNode) && isRecord(rightNode)
            ? Number(leftNode.order) - Number(rightNode.order)
            : 0;
        return order === 0 ? compareStrings(String(left), String(right)) : order;
      });
    }

    const sourceContentNodes = isRecord(value.contentNodes) ? value.contentNodes : undefined;
    const resultContentNodes = isRecord(result.contentNodes) ? result.contentNodes : undefined;
    if (sourceContentNodes !== undefined && resultContentNodes !== undefined)
      for (const nodeId of Object.keys(sourceContentNodes)) {
        const resultNode = resultContentNodes[nodeId];
        if (!isRecord(resultNode) || !Array.isArray(resultNode.children)) continue;
        resultNode.children.sort((left, right) => {
          const leftNode = sourceContentNodes[String(left)];
          const rightNode = sourceContentNodes[String(right)];
          const order =
            isRecord(leftNode) && isRecord(rightNode)
              ? Number(leftNode.order) - Number(rightNode.order)
              : 0;
          return order === 0 ? compareStrings(String(left), String(right)) : order;
        });
      }
    return result;
  }
  throw new TypeError("Canonical JSON only supports JSON values.");
};

export const normalizedJson = (value: unknown): string => {
  const serialized = canonicalize(normalizePresentationValue(value));
  if (serialized === undefined)
    throw new TypeError("Canonical JSON serialization did not produce a value.");
  return serialized;
};

export const canonicalJson = (value: unknown): string => {
  assertCanonicalUnicode(value);
  return normalizedJson(value);
};

const invalidPayload = (): never => {
  throw new TypeError("Canonical JSON payload must contain only observably plain JSON values.");
};

const arrayIndex = (key: string): number | undefined => {
  if (key === "0") return 0;
  if (!/^[1-9][0-9]*$/u.test(key)) return undefined;
  const value = Number(key);
  return Number.isSafeInteger(value) && value < 2 ** 32 - 1 ? value : undefined;
};

const observedJsonValue = (value: unknown, ancestors: WeakSet<object>): JsonValue => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertValidUnicode(value);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidPayload();
    return value;
  }
  if (typeof value !== "object" || value === null) return invalidPayload();

  try {
    if (ancestors.has(value)) return invalidPayload();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) return invalidPayload();
        const keys = Reflect.ownKeys(value);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor))
          return invalidPayload();
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0 || length >= 2 ** 32)
          return invalidPayload();
        const result: JsonValue[] = Array.from({ length });
        const seen = new Set<number>();
        for (const key of keys) {
          if (key === "length") continue;
          if (typeof key !== "string") return invalidPayload();
          const index = arrayIndex(key);
          if (index === undefined || index >= length) return invalidPayload();
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (
            descriptor === undefined ||
            !descriptor.enumerable ||
            !("value" in descriptor) ||
            seen.has(index)
          )
            return invalidPayload();
          seen.add(index);
          result[index] = observedJsonValue(descriptor.value, ancestors);
        }
        if (seen.size !== length) return invalidPayload();
        return result;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return invalidPayload();
      const result = Object.create(null) as Record<string, JsonValue>;
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") return invalidPayload();
        assertValidUnicode(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
          return invalidPayload();
        result[key] = observedJsonValue(descriptor.value, ancestors);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return invalidPayload();
  }
};

export const canonicalJsonPayload = (value: unknown): string => {
  const serialized = canonicalize(observedJsonValue(value, new WeakSet()));
  return serialized ?? invalidPayload();
};
