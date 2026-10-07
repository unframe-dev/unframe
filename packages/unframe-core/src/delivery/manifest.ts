import type { CapabilityProfile, DeliveryManifestWire } from "@unframe/contracts/presentation";
import { idSchema } from "@unframe/contracts/presentation";
import { buildProjectionProfile } from "./profile.js";
import type { DeliverySourceInput } from "./input.js";
import { snapshotPlainJson } from "../publication/plain-json.js";

const asUint64 = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("uint64 must be a safe unsigned integer.");
  return String(value);
};
const modelFeature = {
  animation: 1,
  skin: 2,
  morphTargets: 3,
  alphaBlend: 4,
  alphaMask: 5,
  pbrMetallicRoughness: 6,
  unlit: 7,
} as const;
const featureSet = <T extends string>(values: T[], mapping: Record<T, number>) =>
  [...new Set(values.map((value) => mapping[value]))].sort((a, b) => a - b);
const limits = (value: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "tierId" ? entry : asUint64(entry as number),
    ]),
  );
const capabilityWire = (capability: CapabilityProfile) => ({
  schemaVersion: capability.schemaVersion,
  capabilityProfileId: capability.capabilityProfileId,
  contractVersions: capability.contractVersions,
  renderers: {
    bakedWeb: {
      supported: capability.renderers.bakedWeb.supported,
      contractVersion: capability.renderers.bakedWeb.contractVersion,
      features: featureSet(capability.renderers.bakedWeb.features, {
        png: 1,
        srgb: 2,
        "alpha-opaque": 3,
        "alpha-straight": 4,
      }),
    },
    nativeUi: {
      supported: capability.renderers.nativeUi.supported,
      contractVersion: capability.renderers.nativeUi.contractVersion,
      features: featureSet(capability.renderers.nativeUi.features, {
        clip: 1,
        ellipsis: 2,
        explicitFontFallback: 3,
      }),
    },
    video: {
      supported: capability.renderers.video.supported,
      contractVersion: capability.renderers.video.contractVersion,
      features: featureSet(capability.renderers.video.features, {
        h264: 1,
        vp9: 2,
        av1: 3,
        alpha: 4,
        audio: 5,
      }),
    },
  },
  model: {
    supported: capability.model.supported,
    contractVersion: capability.model.contractVersion,
    formats: capability.model.formats.map(() => 1),
    features: featureSet(capability.model.features, modelFeature),
  },
  limits: {
    texture: limits(capability.limits.texture),
    nativeUi: limits(capability.limits.nativeUi),
    video: limits(capability.limits.video),
    model: limits(capability.limits.model),
  },
  localOverlaySupported: capability.localOverlaySupported,
});

export type AssetAccessGrant = { url: string; expiresAtUnixMilliseconds: number };
type AssetUrl = {
  protocol: string;
  host: string;
  username: string;
  password: string;
  hash: string;
};
type AssetUrlConstructor = new (input: string) => AssetUrl;
export type DeliveryManifestBuildInput = DeliverySourceInput & {
  role: "presenter" | "viewer";
  sessionId: string;
  participantId: string;
  assignmentEpoch: number;
  issuedAtUnixMilliseconds: number;
  assetAccess: Record<string, AssetAccessGrant>;
};

export const buildDeliveryManifest = (input: DeliveryManifestBuildInput) => {
  const frozen = snapshotPlainJson(input);
  if (!frozen.valid)
    throw new TypeError("Delivery Manifest input must be plain JSON data properties.");
  input = frozen.value as unknown as DeliveryManifestBuildInput;
  idSchema.parse(input.sessionId);
  idSchema.parse(input.participantId);
  const { profile, selection } = buildProjectionProfile(
    {
      definition: input.definition,
      renderBundle: input.renderBundle,
      assetSet: input.assetSet,
      buildManifest: input.buildManifest,
      publishedPresentation: input.publishedPresentation,
      capability: input.capability,
    },
    input.role,
  );
  if (!profile.projectionProfileId) throw new Error("Projection profile identity is missing.");
  if (!Number.isSafeInteger(input.assignmentEpoch) || input.assignmentEpoch <= 0)
    throw new Error("assignmentEpoch must be positive.");
  if (!Number.isSafeInteger(input.issuedAtUnixMilliseconds) || input.issuedAtUnixMilliseconds < 0)
    throw new Error("issuedAtUnixMilliseconds must be a safe unsigned integer.");
  const selectedIds = new Set(selection.assets.map((asset) => asset.assetId));
  if (
    Object.keys(input.assetAccess).length !== selectedIds.size ||
    Object.keys(input.assetAccess).some((id) => !selectedIds.has(id))
  )
    throw new Error("Asset access keys must exactly match selected Asset closure.");
  const Url = (globalThis as unknown as { URL?: AssetUrlConstructor }).URL;
  if (typeof Url !== "function") throw new Error("WHATWG URL parser is unavailable.");
  const assetAccess = selection.assets.map(({ assetId, descriptor }) => {
    const grant = input.assetAccess[assetId];
    if (!grant) throw new Error(`Missing Asset access for ${assetId}.`);
    let url: AssetUrl;
    try {
      url = new Url(grant.url);
    } catch {
      throw new Error(`Asset ${assetId} URL is invalid.`);
    }
    if (url.protocol !== "https:" || !url.host || url.username || url.password || url.hash)
      throw new Error(
        `Asset ${assetId} URL must be absolute HTTPS without credentials or fragment.`,
      );
    if (
      !Number.isSafeInteger(grant.expiresAtUnixMilliseconds) ||
      grant.expiresAtUnixMilliseconds <= input.issuedAtUnixMilliseconds
    )
      throw new Error(`Asset ${assetId} access expiry must follow issuance.`);
    return {
      assetId,
      checksum: descriptor.checksum,
      mediaType: descriptor.mediaType,
      encodedSizeBytes: asUint64(descriptor.encodedSizeBytes),
      url: grant.url,
      expiresAtUnixMs: asUint64(grant.expiresAtUnixMilliseconds),
    };
  });
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
  const manifest: DeliveryManifestWire = {
    schemaVersion: 2,
    deliveryContractVersion: 2,
    sessionId: input.sessionId,
    publication: {
      presentationId: input.publishedPresentation.presentationId,
      publicationEpoch: asUint64(input.publishedPresentation.publicationEpoch),
      publicationManifestHash: input.publishedPresentation.publicationManifestHash,
    },
    definitionHash: input.publishedPresentation.definitionHash,
    renderBundleHash: input.publishedPresentation.renderBundleHash,
    assetSetHash: input.publishedPresentation.assetSetHash,
    capabilityProfile: capabilityWire(input.capability),
    projectionProfile: profile,
    projectionInstance: {
      projectionProfileId: profile.projectionProfileId,
      participantId: input.participantId,
      assignmentEpoch: asUint64(input.assignmentEpoch),
    },
    assetAccess,
    residency: {
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
        totalEncodedBytes: asUint64(
          sum(modelEntries.map((entry) => Number(entry.encodedSizeBytes))),
        ),
        totalVertices: asUint64(sum(modelEntries.map((entry) => Number(entry.vertexCount)))),
        totalTriangles: asUint64(sum(modelEntries.map((entry) => Number(entry.triangleCount)))),
        modelInstanceCount: asUint64(
          selection.visibleNodeIds.filter(
            (id) => input.definition.scene.nodes[id]?.kind === "model",
          ).length,
        ),
        totalNodes: asUint64(sum(modelEntries.map((entry) => Number(entry.nodeCount)))),
        totalPrimitives: asUint64(sum(modelEntries.map((entry) => Number(entry.primitiveCount)))),
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
    },
  };
  return JSON.parse(JSON.stringify(manifest)) as typeof manifest;
};
