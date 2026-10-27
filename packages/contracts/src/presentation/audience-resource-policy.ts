import type { CapabilityProfile } from "./capability";

const mebibyte = 1024 * 1024;
const memoryCapacityBytes = 64 * mebibyte;
const textureDimension = 2048;
const videoWidth = 1920;
const videoHeight = 1080;

// Admission limits are application policy, not measured device capabilities.
export const audienceWebResourcePolicy: CapabilityProfile["limits"] = {
  texture: {
    tierId: "audience-web-texture",
    maxTextureWidth: textureDimension,
    maxTextureHeight: textureDimension,
    maxTexturePixels: textureDimension * textureDimension,
    maxTextureBindings: 8,
    maxGpuBytes: memoryCapacityBytes,
    maxSerialLoadCpuBytes: memoryCapacityBytes,
    maxEncodedCacheBytes: memoryCapacityBytes,
    encodedCacheReserveBytes: 1024,
  },
  // The wire contract requires positive limits even for unsupported renderers.
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
    tierId: "audience-web-video",
    maxWidth: videoWidth,
    maxHeight: videoHeight,
    maxPixels: videoWidth * videoHeight,
    maxConcurrentDecoders: 1,
    maxEncodedBytes: memoryCapacityBytes,
    maxDecodedFrameBytes: 16 * mebibyte,
  },
  model: {
    tierId: "audience-web-model",
    maxAssets: 4,
    maxInstances: 8,
    maxEncodedBytes: memoryCapacityBytes,
    maxNodes: 2048,
    maxPrimitives: 1024,
    maxVertices: 250000,
    maxTriangles: 250000,
    maxBonesPerSkin: 128,
    maxMorphTargetsPerPrimitive: 8,
    maxAnimationClipsPerAsset: 32,
  },
};
