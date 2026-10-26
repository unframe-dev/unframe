import {
  createUnityMediaCapabilityProfile,
  capabilityProfileSchema,
  runtimeAuthorityVersions,
  type CapabilityProfile,
} from "@unframe/contracts/presentation";

const bakedWebQuestProfile = capabilityProfileSchema.parse({
  schemaVersion: runtimeAuthorityVersions.capability,
  capabilityProfileId: "quest-baked-web-v1",
  contractVersions: {
    delivery: runtimeAuthorityVersions.delivery,
    runtime: runtimeAuthorityVersions.runtime,
    progression: runtimeAuthorityVersions.progression,
    projection: runtimeAuthorityVersions.projection,
  },
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

const unityMediaProfile = createUnityMediaCapabilityProfile();
const presentationQuestProfile = capabilityProfileSchema.parse({
  ...unityMediaProfile,
  capabilityProfileId: "quest-presentation-v2",
  renderers: {
    ...unityMediaProfile.renderers,
    nativeUi: {
      supported: true,
      contractVersion: 1,
      features: ["clip"],
    },
  },
  limits: {
    ...unityMediaProfile.limits,
    nativeUi: {
      tierId: "quest-presentation-v2",
      maxNodesPerArtifact: 1024,
      maxTreeDepth: 32,
      maxTextNodesPerArtifact: 256,
      maxCodePointsPerText: 4096,
      maxGlyphs: 8192,
      maxFontAssets: 8,
    },
  },
});

export const normalizedCapability = (profileId: string): CapabilityProfile => {
  if (profileId === "unity-media-v1") return createUnityMediaCapabilityProfile();
  const profile = [bakedWebQuestProfile, presentationQuestProfile].find(
    (candidate) => candidate.capabilityProfileId === profileId,
  );
  if (!profile) throw new RangeError("Unsupported device capability profile");
  return structuredClone(profile);
};
