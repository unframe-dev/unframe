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

const utf8Bytes = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    let codePoint = value.codePointAt(index)!;
    if (codePoint > 0xffff) index++;
    else if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff)
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
};

const hash = (canonical: string) => `sha256:${bytesToHex(sha256(utf8Bytes(canonical)))}`;

const validatedHash = (canonical: ValidationResult<string>): ValidationResult<string> =>
  canonical.valid ? { valid: true, value: hash(canonical.value), diagnostics: [] } : canonical;

export const hashPresentationDefinition = (input: unknown) =>
  validatedHash(canonicalizePresentationDefinition(input));
export const hashRenderBundle = (input: unknown) => validatedHash(canonicalizeRenderBundle(input));
