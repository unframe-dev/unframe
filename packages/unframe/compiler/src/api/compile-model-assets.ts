import { MODEL_TRANSFORM_IDENTITY, transformGlb, type ModelLimits } from "@unframe/core/assets";
import type { BuildArtifacts } from "@unframe/artifacts";
import type { RenderBundle, ValidationResult } from "@unframe/presentation";
import type { CompilerSourceAsset, CompilerSourceAssetBytes } from "./types.js";

export const MODEL_COMPILER_LIMITS = Object.freeze({
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
}) satisfies Readonly<ModelLimits>;
export const MODEL_BUILD_IDENTITY = Object.freeze({
  transformer: MODEL_TRANSFORM_IDENTITY,
  limits: MODEL_COMPILER_LIMITS,
});

export const compileModelAssets = async (
  descriptors: Readonly<Record<string, CompilerSourceAsset>>,
  sourceAssetBytes: CompilerSourceAssetBytes,
): Promise<
  ValidationResult<{
    models: RenderBundle["models"];
    descriptors: BuildArtifacts["assetSet"]["assets"];
    bytes: CompilerSourceAssetBytes;
  }>
> => {
  const models: RenderBundle["models"] = {};
  const assets: BuildArtifacts["assetSet"]["assets"] = {};
  const bytes: Record<string, Uint8Array> = {};
  for (const [id, descriptor] of Object.entries(descriptors)) {
    if (descriptor.mediaType !== "model/gltf-binary") continue;
    const transformed = await transformGlb({
      sourceId: id,
      bytes: sourceAssetBytes[id],
      limits: MODEL_COMPILER_LIMITS,
    });
    if (!transformed.valid)
      return {
        valid: false,
        diagnostics: transformed.diagnostics.map((item) => ({
          ...item,
          path: ["assets", id, ...item.path],
        })),
      };
    const model = transformed.value;
    models[id] = { ...model.descriptor, assetId: id };
    assets[id] = {
      mediaType: model.descriptor.mediaType,
      checksum: model.descriptor.checksum,
      encodedSizeBytes: model.descriptor.encodedSizeBytes,
    };
    bytes[id] = model.bytes;
  }
  return { valid: true, value: { models, descriptors: assets, bytes }, diagnostics: [] };
};
