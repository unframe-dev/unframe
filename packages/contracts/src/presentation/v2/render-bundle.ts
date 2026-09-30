import * as z from "zod";

import {
  boundsV2Schema,
  contentHashV2Schema,
  finiteNumberV2Schema,
  idV2Schema,
  nonNegativeFiniteNumberV2Schema,
  positiveFiniteNumberV2Schema,
  positiveSafeUIntV2Schema,
  positiveVector2V2Schema,
  safeUIntV2Schema,
  srgbaColorV2Schema,
  uint32V2Schema,
} from "./common";
import { completedSemanticTreeV2Schema } from "./semantics";

const requiredBakedFeatureSchema = z.enum(["alpha-opaque", "alpha-straight", "png", "srgb"]);
const requiredNativeFeatureSchema = z.enum(["clip", "ellipsis", "explicitFontFallback"]);
const requiredVideoFeatureSchema = z.enum(["alpha", "audio", "h264", "vp9", "av1"]);
export const textureArtifactV2Schema = z.strictObject({
  alphaMode: z.enum(["opaque", "straight"]),
  assetId: idV2Schema,
  checksum: contentHashV2Schema,
  colorSpace: z.literal("srgb"),
  encodedSizeBytes: safeUIntV2Schema,
  gpuBytes: safeUIntV2Schema,
  mediaType: z.literal("image/png"),
  mipCount: z.literal(1),
  pixelSize: z.tuple([positiveSafeUIntV2Schema, positiveSafeUIntV2Schema]),
});
export const bakedWebArtifactV2Schema = z.strictObject({
  contractVersion: z.literal(1),
  id: idV2Schema,
  kind: z.literal("baked-web"),
  requiredFeatures: z.array(requiredBakedFeatureSchema),
  states: z.record(
    idV2Schema,
    z.strictObject({ stateId: idV2Schema, texture: textureArtifactV2Schema }),
  ),
});
const codePointRangeSchema = z.tuple([
  uint32V2Schema.max(1_114_111),
  uint32V2Schema.max(1_114_111),
]);
const fontFaceSchema = z.strictObject({
  assetId: idV2Schema,
  supportedCodePointRanges: z.array(codePointRangeSchema).min(1),
});
const fontSchema = z.strictObject({ fallbacks: z.array(fontFaceSchema), primary: fontFaceSchema });
const nativeTextValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({
    expectedType: z.literal("string"),
    format: z.strictObject({
      allowedCodePointRanges: z.array(codePointRangeSchema).min(1),
      kind: z.literal("string"),
    }),
    kind: z.literal("variableString"),
    variableId: idV2Schema,
  }),
  z.strictObject({
    expectedType: z.literal("boolean"),
    format: z.strictObject({
      falseLabel: z.string(),
      kind: z.literal("boolean"),
      trueLabel: z.string(),
    }),
    kind: z.literal("variableBoolean"),
    variableId: idV2Schema,
  }),
  z.strictObject({
    expectedType: z.literal("number"),
    format: z.strictObject({
      fractionDigits: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      kind: z.literal("number"),
    }),
    kind: z.literal("variableNumber"),
    variableId: idV2Schema,
  }),
  z.strictObject({
    cueId: idV2Schema,
    durationMilliseconds: positiveSafeUIntV2Schema,
    format: z.enum(["mm:ss", "hh:mm:ss"]),
    groupId: idV2Schema,
    kind: z.literal("stepTimerRemaining"),
    stepId: idV2Schema,
    whenStepInactive: z.enum(["empty", "zero"]),
  }),
]);
const nativeRectSchema = z.strictObject({
  coordinateSpace: z.literal("renderSurfaceLogical"),
  height: nonNegativeFiniteNumberV2Schema,
  width: nonNegativeFiniteNumberV2Schema,
  x: finiteNumberV2Schema,
  y: finiteNumberV2Schema,
});
const nativeNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    bounds: nativeRectSchema,
    children: z.array(idV2Schema),
    clip: z.boolean(),
    id: idV2Schema,
    kind: z.literal("group"),
  }),
  z.strictObject({
    align: z.enum(["start", "center", "end"]),
    bounds: nativeRectSchema,
    color: srgbaColorV2Schema,
    font: fontSchema,
    fontSize: positiveFiniteNumberV2Schema,
    id: idV2Schema,
    kind: z.literal("text"),
    lineHeight: positiveFiniteNumberV2Schema,
    maxCodePoints: positiveSafeUIntV2Schema,
    overflow: z.enum(["clip", "ellipsis"]),
    semanticNodeId: idV2Schema,
    value: nativeTextValueSchema,
  }),
]);
const nativeArtifactSchema = z.strictObject({
  contractVersion: z.literal(1),
  id: idV2Schema,
  kind: z.literal("native-ui"),
  nodes: z.record(idV2Schema, nativeNodeSchema),
  requiredFeatures: z.array(requiredNativeFeatureSchema),
  rootNodeId: idV2Schema,
});
const videoArtifactSchema = z.strictObject({
  alpha: z.boolean(),
  assetId: idV2Schema,
  audio: z.boolean(),
  checksum: contentHashV2Schema,
  codec: z.enum(["h264", "vp9", "av1"]),
  contractVersion: z.literal(1),
  durationMilliseconds: positiveSafeUIntV2Schema,
  encodedSizeBytes: safeUIntV2Schema,
  id: idV2Schema,
  kind: z.literal("video"),
  loop: z.boolean(),
  mediaType: z.literal("video/mp4"),
  pixelSize: z.tuple([positiveSafeUIntV2Schema, positiveSafeUIntV2Schema]),
  requiredFeatures: z.array(requiredVideoFeatureSchema),
});
const artifactSchema = z.discriminatedUnion("kind", [
  bakedWebArtifactV2Schema,
  nativeArtifactSchema,
  videoArtifactSchema,
]);
const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ artifactIds: z.array(idV2Schema).min(1), kind: z.literal("artifacts") }),
]);
const regionSchema = z.strictObject({
  bounds: z.strictObject({
    height: positiveFiniteNumberV2Schema.max(1),
    width: positiveFiniteNumberV2Schema.max(1),
    x: finiteNumberV2Schema.min(0).max(1),
    y: finiteNumberV2Schema.min(0).max(1),
  }),
  coordinateSpace: z.literal("normalized"),
  interactionId: idV2Schema,
  priority: uint32V2Schema,
  semanticNodeId: idV2Schema,
});
const renderSurfaceSchema = z.strictObject({
  artifacts: z.record(idV2Schema, artifactSchema),
  id: idV2Schema,
  layer: uint32V2Schema,
  logicalBounds: boundsV2Schema,
  partitionStrategyVersion: z.literal(1),
  semanticSurfaceId: idV2Schema,
  stateBindings: z.record(idV2Schema, bindingSchema),
});
const compiledSurfaceSchema = z.strictObject({
  interactionsByState: z.record(idV2Schema, z.array(regionSchema)),
  logicalSize: positiveVector2V2Schema,
  physicalSizeMeters: positiveVector2V2Schema,
  renderSurfaceIds: z.array(idV2Schema),
  renderSurfaces: z.record(idV2Schema, renderSurfaceSchema),
  semanticsByState: z.record(idV2Schema, completedSemanticTreeV2Schema),
  semanticSurfaceId: idV2Schema,
});
const compiledModelSchema = z.strictObject({
  animationClipCount: safeUIntV2Schema,
  assetId: idV2Schema,
  checksum: contentHashV2Schema,
  clips: z.record(
    idV2Schema,
    z.strictObject({
      durationMilliseconds: positiveSafeUIntV2Schema,
      sourceAnimationIndex: uint32V2Schema,
    }),
  ),
  encodedSizeBytes: safeUIntV2Schema,
  materials: z.record(
    idV2Schema,
    z.strictObject({
      alphaCutoff: z.number().min(0).max(1).optional(),
      alphaMode: z.enum(["opaque", "mask", "blend"]),
      doubleSided: z.boolean(),
      shaderModel: z.enum(["pbrMetallicRoughness", "unlit"]),
      sourceMaterialIndex: safeUIntV2Schema,
    }),
  ),
  maxBonesPerSkin: safeUIntV2Schema,
  maxMorphTargetsPerPrimitive: safeUIntV2Schema,
  mediaType: z.literal("model/gltf-binary"),
  nodeCount: safeUIntV2Schema,
  primitiveCount: safeUIntV2Schema,
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
  triangleCount: safeUIntV2Schema,
  vertexCount: safeUIntV2Schema,
});

export const renderBundleV2Schema = z.strictObject({
  buildContext: z.strictObject({
    colorScheme: z.enum(["light", "dark"]),
    locale: idV2Schema,
    textureBuildPolicy: z.strictObject({
      policyVersion: z.literal(1),
      resolutionPolicyVersion: z.literal(1),
      policyHash: contentHashV2Schema,
      longEdgePixels: positiveSafeUIntV2Schema,
      maxStatesPerRenderSurface: positiveSafeUIntV2Schema,
      maxRenderSurfacesPerSemanticSurface: positiveSafeUIntV2Schema,
      maxRenderSurfacesPerBundle: positiveSafeUIntV2Schema,
      maxTextureBindings: positiveSafeUIntV2Schema,
      maxTextureWidth: positiveSafeUIntV2Schema,
      maxTextureHeight: positiveSafeUIntV2Schema,
      maxTexturePixels: positiveSafeUIntV2Schema,
      maxRenderedPixels: positiveSafeUIntV2Schema,
      maxSurfaceCaptureBytes: positiveSafeUIntV2Schema,
      maxBuildOutputBytes: positiveSafeUIntV2Schema,
      maxBuildAccountedPeakBytes: positiveSafeUIntV2Schema,
      rendererConcurrency: z.literal(1),
    }),
    themeHash: contentHashV2Schema,
    themeId: idV2Schema,
    timezone: idV2Schema,
  }),
  bundleId: idV2Schema,
  compiler: z.strictObject({
    environmentHash: contentHashV2Schema,
    name: idV2Schema,
    version: idV2Schema,
  }),
  definitionHash: contentHashV2Schema,
  models: z.record(idV2Schema, compiledModelSchema),
  schemaVersion: z.literal(2),
  sourceHash: contentHashV2Schema,
  surfaces: z.record(idV2Schema, compiledSurfaceSchema),
});

export type RenderBundleV2 = z.infer<typeof renderBundleV2Schema>;
export type TextureArtifactV2 = z.infer<typeof textureArtifactV2Schema>;
