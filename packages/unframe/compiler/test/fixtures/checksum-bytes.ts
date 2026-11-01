import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const checksumBytes = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;
