import type { ValidationResult } from "../domain/model.js";
import { canonicalJson } from "./canonical-json.js";
import { hashCanonicalJson } from "./hash.js";
import { validatePresentationDefinition } from "../validation/definition.js";
import { validateRenderBundle } from "../validation/render-bundle.js";
import { diagnostic } from "../validation/shared.js";
const validatedCanonicalJson = <T>(
  input: unknown,
  validate: (value: unknown) => ValidationResult<T>,
): ValidationResult<string> => {
  const result = validate(input);
  if (!result.valid) {
    return result;
  }
  try {
    return { diagnostics: [], valid: true, value: canonicalJson(result.value) };
  } catch {
    return {
      diagnostics: [
        diagnostic(
          "invalid-canonical-json",
          [],
          "Artifact cannot be represented as canonical JSON.",
        ),
      ],
      valid: false,
    };
  }
};

export const canonicalizePresentationDefinition = (input: unknown) =>
  validatedCanonicalJson(input, validatePresentationDefinition);
export const canonicalizeRenderBundle = (input: unknown) =>
  validatedCanonicalJson(input, validateRenderBundle);

const validatedHash = (canonical: ValidationResult<string>): ValidationResult<string> =>
  canonical.valid
    ? { diagnostics: [], valid: true, value: hashCanonicalJson(canonical.value) }
    : canonical;

export const hashPresentationDefinition = (input: unknown) =>
  validatedHash(canonicalizePresentationDefinition(input));
export const hashRenderBundle = (input: unknown) => validatedHash(canonicalizeRenderBundle(input));
