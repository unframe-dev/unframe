import type { EncodeLimits } from "../public-types.js";

export const INTERNAL_PNG_HARD_CAPS = Object.freeze({
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
