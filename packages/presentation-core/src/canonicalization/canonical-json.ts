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
