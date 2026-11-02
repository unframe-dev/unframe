import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

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

export const encodeSourceAssetBase64 = (bytes: Uint8Array): string => {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    encoded += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(encoded);
};

export const hasValidModelHeader = (bytes: Uint8Array): boolean => {
  if (bytes.length < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    view.getUint32(0, true) === 0x46546c67 &&
    view.getUint32(4, true) === 2 &&
    view.getUint32(8, true) === bytes.length &&
    view.getUint32(16, true) === 0x4e4f534a &&
    view.getUint32(12, true) <= bytes.length - 20
  );
};

export const hasValidVideoHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false) >= 8 &&
  bytes[4] === 0x66 &&
  bytes[5] === 0x74 &&
  bytes[6] === 0x79 &&
  bytes[7] === 0x70;
