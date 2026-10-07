import { createHash } from "node:crypto";
import { decodeFontAsset } from "../../rendering/font-assets.js";
import type { OpaqueCaptureRequest } from "./types.js";
const dimensions = (width: number, height: number) =>
  width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 4_194_304;
export const validateOpaqueAsset = (asset: OpaqueCaptureRequest["assets"][number]): boolean => {
  const bytes = Buffer.from(asset.dataBase64, "base64");
  if (
    !bytes.length ||
    bytes.length > 64 * 1024 * 1024 ||
    bytes.toString("base64") !== asset.dataBase64
  )
    return false;
  if (asset.mediaType === "text/css") return asset.path.endsWith(".css");
  if (asset.mediaType === "font/ttf" || asset.mediaType === "font/otf") {
    if (!asset.path.endsWith(asset.mediaType === "font/ttf" ? ".ttf" : ".otf")) return false;
    const result = decodeFontAsset(asset.path, {
      mediaType: asset.mediaType,
      dataBase64: asset.dataBase64,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
    return !("ok" in result);
  }
  if (asset.mediaType === "image/png" && asset.path.endsWith(".png")) {
    if (
      bytes.length < 33 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      !dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    )
      return false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (kind === "acTL" || offset + length + 12 > bytes.length) return false;
      offset += length + 12;
      if (kind === "IEND") return offset === bytes.length;
    }
    return false;
  }
  if (asset.mediaType === "image/webp" && asset.path.endsWith(".webp")) {
    if (
      bytes.length < 30 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) + 8 !== bytes.length
    )
      return false;
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return (
        (bytes[20]! & 2) === 0 &&
        dimensions(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3))
      );
    if (kind === "VP8 ")
      return (
        bytes.toString("hex", 23, 26) === "9d012a" &&
        dimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
      );
    if (kind === "VP8L")
      return (
        bytes[20] === 0x2f &&
        dimensions(
          1 + ((bytes[21]! | (bytes[22]! << 8)) & 0x3fff),
          1 + ((bytes.readUInt32LE(21) >>> 14) & 0x3fff),
        )
      );
    return false;
  }
  if (asset.mediaType === "image/jpeg" && /\.jpe?g$/.test(asset.path)) {
    if (bytes[0] !== 255 || bytes[1] !== 216) return false;
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 255) return false;
      const kind = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return false;
      if ([0xc0, 0xc1, 0xc2].includes(kind))
        return (
          length >= 8 && dimensions(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5))
        );
      offset += length + 2;
    }
  }
  return false;
};
