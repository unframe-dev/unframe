import { canonicalJsonPayload } from "./canonical-json.js";
import { hashCanonicalJson } from "./hash.js";

/** Hashes a payload that is observably composed only of plain JSON values. */
export const hashCanonicalJsonPayload = (value: unknown): string =>
  hashCanonicalJson(canonicalJsonPayload(value));
