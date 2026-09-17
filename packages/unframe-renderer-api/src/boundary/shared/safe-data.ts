export const applyFunction = Reflect.apply;

export const plainDataRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).some((key) => descriptors[key]?.get || descriptors[key]?.set))
      return undefined;
    return Object.fromEntries(
      Object.keys(descriptors).map((key) => [key, descriptors[key]?.value]),
    );
  } catch {
    return undefined;
  }
};
const invalidSnapshot = Symbol("invalid-renderer-boundary-snapshot");

export const snapshotUnknown = (value: unknown, seen = new Set<object>()): unknown => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  const bytes = copyUint8Array(value);
  if (bytes) return bytes;
  if (typeof value !== "object" || seen.has(value)) return invalidSnapshot;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = (descriptors["length"] as unknown as PropertyDescriptor | undefined)?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        Object.getOwnPropertySymbols(value).length !== 0
      )
        return invalidSnapshot;
      const expected = Array.from({ length }, (_, index) => String(index));
      if (
        Object.keys(descriptors).length !== length + 1 ||
        expected.some((key) => {
          const descriptor = descriptors[key];
          return !descriptor || descriptor.get || descriptor.set;
        })
      )
        return invalidSnapshot;
      return expected.map((key) => snapshotUnknown(descriptors[key]?.value, seen));
    }
    const record = plainDataRecord(value);
    if (!record) return invalidSnapshot;
    return Object.fromEntries(
      Object.keys(record).map((key) => [key, snapshotUnknown(record[key], seen)]),
    );
  } finally {
    seen.delete(value);
  }
};
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
export const copyUint8Array = (value: unknown): Uint8Array | undefined => {
  try {
    if (!ArrayBuffer.isView(value) || !typedArrayByteLength || !typedArrayTag) return undefined;
    if (typedArrayTag.call(value) !== "Uint8Array") return undefined;
    const byteLength = typedArrayByteLength.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return undefined;
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
    return copy;
  } catch {
    return undefined;
  }
};
