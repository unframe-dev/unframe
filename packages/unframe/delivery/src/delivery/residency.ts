import type {
  DeliveryManifestWire,
  ResidencyPlanWire,
} from "@unframe/contracts/presentation/wire-types";
import type { BuildSourceInput } from "./input.js";
import type { DeliverySelection } from "./selection.js";

export const asUint64 = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("uint64 must be a safe unsigned integer.");
  return String(value);
};
export const modelFeature = {
  animation: 1,
  skin: 2,
  morphTargets: 3,
  alphaBlend: 4,
  alphaMask: 5,
  pbrMetallicRoughness: 6,
  unlit: 7,
} as const;
export const featureSet = <T extends string>(values: T[], mapping: Record<T, number>) =>
  [...new Set(values.map((value) => mapping[value]))].sort((a, b) => a - b);

type CompleteWireValue<T> = T extends readonly (infer Item)[]
  ? CompleteWireValue<Item>[]
  : T extends object
    ? { [Key in keyof T]-?: CompleteWireValue<NonNullable<T[Key]>> }
    : T;

export type DeliveryResidencyPlan = CompleteWireValue<ResidencyPlanWire>;

export const buildResidencyPlan = (
  input: Pick<BuildSourceInput, "definition" | "renderBundle" | "assetSet" | "capability">,
  selection: DeliverySelection,
): DeliveryResidencyPlan => {
  const residency = selection.residency;
  const modelEntries = residency.models.map(({ assetId, checksum }) => {
    const model = input.renderBundle.models[assetId]!;
    return {
      assetId,
      checksum,
      encodedSizeBytes: asUint64(model.encodedSizeBytes),
      format: 1,
      requiredFeatures: featureSet(model.requiredFeatures, modelFeature),
      nodeCount: asUint64(model.nodeCount),
      primitiveCount: asUint64(model.primitiveCount),
      vertexCount: asUint64(model.vertexCount),
      triangleCount: asUint64(model.triangleCount),
      maximumBonesPerSkin: asUint64(model.maxBonesPerSkin),
      maximumMorphTargetsPerPrimitive: asUint64(model.maxMorphTargetsPerPrimitive),
      animationClipCount: asUint64(model.animationClipCount),
    };
  });
  const sum = (values: number[]) =>
    values.reduce((total, value) => {
      const next = total + value;
      if (!Number.isSafeInteger(next)) throw new RangeError("Residency sum overflow.");
      return next;
    }, 0);
  const videos = residency.videos.map(({ assetId, checksum, decodedFrameBytes }) => ({
    assetId,
    checksum,
    decodedFrameBytes: asUint64(decodedFrameBytes),
    encodedSizeBytes: asUint64(input.assetSet.assets[assetId]!.encodedSizeBytes),
  }));
  return {
    textures: {
      budgetTierId: input.capability.limits.texture.tierId,
      textures: residency.textures.map((texture) => ({
        assetId: texture.assetId,
        checksum: texture.checksum,
        pixelSize: {
          width: asUint64(texture.pixelSize[0]),
          height: asUint64(texture.pixelSize[1]),
        },
        decodedGpuBytes: asUint64(texture.gpuBytes),
        peakLoadCpuBytes: asUint64(texture.peakLoadCpuBytes),
      })),
      totalDecodedGpuBytes: asUint64(residency.totalTextureGpuBytes),
      maximumPeakLoadCpuBytes: asUint64(residency.maximumTextureLoadCpuBytes),
    },
    models: {
      budgetTierId: input.capability.limits.model.tierId,
      models: modelEntries,
      totalEncodedBytes: asUint64(residency.modelTotals.encodedBytes),
      totalVertices: asUint64(residency.modelTotals.vertexCount),
      totalTriangles: asUint64(residency.modelTotals.triangleCount),
      modelInstanceCount: asUint64(residency.modelTotals.instanceCount),
      totalNodes: asUint64(residency.modelTotals.nodeCount),
      totalPrimitives: asUint64(residency.modelTotals.primitiveCount),
    },
    nativeUi: {
      budgetTierId: input.capability.limits.nativeUi.tierId,
      fontAssetIds: residency.fontAssetIds,
      maximumNodesPerArtifact: asUint64(residency.maximumNativeNodes),
      maximumTreeDepth: asUint64(residency.maximumNativeDepth),
      maximumTextNodesPerArtifact: asUint64(residency.maximumNativeTextNodes),
      maximumCodePointsPerText: asUint64(residency.maximumNativeCodePoints),
      glyphs: residency.glyphs,
      fontAssetCount: asUint64(
        new Set(residency.fontAssetIds.map((id) => input.assetSet.assets[id]!.checksum)).size,
      ),
    },
    video: {
      budgetTierId: input.capability.limits.video.tierId,
      videos,
      totalEncodedBytes: asUint64(sum(videos.map((video) => Number(video.encodedSizeBytes)))),
      maximumConcurrentDecoders: asUint64(residency.maximumConcurrentDecoders),
      maximumDecodedFrameBytes: asUint64(residency.maximumDecodedFrameBytes),
    },
    totalSelectedEncodedBytes: asUint64(residency.totalSelectedEncodedBytes),
  } satisfies NonNullable<DeliveryManifestWire["residency"]>;
};
