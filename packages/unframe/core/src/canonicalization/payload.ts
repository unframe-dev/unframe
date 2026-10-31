import { canonicalJsonPayload } from "./canonical-json.js";
import { hashCanonicalJson } from "./hash.js";

/** Serializes an observably plain JSON payload using RFC 8785 JCS. */
export const canonicalizeJsonPayload = (value: unknown): string => canonicalJsonPayload(value);

/** Hashes a payload that is observably composed only of plain JSON values. */
export const hashCanonicalJsonPayload = (value: unknown): string =>
  hashCanonicalJson(canonicalizeJsonPayload(value));
