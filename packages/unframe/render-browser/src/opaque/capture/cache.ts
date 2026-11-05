import { deflateSync, inflateSync } from "node:zlib";
import { hash } from "../../config/config-environment.js";
import { validateOpaqueBindings } from "./bindings.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "./types.js";

type CaptureSuccess = Extract<OpaqueCaptureResult, { ok: true }>;
type CaptureRuntime = {
  readonly fingerprint: string;
  capture(input: OpaqueCaptureRequest): Promise<OpaqueCaptureResult>;
};

const reusableRgba = (input: OpaqueCaptureRequest, value: CaptureSuccess) => {
  const rgba = Buffer.from(value.rgbaBase64, "base64");
  if (
    rgba.toString("base64") !== value.rgbaBase64 ||
    rgba.length !== input.pixelTarget[0] * input.pixelTarget[1] * 4 ||
    value.pixelSize.length !== 2 ||
    value.pixelSize.some((size, index) => size !== input.pixelTarget[index]) ||
    !validateOpaqueBindings(input.expectedBindings, value.bindings).ok
  )
    return undefined;
  const buttons = new Set(Object.keys(input.buttonBindings ?? {}));
  for (const binding of value.bindings)
    if (typeof binding.disabled === "boolean") buttons.delete(binding.key);
  return buttons.size === 0 ? rgba : undefined;
};

const encodeRgba = (rgba: Buffer) => {
  const sampleLimit = 64 * 1024;
  let sample = rgba;
  if (rgba.length > sampleLimit) {
    sample = Buffer.allocUnsafe(sampleLimit);
    const sectionBytes = sampleLimit / 4;
    for (let section = 0; section < 4; section++) {
      const offset = Math.floor(((rgba.length - sectionBytes) * section) / 3);
      sample.set(rgba.subarray(offset, offset + sectionBytes), section * sectionBytes);
    }
  }
  const sampled = deflateSync(sample, { level: 1 });
  // Noisy images should not pay for a full compression pass with negligible savings.
  if (sampled.length >= sample.length * 0.9) return { rgba, encoding: "raw" as const };
  const compressed = sample === rgba ? sampled : deflateSync(rgba, { level: 1 });
  return compressed.length < rgba.length
    ? { rgba: compressed, encoding: "deflate" as const }
    : { rgba, encoding: "raw" as const };
};

export type OpaqueCaptureCacheStats = {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
  /** Stored RGBA and UTF-8 metadata/key bytes, excluding JavaScript object overhead. */
  readonly bytes: number;
};

export type OpaqueCaptureCache = {
  capture(
    runtime: CaptureRuntime,
    input: OpaqueCaptureRequest,
    signal?: AbortSignal,
  ): Promise<OpaqueCaptureResult>;
  clear(): void;
  stats(): OpaqueCaptureCacheStats;
};

export const createOpaqueCaptureCache = (
  options: { readonly maxBytes?: number } = {},
): OpaqueCaptureCache => {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("Invalid opaque capture cache byte limit");
  const entries = new Map<
    string,
    {
      value: Omit<CaptureSuccess, "rgbaBase64">;
      rgba: Buffer;
      encoding: "raw" | "deflate";
      rgbaBytes: number;
      bytes: number;
    }
  >();
  let hits = 0;
  let misses = 0;
  let bytes = 0;
  let generation = 0;
  return {
    async capture(runtime, input, signal) {
      signal?.throwIfAborted();
      const snapshot = structuredClone(input);
      const key = hash({ runtime: runtime.fingerprint, input: snapshot });
      const cached = entries.get(key);
      if (cached) {
        try {
          const rgba =
            cached.encoding === "deflate"
              ? inflateSync(cached.rgba, { maxOutputLength: cached.rgbaBytes })
              : cached.rgba;
          if (rgba.length !== cached.rgbaBytes) throw new Error("Invalid cached RGBA length");
          const value = { ...structuredClone(cached.value), rgbaBase64: rgba.toString("base64") };
          hits++;
          entries.delete(key);
          entries.set(key, cached);
          return value;
        } catch {
          entries.delete(key);
          bytes -= cached.bytes;
        }
      }
      misses++;
      const currentGeneration = generation;
      const captured = await runtime.capture(snapshot);
      signal?.throwIfAborted();
      if (maxBytes > 0 && captured.ok && currentGeneration === generation) {
        try {
          const rgba = reusableRgba(snapshot, captured);
          if (!rgba) return captured;
          const { rgbaBase64: _rgbaBase64, ...metadata } = captured;
          const value = structuredClone(metadata);
          const encoded = encodeRgba(rgba);
          const size =
            encoded.rgba.byteLength +
            Buffer.byteLength(key) +
            Buffer.byteLength(
              JSON.stringify({ value, encoding: encoded.encoding, rgbaBytes: rgba.length }),
            );
          if (size <= maxBytes) {
            const previous = entries.get(key);
            if (previous) {
              bytes -= previous.bytes;
              entries.delete(key);
            }
            while (bytes + size > maxBytes) {
              const oldest = entries.entries().next().value;
              if (!oldest) break;
              entries.delete(oldest[0]);
              bytes -= oldest[1].bytes;
            }
            entries.set(key, { value, ...encoded, rgbaBytes: rgba.length, bytes: size });
            bytes += size;
          }
        } catch {
          // A cache codec failure must not discard a successful browser capture.
        }
      }
      return captured;
    },
    clear() {
      generation++;
      entries.clear();
      hits = 0;
      misses = 0;
      bytes = 0;
    },
    stats: () => ({ hits, misses, entries: entries.size, bytes }),
  };
};
