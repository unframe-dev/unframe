import * as z from "zod";

import {
  boundsSchema,
  contentHashSchema,
  finiteNumberSchema,
  idSchema,
  nonNegativeFiniteNumberSchema,
  positiveFiniteNumberSchema,
  positiveSafeUIntSchema,
  positiveVector2Schema,
  safeUIntSchema,
  srgbaColorSchema,
  uint32Schema,
} from "./common";
import { completedSemanticTreeSchema } from "./semantics";

const requiredBakedFeatureSchema = z.enum(["alpha-opaque", "alpha-straight", "png", "srgb"]);
const requiredNativeFeatureSchema = z.enum(["clip", "ellipsis", "explicitFontFallback"]);
const requiredVideoFeatureSchema = z.enum(["alpha", "audio", "h264", "vp9", "av1"]);
export const textureArtifactSchema = z.strictObject({
  assetId: idSchema,
  mediaType: z.literal("image/png"),
  pixelSize: z.tuple([positiveSafeUIntSchema, positiveSafeUIntSchema]),
  checksum: contentHashSchema,
  encodedSizeBytes: safeUIntSchema,
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight"]),
  mipCount: z.literal(1),
  gpuBytes: safeUIntSchema,
});
export const bakedWebArtifactSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("baked-web"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredBakedFeatureSchema),
  states: z.record(idSchema, z.strictObject({ stateId: idSchema, texture: textureArtifactSchema })),
});
const codePointRangeSchema = z.tuple([uint32Schema.max(1_114_111), uint32Schema.max(1_114_111)]);
const fontFaceSchema = z.strictObject({
  assetId: idSchema,
  supportedCodePointRanges: z.array(codePointRangeSchema).min(1),
});
const fontSchema = z.strictObject({ primary: fontFaceSchema, fallbacks: z.array(fontFaceSchema) });
const nativeTextValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({
    kind: z.literal("variableString"),
    variableId: idSchema,
    expectedType: z.literal("string"),
    format: z.strictObject({
      kind: z.literal("string"),
      allowedCodePointRanges: z.array(codePointRangeSchema).min(1),
    }),
  }),
  z.strictObject({
    kind: z.literal("variableBoolean"),
    variableId: idSchema,
    expectedType: z.literal("boolean"),
    format: z.strictObject({
      kind: z.literal("boolean"),
      trueLabel: z.string(),
      falseLabel: z.string(),
    }),
  }),
  z.strictObject({
    kind: z.literal("variableNumber"),
    variableId: idSchema,
    expectedType: z.literal("number"),
    format: z.strictObject({
      kind: z.literal("number"),
      fractionDigits: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }),
  }),
  z.strictObject({
    kind: z.literal("stepTimerRemaining"),
    groupId: idSchema,
    stepId: idSchema,
    cueId: idSchema,
    durationMilliseconds: positiveSafeUIntSchema,
    whenStepInactive: z.enum(["empty", "zero"]),
    format: z.enum(["mm:ss", "hh:mm:ss"]),
  }),
]);
const nativeRectSchema = z.strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: nonNegativeFiniteNumberSchema,
  height: nonNegativeFiniteNumberSchema,
  coordinateSpace: z.literal("renderSurfaceLogical"),
});
const nativeNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("group"),
    id: idSchema,
    bounds: nativeRectSchema,
    clip: z.boolean(),
    children: z.array(idSchema),
  }),
  z.strictObject({
    kind: z.literal("text"),
    id: idSchema,
    bounds: nativeRectSchema,
    semanticNodeId: idSchema,
    value: nativeTextValueSchema,
    font: fontSchema,
    color: srgbaColorSchema,
    fontSize: positiveFiniteNumberSchema,
    lineHeight: positiveFiniteNumberSchema,
    align: z.enum(["start", "center", "end"]),
    overflow: z.enum(["clip", "ellipsis"]),
    maxCodePoints: positiveSafeUIntSchema,
  }),
]);
const nativeArtifactSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("native-ui"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredNativeFeatureSchema),
  rootNodeId: idSchema,
  nodes: z.record(idSchema, nativeNodeSchema),
});
const videoArtifactSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("video"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredVideoFeatureSchema),
  assetId: idSchema,
  checksum: contentHashSchema,
  encodedSizeBytes: safeUIntSchema,
  mediaType: z.literal("video/mp4"),
  codec: z.enum(["h264", "vp9", "av1"]),
  durationMilliseconds: positiveSafeUIntSchema,
  loop: z.boolean(),
  alpha: z.boolean(),
  audio: z.boolean(),
  pixelSize: z.tuple([positiveSafeUIntSchema, positiveSafeUIntSchema]),
});
const artifactSchema = z.discriminatedUnion("kind", [
  bakedWebArtifactSchema,
  nativeArtifactSchema,
  videoArtifactSchema,
]);
const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("artifacts"), artifactIds: z.array(idSchema).min(1) }),
]);
const regionSchema = z.strictObject({
  interactionId: idSchema,
  semanticNodeId: idSchema,
  bounds: z.strictObject({
    x: finiteNumberSchema.min(0).max(1),
    y: finiteNumberSchema.min(0).max(1),
    width: positiveFiniteNumberSchema.max(1),
    height: positiveFiniteNumberSchema.max(1),
  }),
  coordinateSpace: z.literal("normalized"),
  priority: uint32Schema,
});
const renderSurfaceSchema = z.strictObject({
  id: idSchema,
  semanticSurfaceId: idSchema,
  partitionStrategyVersion: z.literal(1),
  logicalBounds: boundsSchema,
  layer: uint32Schema,
  artifacts: z.record(idSchema, artifactSchema),
  stateBindings: z.record(idSchema, bindingSchema),
});
const compiledSurfaceSchema = z.strictObject({
  semanticSurfaceId: idSchema,
  logicalSize: positiveVector2Schema,
  physicalSizeMeters: positiveVector2Schema,
  renderSurfaceIds: z.array(idSchema),
  renderSurfaces: z.record(idSchema, renderSurfaceSchema),
  semanticsByState: z.record(idSchema, completedSemanticTreeSchema),
  interactionsByState: z.record(idSchema, z.array(regionSchema)),
});
const compiledModelSchema = z.strictObject({
  assetId: idSchema,
  mediaType: z.literal("model/gltf-binary"),
  checksum: contentHashSchema,
  encodedSizeBytes: safeUIntSchema,
  nodeCount: safeUIntSchema,
  primitiveCount: safeUIntSchema,
  vertexCount: safeUIntSchema,
  triangleCount: safeUIntSchema,
  maxBonesPerSkin: safeUIntSchema,
  maxMorphTargetsPerPrimitive: safeUIntSchema,
  animationClipCount: safeUIntSchema,
  requiredFeatures: z.array(
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
  rootMotion: z.literal("removed"),
  materials: z.record(
    idSchema,
    z.strictObject({
      sourceMaterialIndex: safeUIntSchema,
      shaderModel: z.enum(["pbrMetallicRoughness", "unlit"]),
      alphaMode: z.enum(["opaque", "mask", "blend"]),
      alphaCutoff: z.number().min(0).max(1).optional(),
      doubleSided: z.boolean(),
    }),
  ),
  clips: z.record(
    idSchema,
    z.strictObject({
      sourceAnimationIndex: uint32Schema,
      durationMilliseconds: positiveSafeUIntSchema,
    }),
  ),
});

export const renderBundleSchema = z.strictObject({
  schemaVersion: z.literal(2),
  bundleId: idSchema,
  sourceHash: contentHashSchema,
  definitionHash: contentHashSchema,
  compiler: z.strictObject({
    name: idSchema,
    version: idSchema,
    environmentHash: contentHashSchema,
  }),
  buildContext: z.strictObject({
    locale: idSchema,
    timezone: idSchema,
    colorScheme: z.enum(["light", "dark"]),
    themeId: idSchema,
    themeHash: contentHashSchema,
    textureBuildPolicy: z.strictObject({
      policyVersion: z.literal(1),
      resolutionPolicyVersion: z.literal(1),
      policyHash: contentHashSchema,
      longEdgePixels: positiveSafeUIntSchema,
      maxStatesPerRenderSurface: positiveSafeUIntSchema,
      maxRenderSurfacesPerSemanticSurface: positiveSafeUIntSchema,
      maxRenderSurfacesPerBundle: positiveSafeUIntSchema,
      maxTextureBindings: positiveSafeUIntSchema,
      maxTextureWidth: positiveSafeUIntSchema,
      maxTextureHeight: positiveSafeUIntSchema,
      maxTexturePixels: positiveSafeUIntSchema,
      maxRenderedPixels: positiveSafeUIntSchema,
      maxSurfaceCaptureBytes: positiveSafeUIntSchema,
      maxBuildOutputBytes: positiveSafeUIntSchema,
      maxBuildAccountedPeakBytes: positiveSafeUIntSchema,
      rendererConcurrency: z.literal(1),
    }),
  }),
  surfaces: z.record(idSchema, compiledSurfaceSchema),
  models: z.record(idSchema, compiledModelSchema),
});

export type RenderBundle = z.infer<typeof renderBundleSchema>;
export type TextureArtifact = z.infer<typeof textureArtifactSchema>;
