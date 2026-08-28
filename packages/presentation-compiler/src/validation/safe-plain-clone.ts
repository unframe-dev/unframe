import type { ValidationResult } from "@unframe/presentation-core";
import { diagnostic, safelyIsDiagnostic } from "../diagnostics/diagnostics.js";

type UnknownRecord = Record<string, unknown>;

export const safePlainClone = (input: unknown): ValidationResult<unknown> => {
  const ancestors = new WeakSet<object>();
  const walk = (value: unknown, path: readonly (string | number)[]): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      throw diagnostic("compiler-invalid-input", path, "Input must contain finite JSON numbers.");
    }
    if (typeof value !== "object")
      throw diagnostic("compiler-invalid-input", path, "Input must contain plain JSON data.");
    if (ancestors.has(value))
      throw diagnostic("compiler-invalid-input", path, "Input must not contain cycles.");
    if (
      (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    )
      throw diagnostic("compiler-invalid-input", path, "Input objects must use Object.prototype.");
    ancestors.add(value);
    try {
      if (Object.getOwnPropertySymbols(value).length !== 0)
        throw diagnostic(
          "compiler-invalid-input",
          path,
          "Input must not contain symbol properties.",
        );
      if (Array.isArray(value)) {
        if (
          Object.keys(value).length !== value.length ||
          Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key)) ||
          [...Array(value.length).keys()].some((index) => !Object.hasOwn(value, index))
        )
          throw diagnostic("compiler-invalid-input", path, "Input must not contain sparse arrays.");
        const cloned: unknown[] = [];
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined)
            throw diagnostic(
              "compiler-invalid-input",
              [...path, index],
              "Input must not contain accessors.",
            );
          cloned.push(walk(descriptor.value, [...path, index]));
        }
        return cloned;
      }
      if (
        Object.getOwnPropertyNames(value).some(
          (key) => !Object.getOwnPropertyDescriptor(value, key)?.enumerable,
        )
      )
        throw diagnostic(
          "compiler-invalid-input",
          path,
          "Input must not contain non-enumerable properties.",
        );
      const cloned: UnknownRecord = {};
      for (const key of Object.keys(value).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined)
          throw diagnostic(
            "compiler-invalid-input",
            [...path, key],
            "Input must not contain accessors.",
          );
        Object.defineProperty(cloned, key, {
          value: walk(descriptor.value, [...path, key]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return cloned;
    } finally {
      ancestors.delete(value);
    }
  };
  try {
    return { valid: true, value: walk(input, []), diagnostics: [] };
  } catch (error) {
    const item = safelyIsDiagnostic(error)
      ? error
      : diagnostic("compiler-invalid-input", [], "Input cannot be inspected safely.");
    return { valid: false, diagnostics: [item] };
  }
};
