import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Diagnostic, TextureArtifact, ValidationResult } from "@unframe/presentation-core";

const INTERNAL_PNG_HARD_CAPS = Object.freeze({
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxPixels: 16_777_216,
  maxInputBytes: 64 * 1_024 * 1_024,
  maxOutputBytes: 65 * 1_024 * 1_024,
});

export const PNG_ABSOLUTE_LIMITS: Readonly<EncodeLimits> = Object.freeze({
  ...INTERNAL_PNG_HARD_CAPS,
});
export const PNG_ENCODER_IDENTITY = Object.freeze({
  encoderId: "unframe-memory-png" as const,
  version: "1" as const,
  fingerprint: "png-rgba8-srgb-filter0-store-v1" as const,
});

export type RgbaInput = Uint8Array;

export type EncodeLimits = {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
};

export type EncodeRequest = {
  readonly sourceId: string;
  readonly rgba: RgbaInput;
  readonly pixelSize: readonly [number, number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
  readonly limits: EncodeLimits;
};

export type EncodedTextureArtifact = {
  readonly descriptor: TextureArtifact;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sourceId: string;
  readonly provenance: {
    readonly encoderId: "unframe-memory-png";
    readonly version: "1";
    readonly fingerprint: "png-rgba8-srgb-filter0-store-v1";
  };
};

type ValidatedRequest = {
  sourceId: string;
  rgba: Uint8Array;
  width: number;
  height: number;
  alphaMode: "opaque" | "straight";
  outputBytes: number;
};

type PngPlan = {
  rowBytes: number;
  scanlineBytes: number;
  blockCount: number;
  zlibBytes: number;
  outputBytes: number;
};

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const SRGB_INTENT = Uint8Array.of(0);
const EMPTY_BYTES = new Uint8Array();
const ADLER_MODULUS = 65_521;
const STORED_BLOCK_SIZE = 65_535;

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit++)
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});

const diagnostic = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): Diagnostic => ({
  code,
  path,
  message,
});

const invalid = <T>(
  code: string,
  path: readonly (string | number)[],
  message: string,
): ValidationResult<T> => ({
  valid: false,
  diagnostics: [diagnostic(code, path, message)],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const createPngPlan = (width: number, height: number): PngPlan => {
  const rowBytes = width * 4;
  const scanlineBytes = height * (rowBytes + 1);
  const blockCount = Math.ceil(scanlineBytes / STORED_BLOCK_SIZE);
  const zlibBytes = 2 + blockCount * 5 + scanlineBytes + 4;
  return {
    rowBytes,
    scanlineBytes,
    blockCount,
    zlibBytes,
    outputBytes: 70 + zlibBytes,
  };
};

const validateLimits = (value: unknown): ValidationResult<EncodeLimits> => {
  if (!isRecord(value))
    return invalid("invalid-encode-limits", ["limits"], "Encode limits must be an object.");

  const keys = ["maxWidth", "maxHeight", "maxPixels", "maxInputBytes", "maxOutputBytes"] as const;
  const limits = {} as Record<(typeof keys)[number], number>;
  for (const key of keys) {
    const limit = value[key];
    if (!isPositiveSafeInteger(limit))
      return invalid(
        "invalid-encode-limits",
        ["limits", key],
        "Encode limits must be positive safe integers.",
      );
    if (limit > INTERNAL_PNG_HARD_CAPS[key])
      return invalid(
        "encode-limit-above-hard-cap",
        ["limits", key],
        "Caller limits cannot exceed the package hard cap.",
      );
    limits[key] = limit;
  }

  return {
    valid: true,
    value: {
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxPixels: limits.maxPixels,
      maxInputBytes: limits.maxInputBytes,
      maxOutputBytes: limits.maxOutputBytes,
    },
    diagnostics: [],
  };
};

const validateRequest = (value: unknown): ValidationResult<ValidatedRequest> => {
  if (!isRecord(value))
    return invalid("invalid-encode-request", [], "Encode request must be an object.");

  const sourceId = value.sourceId;
  const rgba = value.rgba;
  const pixelSize = value.pixelSize;
  const colorSpace = value.colorSpace;
  const alphaMode = value.alphaMode;
  const requestedLimits = value.limits;

  if (typeof sourceId !== "string" || sourceId.trim().length === 0)
    return invalid("invalid-source-id", ["sourceId"], "Source ID must be a non-empty string.");
  if (!isUint8Array(rgba))
    return invalid("invalid-rgba", ["rgba"], "RGBA input must be a Uint8Array.");
  const pixelSizeArray = Array.isArray(pixelSize) ? pixelSize : undefined;
  const pixelSizeLength = pixelSizeArray?.length ?? -1;
  const widthValue = pixelSizeLength === 2 ? pixelSizeArray?.[0] : undefined;
  const heightValue = pixelSizeLength === 2 ? pixelSizeArray?.[1] : undefined;
  if (
    pixelSizeLength !== 2 ||
    !isPositiveSafeInteger(widthValue) ||
    !isPositiveSafeInteger(heightValue)
  )
    return invalid(
      "invalid-pixel-size",
      ["pixelSize"],
      "Pixel size must contain two positive safe integers.",
    );
  if (colorSpace !== "srgb")
    return invalid(
      "unsupported-color-space",
      ["colorSpace"],
      "Only the sRGB color space is supported.",
    );
  if (alphaMode !== "opaque" && alphaMode !== "straight" && alphaMode !== "premultiplied")
    return invalid(
      "invalid-alpha-mode",
      ["alphaMode"],
      "Alpha mode must be opaque, straight, or premultiplied.",
    );
  if (alphaMode === "premultiplied")
    return invalid(
      "unsupported-alpha-mode",
      ["alphaMode"],
      "Premultiplied alpha conversion is not defined by this encoder version.",
    );

  const limits = validateLimits(requestedLimits);
  if (!limits.valid) return limits;

  const width = widthValue;
  const height = heightValue;
  const pixels = width * height;
  const inputBytes = pixels * 4;
  if (
    width > INTERNAL_PNG_HARD_CAPS.maxWidth ||
    height > INTERNAL_PNG_HARD_CAPS.maxHeight ||
    pixels > INTERNAL_PNG_HARD_CAPS.maxPixels ||
    inputBytes > INTERNAL_PNG_HARD_CAPS.maxInputBytes
  )
    return invalid(
      "png-hard-cap-exceeded",
      ["pixelSize"],
      "PNG dimensions or input bytes exceed the package hard cap.",
    );
  if (rgba.length !== inputBytes)
    return invalid(
      "rgba-length-mismatch",
      ["rgba"],
      "RGBA byte length must equal width multiplied by height multiplied by four.",
    );

  const plan = createPngPlan(width, height);
  if (plan.outputBytes > INTERNAL_PNG_HARD_CAPS.maxOutputBytes)
    return invalid(
      "png-hard-cap-exceeded",
      ["limits", "maxOutputBytes"],
      "Predicted PNG bytes exceed the package hard cap.",
    );
  if (
    width > limits.value.maxWidth ||
    height > limits.value.maxHeight ||
    pixels > limits.value.maxPixels ||
    inputBytes > limits.value.maxInputBytes ||
    plan.outputBytes > limits.value.maxOutputBytes
  )
    return invalid(
      "encode-limit-exceeded",
      ["limits"],
      "Input or predicted output exceeds the caller-provided encode limits.",
    );

  if (alphaMode === "opaque") {
    for (let offset = 3; offset < rgba.length; offset += 4) {
      if (rgba[offset] !== 255)
        return invalid(
          "opaque-alpha-mismatch",
          ["rgba", offset],
          "Opaque RGBA input must use alpha 255 for every pixel.",
        );
    }
  }

  return {
    valid: true,
    value: {
      sourceId,
      rgba,
      width,
      height,
      alphaMode,
      outputBytes: plan.outputBytes,
    },
    diagnostics: [],
  };
};

const writeU32 = (bytes: Uint8Array, offset: number, value: number) => {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value >>> 0);
};

const writeU16Le = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8;
};

const writeAscii = (bytes: Uint8Array, offset: number, value: string) => {
  for (let index = 0; index < value.length; index++)
    bytes[offset + index] = value.charCodeAt(index);
};

const crc32 = (bytes: Uint8Array) => {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
};

const writeChunk = (output: Uint8Array, offset: number, type: string, data: Uint8Array) => {
  writeU32(output, offset, data.length);
  writeAscii(output, offset + 4, type);
  output.set(data, offset + 8);
  writeU32(
    output,
    offset + 8 + data.length,
    crc32(output.subarray(offset + 4, offset + 8 + data.length)),
  );
  return offset + 12 + data.length;
};

const writeIdat = (output: Uint8Array, offset: number, rgba: Uint8Array, plan: PngPlan) => {
  writeU32(output, offset, plan.zlibBytes);
  writeAscii(output, offset + 4, "IDAT");
  let cursor = offset + 8;
  output[cursor++] = 0x78;
  output[cursor++] = 0x01;

  let scanlineOffset = 0;
  let rowPosition = 0;
  let rgbaOffset = 0;
  let adlerA = 1;
  let adlerB = 0;
  for (let blockIndex = 0; blockIndex < plan.blockCount; blockIndex++) {
    const blockLength = Math.min(STORED_BLOCK_SIZE, plan.scanlineBytes - scanlineOffset);
    output[cursor++] = blockIndex === plan.blockCount - 1 ? 1 : 0;
    writeU16Le(output, cursor, blockLength);
    cursor += 2;
    writeU16Le(output, cursor, ~blockLength & 0xffff);
    cursor += 2;

    for (let index = 0; index < blockLength; index++, scanlineOffset++) {
      const byte = rowPosition === 0 ? 0 : rgba[rgbaOffset++]!;
      output[cursor++] = byte;
      adlerA = (adlerA + byte) % ADLER_MODULUS;
      adlerB = (adlerB + adlerA) % ADLER_MODULUS;
      rowPosition = rowPosition === plan.rowBytes ? 0 : rowPosition + 1;
    }
  }

  writeU32(output, cursor, (adlerB << 16) | adlerA);
  cursor += 4;
  writeU32(output, cursor, crc32(output.subarray(offset + 4, cursor)));
  return cursor + 4;
};

const encodeValidated = (request: ValidatedRequest): ValidationResult<EncodedTextureArtifact> => {
  const plan = createPngPlan(request.width, request.height);
  if (plan.outputBytes !== request.outputBytes)
    return invalid("png-encode-failed", [], "Validated PNG plan changed before encoding.");

  const output = new Uint8Array(plan.outputBytes);
  output.set(PNG_SIGNATURE);
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, request.width);
  writeU32(ihdr, 4, request.height);
  ihdr.set([8, 6, 0, 0, 0], 8);

  let cursor = writeChunk(output, PNG_SIGNATURE.length, "IHDR", ihdr);
  cursor = writeChunk(output, cursor, "sRGB", SRGB_INTENT);
  cursor = writeIdat(output, cursor, request.rgba, plan);
  cursor = writeChunk(output, cursor, "IEND", EMPTY_BYTES);
  if (cursor !== output.length)
    return invalid("png-encode-failed", [], "PNG encoder produced an unexpected byte length.");

  const checksum = `sha256:${bytesToHex(sha256(output))}`;
  return {
    valid: true,
    value: {
      descriptor: {
        assetId: checksum,
        mediaType: "image/png",
        pixelSize: [request.width, request.height],
        checksum,
        colorSpace: "srgb",
        alphaMode: request.alphaMode,
      },
      bytes: output,
      byteLength: output.length,
      sourceId: request.sourceId,
      provenance: {
        ...PNG_ENCODER_IDENTITY,
      },
    },
    diagnostics: [],
  };
};

export function encodeRgbaToPng(input: EncodeRequest): ValidationResult<EncodedTextureArtifact>;
export function encodeRgbaToPng(input: unknown): ValidationResult<EncodedTextureArtifact>;
export function encodeRgbaToPng(input: unknown): ValidationResult<EncodedTextureArtifact> {
  try {
    const validation = validateRequest(input);
    if (!validation.valid) return validation;
    try {
      return encodeValidated(validation.value);
    } catch {
      return invalid("png-encode-failed", [], "PNG encoding failed.");
    }
  } catch {
    return invalid("invalid-encode-request", [], "Encode request could not be inspected safely.");
  }
}
