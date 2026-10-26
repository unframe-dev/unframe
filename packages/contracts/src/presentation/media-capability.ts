import { capabilityProfileSchema, type CapabilityProfile } from "./capability";

import { runtimeAuthorityVersions } from "./runtime-authority";

const capacity = 64 * 1024 * 1024;

export const createUnityMediaCapabilityProfile = (): CapabilityProfile =>
  capabilityProfileSchema.parse({
    schemaVersion: runtimeAuthorityVersions.capability,
    capabilityProfileId: "unity-media-v1",
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
        features: ["png", "srgb", "alpha-opaque", "alpha-straight"],
      },
      nativeUi: { supported: false, contractVersion: 1, features: [] },
      video: { supported: true, contractVersion: 1, features: ["h264", "audio"] },
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
      texture: {
        tierId: "unity-media-v1",
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
        tierId: "unity-media-v1",
        maxWidth: 1920,
        maxHeight: 1080,
        maxPixels: 2073600,
        maxConcurrentDecoders: 2,
        maxEncodedBytes: capacity,
        maxDecodedFrameBytes: 16777216,
      },
      model: {
        tierId: "unity-media-v1",
        maxAssets: 16,
        maxInstances: 32,
        maxEncodedBytes: capacity,
        maxNodes: 8192,
        maxPrimitives: 4096,
        maxVertices: 1000000,
        maxTriangles: 1000000,
        maxBonesPerSkin: 256,
        maxMorphTargetsPerPrimitive: 64,
        maxAnimationClipsPerAsset: 128,
      },
    },
    localOverlaySupported: false,
  });
