import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { parseAuthoringProject } from "./parse-authoring-project.js";

export type SourceSnapshot = { readonly id: string; readonly source: unknown };
export const createSourceSnapshot = (
  input: unknown,
):
  | { readonly ok: true; readonly value: SourceSnapshot; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly diagnostics: readonly [
        { readonly code: "source-snapshot-invalid"; readonly message: string },
      ];
    } => {
  const clone = safePlainClone(input);
  if (!clone.valid || !parseAuthoringProject(clone.value).ok)
    return {
      ok: false,
      diagnostics: [
        { code: "source-snapshot-invalid", message: "A valid fixed Source snapshot is required." },
      ],
    };
  const id = `sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(clone.value))))}`;
  return { ok: true, value: { id, source: clone.value }, diagnostics: [] };
};
