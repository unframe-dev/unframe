import { z } from "zod";

const size = z.number().int().safe().positive();
const count = z.number().int().safe().nonnegative();
export const modelLimitsSchema = z.strictObject({
  maxInputBytes: size,
  maxOutputBytes: size,
  maxDecodedAccessorBytes: size,
  maxNodes: count,
  maxPrimitives: count,
  maxVertices: count,
  maxTriangles: count,
  maxBonesPerSkin: count,
  maxMorphTargetsPerPrimitive: count,
  maxAnimationClips: count,
});
const requestSchema = z.strictObject({
  sourceId: z
    .string()
    .min(1)
    .refine((id) => id.isWellFormed()),
  bytes: z.instanceof(Uint8Array),
  limits: modelLimitsSchema,
});

export const MODEL_ABSOLUTE_LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
  maxDecodedAccessorBytes: 64 * 1024 * 1024,
  maxNodes: 100_000,
  maxPrimitives: 100_000,
  maxVertices: 4_000_000,
  maxTriangles: 4_000_000,
  maxBonesPerSkin: 1024,
  maxMorphTargetsPerPrimitive: 256,
  maxAnimationClips: 1024,
});

const record = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.getOwnPropertySymbols(value).length) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((entry) => !("value" in entry) || !entry.enumerable))
    return undefined;
  return Object.fromEntries(Object.entries(descriptors).map(([key, entry]) => [key, entry.value]));
};
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;

export const snapshotModelInput = (input: unknown) => {
  try {
    const request = record(input);
    const limits = modelLimitsSchema.safeParse(record(request?.limits));
    if (
      !request ||
      !limits.success ||
      Object.keys(request).some((key) => !["sourceId", "bytes", "limits"].includes(key))
    )
      return undefined;
    if (
      Object.entries(limits.data).some(
        ([key, maximum]) =>
          maximum > MODEL_ABSOLUTE_LIMITS[key as keyof typeof MODEL_ABSOLUTE_LIMITS],
      )
    )
      return undefined;
    if (!ArrayBuffer.isView(request.bytes) || tag.call(request.bytes) !== "Uint8Array")
      return undefined;
    arrayBufferByteLength.call(buffer.call(request.bytes));
    const length = byteLength.call(request.bytes) as number;
    if (length > limits.data.maxInputBytes) return { exceeded: "maxInputBytes" } as const;
    const bytes = new Uint8Array(length);
    Uint8Array.prototype.set.call(bytes, request.bytes as Uint8Array);
    const result = requestSchema.safeParse({
      sourceId: request.sourceId,
      bytes,
      limits: limits.data,
    });
    return result.success ? { request: result.data } : undefined;
  } catch {
    return undefined;
  }
};
