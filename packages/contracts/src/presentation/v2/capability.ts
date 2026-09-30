import * as z from "zod";

import { idV2Schema, positiveSafeUIntV2Schema } from "./common";

const rendererCapability = <T extends z.ZodEnum>(features: T) =>
  z.strictObject({
    contractVersion: z.literal(1),
    features: z.array(features),
    supported: z.boolean(),
  });
const budget = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ tierId: idV2Schema, ...shape });

export const capabilityProfileV2Schema = z.strictObject({
  capabilityProfileId: idV2Schema,
  contractVersions: z.strictObject({
    delivery: z.literal(2),
    progression: z.literal(1),
    projection: z.literal(1),
    runtime: z.literal(2),
  }),
  limits: z.strictObject({
    model: budget({
      maxAnimationClipsPerAsset: positiveSafeUIntV2Schema,
      maxAssets: positiveSafeUIntV2Schema,
      maxBonesPerSkin: positiveSafeUIntV2Schema,
      maxEncodedBytes: positiveSafeUIntV2Schema,
      maxInstances: positiveSafeUIntV2Schema,
      maxMorphTargetsPerPrimitive: positiveSafeUIntV2Schema,
      maxNodes: positiveSafeUIntV2Schema,
      maxPrimitives: positiveSafeUIntV2Schema,
      maxTriangles: positiveSafeUIntV2Schema,
      maxVertices: positiveSafeUIntV2Schema,
    }),
    nativeUi: budget({
      maxCodePointsPerText: positiveSafeUIntV2Schema,
      maxFontAssets: positiveSafeUIntV2Schema,
      maxGlyphs: positiveSafeUIntV2Schema,
      maxNodesPerArtifact: positiveSafeUIntV2Schema,
      maxTextNodesPerArtifact: positiveSafeUIntV2Schema,
      maxTreeDepth: positiveSafeUIntV2Schema,
    }),
    texture: budget({
      encodedCacheReserveBytes: positiveSafeUIntV2Schema,
      maxEncodedCacheBytes: positiveSafeUIntV2Schema,
      maxGpuBytes: positiveSafeUIntV2Schema,
      maxSerialLoadCpuBytes: positiveSafeUIntV2Schema,
      maxTextureBindings: positiveSafeUIntV2Schema,
      maxTextureHeight: positiveSafeUIntV2Schema,
      maxTexturePixels: positiveSafeUIntV2Schema,
      maxTextureWidth: positiveSafeUIntV2Schema,
    }),
    video: budget({
      maxConcurrentDecoders: positiveSafeUIntV2Schema,
      maxDecodedFrameBytes: positiveSafeUIntV2Schema,
      maxEncodedBytes: positiveSafeUIntV2Schema,
      maxHeight: positiveSafeUIntV2Schema,
      maxPixels: positiveSafeUIntV2Schema,
      maxWidth: positiveSafeUIntV2Schema,
    }),
  }),
  localOverlaySupported: z.boolean(),
  model: z.strictObject({
    contractVersion: z.literal(1),
    features: z.array(
      z.enum([
        "alphaBlend",
        "alphaMask",
        "animation",
        "morphTargets",
        "pbrMetallicRoughness",
        "skin",
        "unlit",
      ]),
    ),
    formats: z.tuple([z.literal("model/gltf-binary")]),
    supported: z.boolean(),
  }),
  renderers: z.strictObject({
    bakedWeb: rendererCapability(z.enum(["alpha-opaque", "alpha-straight", "png", "srgb"])),
    nativeUi: rendererCapability(z.enum(["clip", "ellipsis", "explicitFontFallback"])),
    video: rendererCapability(z.enum(["alpha", "audio", "h264", "vp9", "av1"])),
  }),
  schemaVersion: z.literal(2),
});

export type CapabilityProfileV2 = z.infer<typeof capabilityProfileV2Schema>;
