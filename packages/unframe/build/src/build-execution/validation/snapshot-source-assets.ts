import type { ValidationResult } from "@unframe/presentation";
import type { CompilerSourceAsset, CompilerSourceAssetBytes } from "../api/types.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { safePlainClone } from "./safe-plain-clone.js";
import {
  checksumBytes,
  hasValidFontSignature,
  hasValidImageSignature,
  hasValidModelHeader,
  hasValidVideoHeader,
} from "./source-assets.js";

export const MAX_SOURCE_ASSET_TOTAL_BYTES = 256 * 1024 * 1024;
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const tag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;

export const snapshotSourceAssets = (
  assets: unknown,
  sourceAssetBytes: unknown,
): ValidationResult<{
  descriptors: Readonly<Record<string, CompilerSourceAsset>>;
  bytes: CompilerSourceAssetBytes;
}> => {
  const invalid = (id?: string) => ({
    valid: false as const,
    diagnostics: [
      diagnostic(
        "compiler-invalid-asset",
        id === undefined ? ["sourceAssetBytes"] : ["assets", id],
        "Asset descriptors must match their key and portable contract shape.",
      ),
    ],
  });
  try {
    const cloned = safePlainClone(assets);
    if (
      !cloned.valid ||
      cloned.value === null ||
      typeof cloned.value !== "object" ||
      Array.isArray(cloned.value)
    )
      return invalid();
    if (
      sourceAssetBytes === null ||
      typeof sourceAssetBytes !== "object" ||
      Array.isArray(sourceAssetBytes)
    )
      return invalid();
    const prototype = Object.getPrototypeOf(sourceAssetBytes);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(sourceAssetBytes).length
    )
      return invalid();
    const entries = Object.getOwnPropertyDescriptors(sourceAssetBytes);
    if (Object.values(entries).some((entry) => !entry.enumerable || !Object.hasOwn(entry, "value")))
      return invalid();
    const descriptors = cloned.value as Record<string, CompilerSourceAsset>;
    const ids = Object.keys(descriptors);
    if (Object.keys(entries).length !== ids.length || ids.some((id) => !Object.hasOwn(entries, id)))
      return invalid();
    const views: { id: string; view: Uint8Array; length: number }[] = [];
    let total = 0;
    for (const id of ids) {
      const asset = descriptors[id];
      if (
        !asset ||
        typeof asset !== "object" ||
        Array.isArray(asset) ||
        Object.keys(asset).length !== 4 ||
        Object.keys(asset).some(
          (key) => !["id", "mediaType", "checksum", "encodedSizeBytes"].includes(key),
        ) ||
        asset.id !== id ||
        ![
          "font/ttf",
          "font/otf",
          "image/png",
          "image/jpeg",
          "model/gltf-binary",
          "video/mp4",
        ].includes(asset.mediaType) ||
        typeof asset.checksum !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(asset.checksum) ||
        !Number.isSafeInteger(asset.encodedSizeBytes) ||
        asset.encodedSizeBytes < 0
      )
        return invalid(id);
      const view = entries[id]!.value;
      if (!ArrayBuffer.isView(view) || tag.call(view) !== "Uint8Array") return invalid(id);
      arrayBufferByteLength.call(buffer.call(view));
      const length = byteLength.call(view) as number;
      const limit = asset.mediaType.startsWith("image/") ? 16 * 1024 * 1024 : 64 * 1024 * 1024;
      if (length !== asset.encodedSizeBytes || length > limit) return invalid(id);
      total += length;
      if (!Number.isSafeInteger(total) || total > MAX_SOURCE_ASSET_TOTAL_BYTES) return invalid(id);
      views.push({ id, view: view as Uint8Array, length });
    }
    const bytes: Record<string, Uint8Array> = Object.create(null);
    for (const { id, view, length } of views) {
      const copy = new Uint8Array(length);
      Uint8Array.prototype.set.call(copy, view);
      const asset = descriptors[id]!;
      if (
        checksumBytes(copy) !== asset.checksum ||
        !(asset.mediaType === "video/mp4"
          ? hasValidVideoHeader(copy)
          : asset.mediaType === "model/gltf-binary"
            ? hasValidModelHeader(copy)
            : asset.mediaType === "font/ttf" || asset.mediaType === "font/otf"
              ? hasValidFontSignature(copy, asset.mediaType)
              : hasValidImageSignature(copy, asset.mediaType))
      )
        return invalid(id);
      bytes[id] = copy;
    }
    return { valid: true, value: { descriptors, bytes }, diagnostics: [] };
  } catch {
    return invalid();
  }
};
