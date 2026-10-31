/// <reference types="node" />
// oxlint-disable-next-line typescript/triple-slash-reference -- RPC consumers need the ambient declaration without a runtime import.
/// <reference path="./pngjs-browser.d.ts" />
import { Buffer } from "node:buffer";
import { crc32, inflateSync } from "node:zlib";
import { PNG } from "pngjs/browser";

export const profileImageSizeLimit = 2 * 1024 * 1024;
const imageSize = 512;

export function isProfilePng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 33 || bytes.byteLength > profileImageSizeLimit) return false;
  const input = Buffer.from(bytes);
  if (
    input.readUInt32BE(16) !== imageSize ||
    input.readUInt32BE(20) !== imageSize ||
    input[24] !== 8 ||
    (input[25] !== 2 && input[25] !== 6) ||
    input[28] !== 0
  )
    return false;

  try {
    const data: Buffer[] = [];
    let dataEnded = false;
    let ended = false;
    for (let offset = 8; offset < input.length;) {
      if (offset + 12 > input.length) return false;
      const length = input.readUInt32BE(offset);
      const end = offset + length + 12;
      if (end > input.length) return false;
      const name = input.toString("ascii", offset + 4, offset + 8);
      if (crc32(input.subarray(offset + 4, end - 4)) !== input.readUInt32BE(end - 4)) return false;
      if (offset === 8) {
        if (name !== "IHDR" || length !== 13) return false;
      } else if (name === "IHDR" || name === "acTL") {
        return false;
      } else if (name === "IDAT") {
        if (dataEnded) return false;
        data.push(input.subarray(offset + 8, end - 4));
      } else if (name === "IEND") {
        if (length !== 0 || end !== input.length) return false;
        ended = true;
      } else if (data.length) {
        dataEnded = true;
      }
      offset = end;
    }
    if (!ended || !data.length) return false;
    // pngjs truncates excess scanlines; validate the complete zlib stream with a bounded output first.
    const expectedBytes = imageSize * (imageSize * (input[25] === 6 ? 4 : 3) + 1);
    if (
      inflateSync(Buffer.concat(data), { maxOutputLength: expectedBytes }).length !== expectedBytes
    )
      return false;
    // The bundled browser decoder avoids Node zlib internals unavailable in Workers.
    PNG.sync.read(input, { checkCRC: true });
    return true;
  } catch {
    return false;
  }
}
