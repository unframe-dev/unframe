import { capabilityProfileSchema, type CapabilityProfile } from "@unframe/contracts/presentation";

const bakedWebQuestProfile = capabilityProfileSchema.parse({
  schemaVersion: 2,
  capabilityProfileId: "quest-baked-web-v1",
  contractVersions: { delivery: 2, runtime: 2, progression: 1, projection: 1 },
  renderers: {
    bakedWeb: {
      supported: true,
      contractVersion: 1,
      features: ["alpha-opaque", "alpha-straight", "png", "srgb"],
    },
    nativeUi: { supported: false, contractVersion: 1, features: [] },
    video: { supported: false, contractVersion: 1, features: [] },
  },
  model: { supported: false, contractVersion: 1, formats: [], features: [] },
  limits: {
    texture: {
      tierId: "quest-baked-web-v1",
      maxTextureWidth: 2048,
      maxTextureHeight: 2048,
      maxTexturePixels: 4194304,
      maxTextureBindings: 16,
      maxGpuBytes: 67108864,
      maxSerialLoadCpuBytes: 33554432,
      maxEncodedCacheBytes: 67108864,
      encodedCacheReserveBytes: 1048576,
    },
    nativeUi: {
      tierId: "unsupported",
      maxNodesPerArtifact: 1,
      maxTreeDepth: 1,
      maxTextNodesPerArtifact: 1,
      maxCodePointsPerText: 1,
      maxGlyphs: 1,
      maxFontAssets: 1,
    },
    video: {
      tierId: "unsupported",
      maxWidth: 1,
      maxHeight: 1,
      maxPixels: 1,
      maxConcurrentDecoders: 1,
      maxEncodedBytes: 1,
      maxDecodedFrameBytes: 1,
    },
    model: {
      tierId: "unsupported",
      maxAssets: 1,
      maxInstances: 1,
      maxEncodedBytes: 1,
      maxNodes: 1,
      maxPrimitives: 1,
      maxVertices: 1,
      maxTriangles: 1,
      maxBonesPerSkin: 1,
      maxMorphTargetsPerPrimitive: 1,
      maxAnimationClipsPerAsset: 1,
    },
  },
  localOverlaySupported: false,
});

export const normalizedCapability = (profileId: string): CapabilityProfile => {
  if (profileId !== bakedWebQuestProfile.capabilityProfileId)
    throw new RangeError("Unsupported device capability profile");
  return structuredClone(bakedWebQuestProfile);
};
