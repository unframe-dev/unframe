import { capabilityProfileSchema, type CapabilityProfile } from "./capability";

import { runtimeAuthorityVersions } from "./runtime-authority";

const capacity = 64 * 1024 * 1024;

export const createAudienceWebCapabilityProfile = (): CapabilityProfile =>
  capabilityProfileSchema.parse({
    schemaVersion: runtimeAuthorityVersions.capability,
    capabilityProfileId: "audience-web-v1",
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
        tierId: "audience-web-v1",
        maxTextureWidth: 2048,
        maxTextureHeight: 2048,
        maxTexturePixels: 2048 * 2048,
        maxTextureBindings: 8,
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
        tierId: "audience-web-v1",
        maxWidth: 1920,
        maxHeight: 1080,
        maxPixels: 2073600,
        maxConcurrentDecoders: 1,
        maxEncodedBytes: capacity,
        maxDecodedFrameBytes: 16777216,
      },
      model: {
        tierId: "audience-web-v1",
        maxAssets: 4,
        maxInstances: 8,
        maxEncodedBytes: capacity,
        maxNodes: 2048,
        maxPrimitives: 1024,
        maxVertices: 250000,
        maxTriangles: 250000,
        maxBonesPerSkin: 128,
        maxMorphTargetsPerPrimitive: 8,
        maxAnimationClipsPerAsset: 32,
      },
    },
    localOverlaySupported: false,
  });
