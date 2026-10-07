import * as z from "zod";

import { idSchema, positiveSafeUIntSchema } from "./common";

const rendererCapability = <T extends z.ZodEnum>(features: T) =>
  z.strictObject({
    supported: z.boolean(),
    contractVersion: z.literal(1),
    features: z.array(features),
  });
const budget = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ tierId: idSchema, ...shape });

export const capabilityProfileSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    capabilityProfileId: idSchema,
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
      formats: z.array(z.literal("model/gltf-binary")),
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
        maxTextureWidth: positiveSafeUIntSchema,
        maxTextureHeight: positiveSafeUIntSchema,
        maxTexturePixels: positiveSafeUIntSchema,
        maxTextureBindings: positiveSafeUIntSchema,
        maxGpuBytes: positiveSafeUIntSchema,
        maxSerialLoadCpuBytes: positiveSafeUIntSchema,
        maxEncodedCacheBytes: positiveSafeUIntSchema,
        encodedCacheReserveBytes: positiveSafeUIntSchema,
      }),
      nativeUi: budget({
        maxNodesPerArtifact: positiveSafeUIntSchema,
        maxTreeDepth: positiveSafeUIntSchema,
        maxTextNodesPerArtifact: positiveSafeUIntSchema,
        maxCodePointsPerText: positiveSafeUIntSchema,
        maxGlyphs: positiveSafeUIntSchema,
        maxFontAssets: positiveSafeUIntSchema,
      }),
      video: budget({
        maxWidth: positiveSafeUIntSchema,
        maxHeight: positiveSafeUIntSchema,
        maxPixels: positiveSafeUIntSchema,
        maxConcurrentDecoders: positiveSafeUIntSchema,
        maxEncodedBytes: positiveSafeUIntSchema,
        maxDecodedFrameBytes: positiveSafeUIntSchema,
      }),
      model: budget({
        maxAssets: positiveSafeUIntSchema,
        maxInstances: positiveSafeUIntSchema,
        maxEncodedBytes: positiveSafeUIntSchema,
        maxNodes: positiveSafeUIntSchema,
        maxPrimitives: positiveSafeUIntSchema,
        maxVertices: positiveSafeUIntSchema,
        maxTriangles: positiveSafeUIntSchema,
        maxBonesPerSkin: positiveSafeUIntSchema,
        maxMorphTargetsPerPrimitive: positiveSafeUIntSchema,
        maxAnimationClipsPerAsset: positiveSafeUIntSchema,
      }),
    }),
    localOverlaySupported: z.boolean(),
  })
  .superRefine((profile, context) => {
    for (const renderer of Object.values(profile.renderers)) {
      if (!renderer.supported && renderer.features.length !== 0)
        context.addIssue({
          code: "custom",
          message: "Unsupported renderer must have no features.",
        });
    }
    if (
      !profile.model.supported &&
      (profile.model.features.length !== 0 || profile.model.formats.length !== 0)
    )
      context.addIssue({
        code: "custom",
        message: "Unsupported model must have no formats or features.",
      });
    if (profile.model.supported && profile.model.formats.length !== 1)
      context.addIssue({ code: "custom", message: "Supported model requires GLTF_BINARY format." });
    if (
      profile.renderers.video.features.some(
        (feature) => feature === "vp9" || feature === "av1" || feature === "alpha",
      )
    )
      context.addIssue({ code: "custom", message: "Video only supports H264 without alpha." });
    if (
      profile.limits.texture.encodedCacheReserveBytes >= profile.limits.texture.maxEncodedCacheBytes
    )
      context.addIssue({
        code: "custom",
        message: "Encoded cache reserve must be smaller than capacity.",
      });
  });

export type CapabilityProfile = z.infer<typeof capabilityProfileSchema>;
