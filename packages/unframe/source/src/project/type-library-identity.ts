import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const hashSourceTypeLibraries = (
  libraries: readonly { readonly fileName: string; readonly sourceText: string }[],
): string => {
  const ordered = [...libraries].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(ordered.map(({ fileName, sourceText }) => [fileName, sourceText])))))}`;
};
