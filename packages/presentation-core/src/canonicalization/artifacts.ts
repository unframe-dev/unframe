import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ValidationResult } from "../domain/model.js";
import { canonicalJson } from "./canonical-json.js";
import { validatePresentationDefinition } from "../validation/definition.js";
import { validateRenderBundle } from "../validation/render-bundle.js";
import { diagnostic } from "../validation/shared.js";
const validatedCanonicalJson = <T>(
  input: unknown,
  validate: (value: unknown) => ValidationResult<T>,
): ValidationResult<string> => {
  const result = validate(input);
  if (!result.valid) return result;
  try {
    return { valid: true, value: canonicalJson(result.value), diagnostics: [] };
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "invalid-canonical-json",
          [],
          "Artifact cannot be represented as canonical JSON.",
        ),
      ],
    };
  }
};

export const canonicalizePresentationDefinition = (input: unknown) =>
  validatedCanonicalJson(input, validatePresentationDefinition);
export const canonicalizeRenderBundle = (input: unknown) =>
  validatedCanonicalJson(input, validateRenderBundle);

const hash = (canonical: string) =>
  `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonical)))}`;

const validatedHash = (canonical: ValidationResult<string>): ValidationResult<string> =>
  canonical.valid ? { valid: true, value: hash(canonical.value), diagnostics: [] } : canonical;

export const hashPresentationDefinition = (input: unknown) =>
  validatedHash(canonicalizePresentationDefinition(input));
export const hashRenderBundle = (input: unknown) => validatedHash(canonicalizeRenderBundle(input));
