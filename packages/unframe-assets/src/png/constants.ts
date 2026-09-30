import type { EncodeLimits } from "../public-types.js";

export const INTERNAL_PNG_HARD_CAPS = Object.freeze({
  maxHeight: 4096,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 65 * 1024 * 1024,
  maxPixels: 16_777_216,
  maxWidth: 4096,
});

export const PNG_ABSOLUTE_LIMITS: Readonly<EncodeLimits> = Object.freeze({
  ...INTERNAL_PNG_HARD_CAPS,
});

export const PNG_ENCODER_IDENTITY = Object.freeze({
  encoderId: "unframe-memory-png" as const,
  fingerprint: "png-rgba8-srgb-filter0-store-v1" as const,
  version: "1" as const,
});
