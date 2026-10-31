/// <reference types="node" />
import { Buffer } from "node:buffer";
import extractChunks from "@stackline/png-chunks-extract";
import { png } from "@stacksjs/ts-png";

export const profileImageSizeLimit = 2 * 1024 * 1024;
const imageSize = 512;

export function isProfilePng(bytes: Uint8Array): boolean {
  if (bytes.byteLength > profileImageSizeLimit) return false;
  try {
    // The pixel decoder skips ancillary chunk CRCs, so validate every chunk first.
    const chunks = extractChunks(bytes);
    const names = chunks.map((chunk) => chunk.name);
    const firstData = names.indexOf("IDAT");
    const lastData = names.lastIndexOf("IDAT");
    if (
      names.filter((name) => name === "IHDR").length !== 1 ||
      firstData === -1 ||
      names.slice(firstData, lastData + 1).some((name) => name !== "IDAT") ||
      names.includes("acTL")
    )
      return false;
    const header = chunks[0]?.data;
    if (!header || header.length !== 13) return false;
    const bitDepth = header[8];
    const colorType = header[9];
    const interlace = header[12];
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) return false;

    const image = png.sync.read(Buffer.from(bytes), {
      checkCRC: true,
      maxDecodedBytes: imageSize * (imageSize * 4 + 1),
    });
    return image.width === imageSize && image.height === imageSize;
  } catch {
    return false;
  }
}
