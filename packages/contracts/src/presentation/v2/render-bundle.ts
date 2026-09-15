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
const textureSchema = z.strictObject({
  assetId: idV2Schema,
  mediaType: z.literal("image/png"),
  pixelSize: z.tuple([positiveSafeUIntV2Schema, positiveSafeUIntV2Schema]),
  checksum: contentHashV2Schema,
  encodedSizeBytes: safeUIntV2Schema,
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight"]),
  mipCount: z.literal(1),
  gpuBytes: safeUIntV2Schema,
});
const bakedArtifactSchema = z.strictObject({
  id: idV2Schema,
  kind: z.literal("baked-web"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredBakedFeatureSchema),
  states: z.record(idV2Schema, z.strictObject({ stateId: idV2Schema, texture: textureSchema })),
});
const codePointRangeSchema = z.tuple([
  uint32V2Schema.max(1_114_111),
  uint32V2Schema.max(1_114_111),
]);
const fontFaceSchema = z.strictObject({
  assetId: idV2Schema,
  supportedCodePointRanges: z.array(codePointRangeSchema).min(1),
});
const fontSchema = z.strictObject({ primary: fontFaceSchema, fallbacks: z.array(fontFaceSchema) });
const nativeTextValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({
    kind: z.literal("variableString"),
    variableId: idV2Schema,
    expectedType: z.literal("string"),
    format: z.strictObject({
      kind: z.literal("string"),
      allowedCodePointRanges: z.array(codePointRangeSchema).min(1),
    }),
  }),
  z.strictObject({
    kind: z.literal("variableBoolean"),
    variableId: idV2Schema,
    expectedType: z.literal("boolean"),
    format: z.strictObject({
      kind: z.literal("boolean"),
      trueLabel: z.string(),
      falseLabel: z.string(),
    }),
  }),
  z.strictObject({
    kind: z.literal("variableNumber"),
    variableId: idV2Schema,
    expectedType: z.literal("number"),
    format: z.strictObject({
      kind: z.literal("number"),
      fractionDigits: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }),
  }),
  z.strictObject({
    kind: z.literal("stepTimerRemaining"),
    groupId: idV2Schema,
    stepId: idV2Schema,
    cueId: idV2Schema,
    durationMilliseconds: positiveSafeUIntV2Schema,
    whenStepInactive: z.enum(["empty", "zero"]),
    format: z.enum(["mm:ss", "hh:mm:ss"]),
  }),
]);
const nativeRectSchema = z.strictObject({
  x: finiteNumberV2Schema,
  y: finiteNumberV2Schema,
  width: nonNegativeFiniteNumberV2Schema,
  height: nonNegativeFiniteNumberV2Schema,
  coordinateSpace: z.literal("renderSurfaceLogical"),
});
const nativeNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("group"),
    id: idV2Schema,
    bounds: nativeRectSchema,
    clip: z.boolean(),
    children: z.array(idV2Schema),
  }),
  z.strictObject({
    kind: z.literal("text"),
    id: idV2Schema,
    bounds: nativeRectSchema,
    semanticNodeId: idV2Schema,
    value: nativeTextValueSchema,
    font: fontSchema,
    color: srgbaColorV2Schema,
    fontSize: positiveFiniteNumberV2Schema,
    lineHeight: positiveFiniteNumberV2Schema,
    align: z.enum(["start", "center", "end"]),
    overflow: z.enum(["clip", "ellipsis"]),
    maxCodePoints: positiveSafeUIntV2Schema,
  }),
]);
const nativeArtifactSchema = z.strictObject({
  id: idV2Schema,
  kind: z.literal("native-ui"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredNativeFeatureSchema),
  rootNodeId: idV2Schema,
  nodes: z.record(idV2Schema, nativeNodeSchema),
});
const videoArtifactSchema = z.strictObject({
  id: idV2Schema,
  kind: z.literal("video"),
  contractVersion: z.literal(1),
  requiredFeatures: z.array(requiredVideoFeatureSchema),
  assetId: idV2Schema,
  checksum: contentHashV2Schema,
  encodedSizeBytes: safeUIntV2Schema,
  mediaType: z.literal("video/mp4"),
  codec: z.enum(["h264", "vp9", "av1"]),
  durationMilliseconds: positiveSafeUIntV2Schema,
  loop: z.boolean(),
  alpha: z.boolean(),
  audio: z.boolean(),
  pixelSize: z.tuple([positiveSafeUIntV2Schema, positiveSafeUIntV2Schema]),
});
const artifactSchema = z.discriminatedUnion("kind", [
  bakedArtifactSchema,
  nativeArtifactSchema,
  videoArtifactSchema,
]);
const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("artifacts"), artifactIds: z.array(idV2Schema).min(1) }),
]);
const regionSchema = z.strictObject({
  interactionId: idV2Schema,
  semanticNodeId: idV2Schema,
  bounds: z.strictObject({
    x: finiteNumberV2Schema.min(0).max(1),
    y: finiteNumberV2Schema.min(0).max(1),
    width: positiveFiniteNumberV2Schema.max(1),
    height: positiveFiniteNumberV2Schema.max(1),
  }),
  coordinateSpace: z.literal("normalized"),
  priority: uint32V2Schema,
});
const renderSurfaceSchema = z.strictObject({
  id: idV2Schema,
  semanticSurfaceId: idV2Schema,
  logicalBounds: boundsV2Schema,
  layer: uint32V2Schema,
  artifacts: z.record(idV2Schema, artifactSchema),
  stateBindings: z.record(idV2Schema, bindingSchema),
});
const compiledSurfaceSchema = z.strictObject({
  semanticSurfaceId: idV2Schema,
  logicalSize: positiveVector2V2Schema,
  physicalSizeMeters: positiveVector2V2Schema,
  renderSurfaceIds: z.array(idV2Schema).min(1),
  renderSurfaces: z.record(idV2Schema, renderSurfaceSchema),
  semanticsByState: z.record(idV2Schema, completedSemanticTreeV2Schema),
  interactionsByState: z.record(idV2Schema, z.array(regionSchema)),
});
const compiledModelSchema = z.strictObject({
  assetId: idV2Schema,
  mediaType: z.literal("model/gltf-binary"),
  checksum: contentHashV2Schema,
  encodedSizeBytes: safeUIntV2Schema,
  nodeCount: safeUIntV2Schema,
  primitiveCount: safeUIntV2Schema,
  vertexCount: safeUIntV2Schema,
  triangleCount: safeUIntV2Schema,
  maxBonesPerSkin: safeUIntV2Schema,
  maxMorphTargetsPerPrimitive: safeUIntV2Schema,
  animationClipCount: safeUIntV2Schema,
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
    idV2Schema,
    z.strictObject({
      sourceMaterialIndex: safeUIntV2Schema,
      shaderModel: z.enum(["pbrMetallicRoughness", "unlit"]),
      alphaMode: z.enum(["opaque", "mask", "blend"]),
      alphaCutoff: z.number().min(0).max(1).optional(),
      doubleSided: z.boolean(),
    }),
  ),
  clips: z.record(
    idV2Schema,
    z.strictObject({
      sourceAnimationIndex: uint32V2Schema,
      durationMilliseconds: positiveSafeUIntV2Schema,
    }),
  ),
});

export const renderBundleV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  bundleId: idV2Schema,
  sourceHash: contentHashV2Schema,
  definitionHash: contentHashV2Schema,
  compiler: z.strictObject({
    name: idV2Schema,
    version: idV2Schema,
    environmentHash: contentHashV2Schema,
  }),
  buildContext: z.strictObject({
    locale: idV2Schema,
    timezone: idV2Schema,
    colorScheme: z.enum(["light", "dark"]),
    themeId: idV2Schema,
    themeHash: contentHashV2Schema,
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
  }),
  surfaces: z.record(idV2Schema, compiledSurfaceSchema),
  models: z.record(idV2Schema, compiledModelSchema),
});

export type RenderBundleV2 = z.infer<typeof renderBundleV2Schema>;
