import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  CompilerResolvedSurfaceInput,
  RendererBuildFailure,
} from "@unframe/unframe-renderer-api";

const failure = (
  code: string,
  message: string,
  path: ReadonlyArray<string | number>,
): RendererBuildFailure => ({
  diagnostics: [{ code, message, path }],
  ok: false,
});

const cssString = (value: string) => JSON.stringify(value);
export const fontFamilyForChecksum = (checksum: string) => `unframe-font-${checksum.slice(7, 23)}`;

export type FontCoverage = (codePoint: number) => boolean;

const fontCoverage = (bytes: Uint8Array): FontCoverage | undefined => {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readU16 = (offset: number) => {
      if (offset < 0 || offset + 2 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint16(offset);
    };
    const readU32 = (offset: number) => {
      if (offset < 0 || offset + 4 > bytes.length) {
        throw new RangeError();
      }
      return view.getUint32(offset);
    };
    const tableCount = readU16(4);
    let cmapOffset = -1;
    let cmapLength = 0;
    for (let index = 0; index < tableCount; index++) {
      const record = 12 + index * 16;
      const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
      if (tag !== "cmap") {
        continue;
      }
      cmapOffset = readU32(record + 8);
      cmapLength = readU32(record + 12);
      if (cmapOffset + cmapLength > bytes.length) {
        return undefined;
      }
      break;
    }
    if (cmapOffset < 0 || readU16(cmapOffset) !== 0) {
      return undefined;
    }
    const subtableCount = readU16(cmapOffset + 2);
    const coverages: Array<FontCoverage> = [];
    for (let index = 0; index < subtableCount; index++) {
      const record = cmapOffset + 4 + index * 8;
      const platform = readU16(record);
      const encoding = readU16(record + 2);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) {
        continue;
      }
      const offset = cmapOffset + readU32(record + 4);
      const format = readU16(offset);
      if (format === 12) {
        const length = readU32(offset + 4);
        const groupCount = readU32(offset + 12);
        if (offset + length > cmapOffset + cmapLength || 16 + groupCount * 12 > length) {
          return undefined;
        }
        coverages.push((codePoint) => {
          for (let group = 0; group < groupCount; group++) {
            const start = readU32(offset + 16 + group * 12);
            const end = readU32(offset + 20 + group * 12);
            if (codePoint < start) {
              return false;
            }
            if (codePoint <= end) {
              return (readU32(offset + 24 + group * 12) + codePoint - start) % 0x1_00_00 !== 0;
            }
          }
          return false;
        });
      } else if (format === 4) {
        const length = readU16(offset + 2);
        const segmentCount = readU16(offset + 6) / 2;
        if (
          !Number.isSafeInteger(segmentCount) ||
          segmentCount <= 0 ||
          offset + length > cmapOffset + cmapLength
        ) {
          return undefined;
        }
        const endCodes = offset + 14;
        const startCodes = endCodes + segmentCount * 2 + 2;
        const deltas = startCodes + segmentCount * 2;
        const rangeOffsets = deltas + segmentCount * 2;
        if (rangeOffsets + segmentCount * 2 > offset + length) {
          return undefined;
        }
        coverages.push((codePoint) => {
          if (codePoint > 0xff_ff) {
            return false;
          }
          for (let segment = 0; segment < segmentCount; segment++) {
            const end = readU16(endCodes + segment * 2);
            if (codePoint > end) {
              continue;
            }
            const start = readU16(startCodes + segment * 2);
            if (codePoint < start) {
              return false;
            }
            const delta = readU16(deltas + segment * 2);
            const rangeOffset = readU16(rangeOffsets + segment * 2);
            if (rangeOffset === 0) {
              return ((codePoint + delta) & 0xff_ff) !== 0;
            }
            const glyphOffset = rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
            if (glyphOffset + 2 > offset + length) {
              return false;
            }
            const glyph = readU16(glyphOffset);
            return glyph !== 0 && ((glyph + delta) & 0xff_ff) !== 0;
          }
          return false;
        });
      }
    }
    return coverages.length > 0
      ? (codePoint) => coverages.some((supports) => supports(codePoint))
      : undefined;
  } catch {
    return undefined;
  }
};

export const decodeFontAsset = (
  assetId: string,
  asset: CompilerResolvedSurfaceInput["fontAssets"][string],
):
  | { readonly face: string; readonly family: string; readonly supports: FontCoverage }
  | RendererBuildFailure => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.dataBase64)) {
    return failure("invalid-font-asset", "Font asset data must be canonical base64.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  }
  const bytes = Uint8Array.from(Buffer.from(asset.dataBase64, "base64"));
  if (bytes.length === 0 || Buffer.from(bytes).toString("base64") !== asset.dataBase64) {
    return failure("invalid-font-asset", "Font asset data must be canonical base64.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  }
  const checksum = `sha256:${bytesToHex(sha256(bytes))}`;
  if (checksum !== asset.checksum) {
    return failure(
      "font-asset-checksum-mismatch",
      "Font asset checksum does not match its bytes.",
      ["fontAssets", assetId, "checksum"],
    );
  }
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const validSignature =
    asset.mediaType === "font/otf"
      ? signature === "OTTO"
      : bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
  if (!validSignature) {
    return failure(
      "font-asset-signature-mismatch",
      "Font bytes do not match the declared media type.",
      ["fontAssets", assetId, "mediaType"],
    );
  }
  const supports = fontCoverage(bytes);
  if (!supports) {
    return failure("invalid-font-asset", "Font asset must contain a valid Unicode cmap.", [
      "fontAssets",
      assetId,
      "dataBase64",
    ]);
  }
  const family = fontFamilyForChecksum(asset.checksum);
  const format = asset.mediaType === "font/otf" ? "opentype" : "truetype";
  return {
    face: `@font-face{font-family:${cssString(family)};src:url("data:${asset.mediaType};base64,${asset.dataBase64}") format("${format}");font-style:normal;font-weight:400 700;font-display:block}`,
    family,
    supports,
  };
};
