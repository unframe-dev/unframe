import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const MAX_SOURCE_ASSET_BYTES = 64 * 1024 * 1024;

export const decodeCanonicalBase64 = (
  value: string,
  maxBytes = MAX_SOURCE_ASSET_BYTES,
): Uint8Array | undefined => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > MAX_SOURCE_ASSET_BYTES ||
    value.length > Math.ceil(maxBytes / 3) * 4
  )
    return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    return undefined;
  const decodedLength =
    (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (decodedLength > maxBytes) return undefined;
  try {
    const decoded = atob(value);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      encoded += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(encoded) === value ? bytes : undefined;
  } catch {
    return undefined;
  }
};

export const checksumBytes = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;

export const hasValidFontSignature = (bytes: Uint8Array, mediaType: string) =>
  mediaType === "font/ttf"
    ? bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0
    : mediaType === "font/otf" &&
      bytes.length >= 4 &&
      bytes[0] === 0x4f &&
      bytes[1] === 0x54 &&
      bytes[2] === 0x54 &&
      bytes[3] === 0x4f;

export const hasValidImageSignature = (bytes: Uint8Array, mediaType: string) =>
  mediaType === "image/png"
    ? bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : mediaType === "image/jpeg" &&
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
