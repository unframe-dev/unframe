import type { ValidationResult } from "@unframe/presentation";
import type { BuildMediaPorts } from "../api/media-ports.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { safePlainClone } from "./safe-plain-clone.js";

export function snapshotMediaPorts(value: unknown): ValidationResult<BuildMediaPorts> {
  const invalid = (): ValidationResult<never> => ({
    valid: false,
    diagnostics: [
      diagnostic(
        "compiler-invalid-media-adapter",
        ["media"],
        "A complete media adapter is required.",
      ),
    ],
  });
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      return invalid();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (
      Object.keys(fields).sort().join(",") !== "encodePng,modelIdentity,pngIdentity,transformModel"
    )
      return invalid();
    for (const field of Object.values(fields))
      if (!field.enumerable || !Object.hasOwn(field, "value")) return invalid();
    if (
      typeof fields.encodePng!.value !== "function" ||
      typeof fields.transformModel!.value !== "function"
    )
      return invalid();
    const png = safePlainClone(fields.pngIdentity!.value);
    const model = safePlainClone(fields.modelIdentity!.value);
    if (!png.valid || !model.valid) return invalid();
    return {
      valid: true,
      diagnostics: [],
      value: {
        pngIdentity: png.value,
        modelIdentity: model.value,
        encodePng: fields.encodePng!.value,
        transformModel: fields.transformModel!.value,
      } as BuildMediaPorts,
    };
  } catch {
    return invalid();
  }
}
