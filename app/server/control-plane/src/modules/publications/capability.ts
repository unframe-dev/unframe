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

const presentationQuestProfile = capabilityProfileSchema.parse({
  ...bakedWebQuestProfile,
  capabilityProfileId: "quest-presentation-v2",
  renderers: {
    ...bakedWebQuestProfile.renderers,
    nativeUi: {
      supported: true,
      contractVersion: 1,
      features: ["clip"],
    },
    video: { supported: true, contractVersion: 1, features: ["audio", "h264"] },
  },
  model: {
    supported: true,
    contractVersion: 1,
    formats: ["model/gltf-binary"],
    features: [
      "animation",
      "skin",
      "morphTargets",
      "alphaBlend",
      "alphaMask",
      "pbrMetallicRoughness",
      "unlit",
    ],
  },
  limits: {
    ...bakedWebQuestProfile.limits,
    texture: {
      ...bakedWebQuestProfile.limits.texture,
      tierId: "quest-presentation-v2",
      maxSerialLoadCpuBytes: 67108864,
    },
    nativeUi: {
      tierId: "quest-presentation-v2",
      maxNodesPerArtifact: 1024,
      maxTreeDepth: 32,
      maxTextNodesPerArtifact: 256,
      maxCodePointsPerText: 4096,
      maxGlyphs: 8192,
      maxFontAssets: 8,
    },
    video: {
      tierId: "quest-presentation-v2",
      maxWidth: 1920,
      maxHeight: 1080,
      maxPixels: 2073600,
      maxConcurrentDecoders: 1,
      maxEncodedBytes: 67108864,
      maxDecodedFrameBytes: 8294400,
    },
    model: {
      tierId: "quest-presentation-v2",
      maxAssets: 16,
      maxInstances: 32,
      maxEncodedBytes: 67108864,
      maxNodes: 4096,
      maxPrimitives: 2048,
      maxVertices: 1000000,
      maxTriangles: 1000000,
      maxBonesPerSkin: 128,
      maxMorphTargetsPerPrimitive: 8,
      maxAnimationClipsPerAsset: 32,
    },
  },
});

export const normalizedCapability = (profileId: string): CapabilityProfile => {
  const profile = [bakedWebQuestProfile, presentationQuestProfile].find(
    (candidate) => candidate.capabilityProfileId === profileId,
  );
  if (!profile) throw new RangeError("Unsupported device capability profile");
  return structuredClone(profile);
};
