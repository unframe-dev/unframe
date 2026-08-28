import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Diagnostic, TextureArtifact, ValidationResult } from "@unframe/presentation-core";
import { z } from "zod";

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

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const copyUint8Array = (value: unknown): Uint8Array | undefined => {
  try {
    if (!ArrayBuffer.isView(value) || !typedArrayByteLength || !typedArrayTag) return undefined;
    if (typedArrayTag.call(value) !== "Uint8Array") return undefined;
    const byteLength = typedArrayByteLength.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return undefined;
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
    return copy;
  } catch {
    return undefined;
  }
};

const positiveSafeIntegerSchema = z.number().int().safe().positive();
const encodeLimitsSchema = z.strictObject({
  maxWidth: positiveSafeIntegerSchema,
  maxHeight: positiveSafeIntegerSchema,
  maxPixels: positiveSafeIntegerSchema,
  maxInputBytes: positiveSafeIntegerSchema,
  maxOutputBytes: positiveSafeIntegerSchema,
});
const encodeRequestSchema = z.strictObject({
  sourceId: z.string().trim().min(1),
  rgba: z.instanceof(Uint8Array),
  pixelSize: z.tuple([positiveSafeIntegerSchema, positiveSafeIntegerSchema]),
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
  limits: encodeLimitsSchema,
});

type ParsedEncodeRequest = z.infer<typeof encodeRequestSchema>;

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

const snapshotRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable,
      )
    )
      return undefined;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return undefined;
  }
};

const snapshotDenseArray = (value: unknown): readonly unknown[] | undefined => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const length = descriptors["length"]?.value;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const keys = Array.from({ length }, (_, index) => String(index));
    if (
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.keys(descriptors).length !== length + 1 ||
      keys.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || descriptor.get !== undefined || descriptor.set !== undefined;
      })
    )
      return undefined;
    return keys.map((key) => descriptors[key]!.value);
  } catch {
    return undefined;
  }
};

const snapshotRequest = (value: unknown): unknown => {
  const request = snapshotRecord(value);
  if (!request) return undefined;
  return {
    ...request,
    rgba: copyUint8Array(request.rgba),
    pixelSize: snapshotDenseArray(request.pixelSize),
    limits: snapshotRecord(request.limits),
  };
};

const validationIssue = (parsed: z.ZodSafeParseError<unknown>): Diagnostic => {
  if (parsed.error.issues.length > 1)
    return diagnostic("invalid-encode-request", [], "Encode request must be an object.");
  const issue = parsed.error.issues[0];
  const path = (issue?.path ?? []).filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number",
  );
  if (path[0] === "sourceId")
    return diagnostic("invalid-source-id", path, "Source ID must be a non-empty string.");
  if (path[0] === "rgba")
    return diagnostic("invalid-rgba", path, "RGBA input must be a Uint8Array.");
  if (path[0] === "pixelSize")
    return diagnostic(
      "invalid-pixel-size",
      ["pixelSize"],
      "Pixel size must contain two positive safe integers.",
    );
  if (path[0] === "colorSpace")
    return diagnostic("unsupported-color-space", path, "Only the sRGB color space is supported.");
  if (path[0] === "alphaMode")
    return diagnostic(
      "invalid-alpha-mode",
      path,
      "Alpha mode must be opaque, straight, or premultiplied.",
    );
  if (path[0] === "limits")
    return diagnostic(
      "invalid-encode-limits",
      path,
      "Encode limits must be positive safe integers.",
    );
  return diagnostic("invalid-encode-request", path, "Encode request must be an object.");
};

const validateLimits = (
  limits: z.infer<typeof encodeLimitsSchema>,
): ValidationResult<EncodeLimits> => {
  for (const [key, limit] of Object.entries(limits) as [keyof EncodeLimits, number][]) {
    if (limit > INTERNAL_PNG_HARD_CAPS[key])
      return invalid(
        "encode-limit-above-hard-cap",
        ["limits", key],
        "Caller limits cannot exceed the package hard cap.",
      );
  }
  return { valid: true, value: limits, diagnostics: [] };
};

const validateRequest = (value: unknown): ValidationResult<ValidatedRequest> => {
  const parsed = encodeRequestSchema.safeParse(snapshotRequest(value));
  if (!parsed.success) return { valid: false, diagnostics: [validationIssue(parsed)] };
  const { sourceId, rgba, pixelSize, alphaMode } = parsed.data as ParsedEncodeRequest;
  if (alphaMode === "premultiplied")
    return invalid(
      "unsupported-alpha-mode",
      ["alphaMode"],
      "Premultiplied alpha conversion is not defined by this encoder version.",
    );

  const limits = validateLimits(parsed.data.limits);
  if (!limits.valid) return limits;

  const [width, height] = pixelSize;
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
