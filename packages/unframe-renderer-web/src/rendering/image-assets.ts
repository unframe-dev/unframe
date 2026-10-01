import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PNG } from "pngjs";
import type {
  CompilerResolvedSurfaceInput,
  RendererBuildFailure,
} from "@unframe/unframe-renderer-api";

export const imageDataUri = (
  assetId: string,
  asset: NonNullable<CompilerResolvedSurfaceInput["imageAssets"]>[string],
): string | RendererBuildFailure => {
  const invalid = (code: string, message: string): RendererBuildFailure => ({
    ok: false,
    diagnostics: [{ code, message, path: ["imageAssets", assetId] }],
  });
  if (
    asset.dataBase64.length > Math.ceil((16 * 1024 * 1024) / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.dataBase64)
  )
    return invalid("invalid-image-asset", "Image data must be canonical base64.");
  const bytes = Uint8Array.from(Buffer.from(asset.dataBase64, "base64"));
  if (
    bytes.length === 0 ||
    bytes.length > 16 * 1024 * 1024 ||
    Buffer.from(bytes).toString("base64") !== asset.dataBase64
  )
    return invalid("invalid-image-asset", "Image data must be canonical base64.");
  if (`sha256:${bytesToHex(sha256(bytes))}` !== asset.checksum)
    return invalid("image-asset-checksum-mismatch", "Image checksum does not match its bytes.");
  const png =
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  const jpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
  if (!(asset.mediaType === "image/png" ? png : jpeg))
    return invalid("image-asset-signature-mismatch", "Image bytes do not match media type.");
  let width = 0;
  let height = 0;
  if (asset.mediaType === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR")
      return invalid("invalid-image-asset", "PNG is missing its IHDR chunk.");
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else {
    let offset = 2;
    while (offset + 4 <= bytes.length && width === 0) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 7) break;
        height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
        width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_777_216)
    return invalid(
      "image-asset-dimensions-exceeded",
      "Image dimensions exceed the fixed resource budget.",
    );
  if (asset.mediaType === "image/png") {
    try {
      const decoded = PNG.sync.read(Buffer.from(bytes));
      if (decoded.width !== width || decoded.height !== height)
        return invalid("invalid-image-asset", "PNG dimensions changed during decode.");
    } catch {
      return invalid("invalid-image-asset", "PNG could not be decoded.");
    }
  }
  return `data:${asset.mediaType};base64,${asset.dataBase64}`;
};
