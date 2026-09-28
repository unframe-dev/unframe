import * as z from "zod";

import { idV2Schema, positiveSafeUIntV2Schema } from "./common";

const rendererCapability = <T extends z.ZodEnum>(features: T) =>
  z.strictObject({
    supported: z.boolean(),
    contractVersion: z.literal(1),
    features: z.array(features),
  });
const budget = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ tierId: idV2Schema, ...shape });

export const capabilityProfileV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  capabilityProfileId: idV2Schema,
  contractVersions: z.strictObject({
    delivery: z.literal(2),
    runtime: z.literal(2),
    progression: z.literal(1),
    projection: z.literal(1),
  }),
  renderers: z.strictObject({
    bakedWeb: rendererCapability(z.enum(["alpha-opaque", "alpha-straight", "png", "srgb"])),
    nativeUi: rendererCapability(z.enum(["clip", "ellipsis", "explicitFontFallback"])),
    video: rendererCapability(z.enum(["alpha", "audio", "h264", "vp9", "av1"])),
  }),
  model: z.strictObject({
    supported: z.boolean(),
    contractVersion: z.literal(1),
    formats: z.tuple([z.literal("model/gltf-binary")]),
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
  }),
  limits: z.strictObject({
    texture: budget({
      maxTextureWidth: positiveSafeUIntV2Schema,
      maxTextureHeight: positiveSafeUIntV2Schema,
      maxTexturePixels: positiveSafeUIntV2Schema,
      maxTextureBindings: positiveSafeUIntV2Schema,
      maxGpuBytes: positiveSafeUIntV2Schema,
      maxSerialLoadCpuBytes: positiveSafeUIntV2Schema,
      maxEncodedCacheBytes: positiveSafeUIntV2Schema,
      encodedCacheReserveBytes: positiveSafeUIntV2Schema,
    }),
    nativeUi: budget({
      maxNodesPerArtifact: positiveSafeUIntV2Schema,
      maxTreeDepth: positiveSafeUIntV2Schema,
      maxTextNodesPerArtifact: positiveSafeUIntV2Schema,
      maxCodePointsPerText: positiveSafeUIntV2Schema,
      maxGlyphs: positiveSafeUIntV2Schema,
      maxFontAssets: positiveSafeUIntV2Schema,
    }),
    video: budget({
      maxWidth: positiveSafeUIntV2Schema,
      maxHeight: positiveSafeUIntV2Schema,
      maxPixels: positiveSafeUIntV2Schema,
      maxConcurrentDecoders: positiveSafeUIntV2Schema,
      maxEncodedBytes: positiveSafeUIntV2Schema,
      maxDecodedFrameBytes: positiveSafeUIntV2Schema,
    }),
    model: budget({
      maxAssets: positiveSafeUIntV2Schema,
      maxInstances: positiveSafeUIntV2Schema,
      maxEncodedBytes: positiveSafeUIntV2Schema,
      maxNodes: positiveSafeUIntV2Schema,
      maxPrimitives: positiveSafeUIntV2Schema,
      maxVertices: positiveSafeUIntV2Schema,
      maxTriangles: positiveSafeUIntV2Schema,
      maxBonesPerSkin: positiveSafeUIntV2Schema,
      maxMorphTargetsPerPrimitive: positiveSafeUIntV2Schema,
      maxAnimationClipsPerAsset: positiveSafeUIntV2Schema,
    }),
  }),
  localOverlaySupported: z.boolean(),
});

export type CapabilityProfileV2 = z.infer<typeof capabilityProfileV2Schema>;
