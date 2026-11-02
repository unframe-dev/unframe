const invalid = (message: string): never => {
  throw new TypeError(message);
};

export const readOwnDataRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid("Expected a plain data object.");
  const object = value as object;
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null)
    invalid("Expected a plain data object.");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== "string") invalid("Data objects must use string keys.");
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError("Data objects must contain enumerable data properties.");
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
};

export const readOwnDataArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) invalid("Expected an array.");
  const array = value as unknown[];
  const lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor))
    throw new TypeError("Arrays must have a data length.");
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0)
    throw new TypeError("Arrays must have a valid length.");
  const keys = Reflect.ownKeys(array);
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length),
    )
  )
    invalid("Arrays must not contain holes or custom properties.");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError("Arrays must contain data properties.");
    result.push(descriptor.value);
  }
  return result;
};

/**
 * Copies only descriptor-backed JSON data. This prevents declaration validation
 * from invoking user supplied getters while isolating declarations from inherited data.
 */
export const snapshotDeclaration = (value: unknown, ancestors = new WeakSet<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value !== "object") invalid("Declarations must contain JSON-safe values.");

  const object = value as object;
  if (ancestors.has(object)) invalid("Declarations must not contain cycles.");
  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor))
        invalid("Declarations must contain data properties.");
      const length = (lengthDescriptor as PropertyDescriptor & { value: unknown }).value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff)
        invalid("Declarations must contain valid array lengths.");
      if (
        Object.keys(value).length !== length ||
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length),
        )
      )
        invalid("Declarations must not contain sparse arrays or custom array properties.");
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor))
          invalid("Declarations must contain data properties.");
        snapshot.push(
          snapshotDeclaration(
            (descriptor as PropertyDescriptor & { value: unknown }).value,
            ancestors,
          ),
        );
      }
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      invalid("Declarations must be plain data.");
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key !== "string") invalid("Declarations must use string object keys.");
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
        invalid("Declarations must contain enumerable data properties only.");
      Object.defineProperty(snapshot, key, {
        value: snapshotDeclaration(
          (descriptor as PropertyDescriptor & { value: unknown }).value,
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(object);
  }
};

export const isDeclaration = <T>(
  value: unknown,
  assertDeclaration: (value: T) => void,
): value is T => {
  try {
    assertDeclaration(value as T);
    return true;
  } catch {
    return false;
  }
};
