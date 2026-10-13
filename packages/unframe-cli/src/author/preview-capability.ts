import { capabilityProfileSchema, type CapabilityProfile } from "@unframe/contracts/presentation";

const capacity = 64 * 1024 * 1024;

export const previewCapability = (): CapabilityProfile =>
  capabilityProfileSchema.parse({
    schemaVersion: 2,
    capabilityProfileId: "local-web-preview",
    contractVersions: { delivery: 2, runtime: 2, progression: 1, projection: 1 },
    renderers: {
      bakedWeb: {
        supported: true,
        contractVersion: 1,
        features: ["png", "srgb", "alpha-opaque", "alpha-straight"],
      },
      nativeUi: { supported: false, contractVersion: 1, features: [] },
      video: { supported: false, contractVersion: 1, features: [] },
    },
    model: { supported: false, contractVersion: 1, formats: [], features: [] },
    limits: {
      texture: {
        tierId: "local-web-preview",
        maxTextureWidth: 2048,
        maxTextureHeight: 2048,
        maxTexturePixels: 2048 * 2048,
        maxTextureBindings: 1024,
        maxGpuBytes: capacity,
        maxSerialLoadCpuBytes: capacity,
        maxEncodedCacheBytes: capacity,
        encodedCacheReserveBytes: 1024,
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
