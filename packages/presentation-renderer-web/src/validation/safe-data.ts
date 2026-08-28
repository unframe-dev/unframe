const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export const snapshotStrictRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | undefined => {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort(compareStrings);
    const keys = [...expectedKeys].sort(compareStrings);
    if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index]))
      return undefined;
    if (
      keys.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || descriptor.get !== undefined || descriptor.set !== undefined;
      })
    )
      return undefined;
    return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
  } catch {
    return undefined;
  }
};

export const snapshotDenseArray = (
  value: unknown,
  expectedLength?: number,
): readonly unknown[] | undefined => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const length = descriptors["length"]?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      (expectedLength !== undefined && length !== expectedLength)
    )
      return undefined;
    const keys = Array.from({ length }, (_, index) => String(index));
    const actualKeys = Object.keys(descriptors);
    if (
      actualKeys.length !== keys.length + 1 ||
      actualKeys.some((key, index) => key !== (keys[index] ?? "length")) ||
      keys.some((key) => {
        const descriptor = descriptors[key];
        return (
          !descriptor ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true
        );
      })
    )
      return undefined;
    return Object.freeze(keys.map((key) => descriptors[key]?.value));
  } catch {
    return undefined;
  }
};
