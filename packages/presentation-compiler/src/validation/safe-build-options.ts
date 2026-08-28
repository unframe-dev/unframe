import type { ValidationResult } from "@unframe/presentation-core";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { safePlainClone } from "./safe-plain-clone.js";

const invalidOptions = (message: string): ValidationResult<never> => ({
  valid: false,
  diagnostics: [diagnostic("compiler-invalid-options", ["options"], message)],
});

const snapshotRenderers = (value: unknown): ValidationResult<readonly unknown[]> => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return invalidOptions("Build renderers must be a plain dense array.");
  try {
    if (
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.keys(value).length !== value.length ||
      Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key))
    )
      return invalidOptions("Build renderers must be a plain dense array.");
    const renderers: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined)
        return invalidOptions("Build renderer entries must not use accessors.");
      renderers.push(descriptor.value);
    }
    return { valid: true, value: renderers, diagnostics: [] };
  } catch {
    return invalidOptions("Build options could not be inspected safely.");
  }
};

/** Snapshots data configuration without cloning caller-owned callable renderer plugins. */
export const safeBuildOptionsSnapshot = (input: unknown): ValidationResult<unknown> => {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    )
      return invalidOptions("Build options must be a complete explicit configuration.");
    if (Object.getOwnPropertySymbols(input).length !== 0)
      return invalidOptions("Build options must be a complete explicit configuration.");
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined)
        return invalidOptions("Build options must not contain accessors.");
      if (key === "renderers") {
        const renderers = snapshotRenderers(descriptor.value);
        if (!renderers.valid) return renderers;
        snapshot[key] = renderers.value;
        continue;
      }
      const cloned = safePlainClone(descriptor.value);
      if (!cloned.valid) return invalidOptions("Build options must contain plain JSON data.");
      snapshot[key] = cloned.value;
    }
    return { valid: true, value: snapshot, diagnostics: [] };
  } catch {
    return invalidOptions("Build options could not be inspected safely.");
  }
};
