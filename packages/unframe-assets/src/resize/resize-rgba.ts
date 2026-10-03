import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ValidationResult } from "@unframe/unframe-core";

import { INTERNAL_PNG_HARD_CAPS } from "../png/constants.js";
import type { ResizeRequest, ResizedRgba } from "../public-types.js";
import { resizeRequestSchema } from "../validation/schemas.js";

export const RESIZE_IDENTITY = Object.freeze({
  transformerId: "unframe-memory-rgba-resize" as const,
  version: "1" as const,
  fingerprint: "linear-srgb-associated-alpha-box-linear-v1" as const,
});

const invalid = <T>(
  code: string,
  path: readonly (string | number)[],
  message: string,
): ValidationResult<T> => ({
  valid: false,
  diagnostics: [{ code, path, message }],
});

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;

const snapshotBytes = (value: unknown, expectedLength?: number): Uint8Array | undefined => {
  try {
    if (!ArrayBuffer.isView(value) || !typedArrayByteLength || !typedArrayTag) return undefined;
    if (typedArrayTag.call(value) !== "Uint8Array") return undefined;
    const length = typedArrayByteLength.call(value);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > INTERNAL_PNG_HARD_CAPS.maxInputBytes ||
      (expectedLength !== undefined && length !== expectedLength)
    )
      return undefined;
    const copy = new Uint8Array(length);
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
    return copy;
  } catch {
    return undefined;
  }
};

const snapshotRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((item) => item.get || item.set || !item.enumerable))
      return undefined;
    return Object.fromEntries(Object.entries(descriptors).map(([key, item]) => [key, item.value]));
  } catch {
    return undefined;
  }
};

const snapshotPair = (value: unknown): readonly unknown[] | undefined => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (descriptors["length"]?.value !== 2 || Object.keys(descriptors).length !== 3)
      return undefined;
    if (!["0", "1"].every((key) => descriptors[key]?.enumerable && "value" in descriptors[key]))
      return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    return [descriptors["0"]!.value, descriptors["1"]!.value];
  } catch {
    return undefined;
  }
};

const snapshotRequest = (input: unknown): unknown => {
  const record = snapshotRecord(input);
  if (!record) return undefined;
  const pixelSize = snapshotPair(record.pixelSize);
  const [width, height] = pixelSize ?? [];
  const expectedLength =
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0
      ? width * height * 4
      : undefined;
  return {
    ...record,
    rgba: snapshotBytes(record.rgba, expectedLength),
    pixelSize,
    targetPixelSize: snapshotPair(record.targetPixelSize),
    limits: snapshotRecord(record.limits),
  };
};

const srgbToLinear = (byte: number) => {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

const linearToSrgbByte = (channel: number) => {
  const clamped = Math.min(1, Math.max(0, channel));
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

// A box footprint averages downscales; a unit-width linear footprint interpolates upscales.
const weights = (sourceSize: number, targetSize: number, targetIndex: number) => {
  const scale = sourceSize / targetSize;
  const center = (targetIndex + 0.5) * scale;
  if (scale < 1) {
    const lower = Math.max(0, Math.min(sourceSize - 1, Math.floor(center - 0.5)));
    const upper = Math.max(0, Math.min(sourceSize - 1, lower + 1));
    const fraction = Math.max(0, Math.min(1, center - 0.5 - lower));
    return lower === upper
      ? [{ index: lower, weight: 1 }]
      : [
          { index: lower, weight: 1 - fraction },
          { index: upper, weight: fraction },
        ];
  }
  const radius = Math.max(0.5, scale / 2);
  const first = Math.max(0, Math.floor(center - radius - 0.5));
  const last = Math.min(sourceSize - 1, Math.ceil(center + radius + 0.5));
  const samples: { index: number; weight: number }[] = [];
  for (let index = first; index <= last; index++) {
    const left = Math.max(center - radius, index);
    const right = Math.min(center + radius, index + 1);
    const weight = Math.max(0, right - left);
    if (weight > 0) samples.push({ index, weight });
  }
  return samples;
};

const digest = (bytes: Uint8Array) => `sha256:${bytesToHex(sha256(bytes))}`;

export function resizeRgba(input: ResizeRequest): ValidationResult<ResizedRgba>;
export function resizeRgba(input: unknown): ValidationResult<ResizedRgba>;
export function resizeRgba(input: unknown): ValidationResult<ResizedRgba> {
  try {
    const parsed = resizeRequestSchema.safeParse(snapshotRequest(input));
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      const field = path[0];
      const code =
        field === "targetPixelSize"
          ? "invalid-target-pixel-size"
          : field === "pixelSize"
            ? "invalid-pixel-size"
            : field === "rgba"
              ? "invalid-rgba"
              : field === "limits"
                ? "invalid-resize-limits"
                : "invalid-resize-request";
      return invalid(
        code,
        path.filter(
          (part): part is string | number => typeof part === "string" || typeof part === "number",
        ),
        "Invalid RGBA resize request.",
      );
    }
    const { sourceId, rgba, pixelSize, targetPixelSize, alphaMode, limits } = parsed.data;
    if (alphaMode === "premultiplied")
      return invalid(
        "unsupported-alpha-mode",
        ["alphaMode"],
        "Premultiplied alpha is unsupported.",
      );
    for (const [key, value] of Object.entries(limits) as [keyof typeof limits, number][]) {
      if (value > INTERNAL_PNG_HARD_CAPS[key])
        return invalid(
          "resize-limit-above-hard-cap",
          ["limits", key],
          "Resize limit exceeds the package hard cap.",
        );
    }
    const [sourceWidth, sourceHeight] = pixelSize;
    const [targetWidth, targetHeight] = targetPixelSize;
    const inputBytes = sourceWidth * sourceHeight * 4;
    const outputBytes = targetWidth * targetHeight * 4;
    if (
      [sourceWidth, targetWidth].some((size) => size > INTERNAL_PNG_HARD_CAPS.maxWidth) ||
      [sourceHeight, targetHeight].some((size) => size > INTERNAL_PNG_HARD_CAPS.maxHeight) ||
      sourceWidth * sourceHeight > INTERNAL_PNG_HARD_CAPS.maxPixels ||
      targetWidth * targetHeight > INTERNAL_PNG_HARD_CAPS.maxPixels ||
      inputBytes > INTERNAL_PNG_HARD_CAPS.maxInputBytes ||
      outputBytes > INTERNAL_PNG_HARD_CAPS.maxInputBytes
    )
      return invalid(
        "rgba-hard-cap-exceeded",
        ["pixelSize"],
        "RGBA dimensions exceed the package hard cap.",
      );
    if (rgba.length !== inputBytes)
      return invalid(
        "rgba-length-mismatch",
        ["rgba"],
        "RGBA byte length does not match dimensions.",
      );
    if (
      sourceWidth > limits.maxWidth ||
      targetWidth > limits.maxWidth ||
      sourceHeight > limits.maxHeight ||
      targetHeight > limits.maxHeight ||
      sourceWidth * sourceHeight > limits.maxPixels ||
      targetWidth * targetHeight > limits.maxPixels ||
      inputBytes > limits.maxInputBytes ||
      outputBytes > limits.maxOutputBytes
    )
      return invalid("resize-limit-exceeded", ["limits"], "RGBA resize exceeds caller limits.");
    if (alphaMode === "opaque") {
      for (let offset = 3; offset < rgba.length; offset += 4) {
        if (rgba[offset] !== 255)
          return invalid(
            "opaque-alpha-mismatch",
            ["rgba", offset],
            "Opaque input requires alpha 255.",
          );
      }
    }
    const output = new Uint8Array(outputBytes);
    for (let y = 0; y < targetHeight; y++) {
      const yWeights = weights(sourceHeight, targetHeight, y);
      for (let x = 0; x < targetWidth; x++) {
        const xWeights = weights(sourceWidth, targetWidth, x);
        const channels = [0, 0, 0];
        let alphaSum = 0;
        let weightSum = 0;
        for (const yw of yWeights)
          for (const xw of xWeights) {
            const weight = xw.weight * yw.weight;
            const offset = (yw.index * sourceWidth + xw.index) * 4;
            const alpha = rgba[offset + 3]! / 255;
            alphaSum += alpha * weight;
            weightSum += weight;
            for (let channel = 0; channel < 3; channel++)
              channels[channel]! += srgbToLinear(rgba[offset + channel]!) * alpha * weight;
          }
        const offset = (y * targetWidth + x) * 4;
        const outputAlpha = alphaMode === "opaque" ? 255 : Math.round((alphaSum / weightSum) * 255);
        for (let channel = 0; channel < 3; channel++)
          output[offset + channel] =
            outputAlpha === 0 ? 0 : linearToSrgbByte(channels[channel]! / alphaSum);
        output[offset + 3] = outputAlpha;
      }
    }
    return {
      valid: true,
      value: {
        sourceId,
        rgba: output,
        pixelSize: [targetWidth, targetHeight],
        colorSpace: "srgb",
        alphaMode,
        sourceChecksum: digest(rgba),
        checksum: digest(output),
        provenance: RESIZE_IDENTITY,
      },
      diagnostics: [],
    };
  } catch {
    return invalid(
      "invalid-resize-request",
      [],
      "RGBA resize request could not be inspected safely.",
    );
  }
}
