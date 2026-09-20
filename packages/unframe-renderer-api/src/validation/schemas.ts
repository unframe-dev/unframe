import * as z from "zod";
import { completedSemanticTreeV2Schema, semanticSurfaceV2Schema } from "@unframe/unframe-core";

export const rendererIdSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const positiveNumberSchema = finiteNumberSchema.positive();
const nonNegativeIntegerSchema = z.int().nonnegative();
const boundsSchema = z.strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema,
  height: finiteNumberSchema,
});

export const renderLayerSchema = nonNegativeIntegerSchema;
export const pixelTargetSchema = z.tuple([z.int().positive(), z.int().positive()]);
export const renderStateIdsSchema = z.array(rendererIdSchema).min(1);
export const capturePixelSizeSchema = pixelTargetSchema;
export const hitRegionPrioritySchema = nonNegativeIntegerSchema;
export const normalizedHitRegionBoundsSchema = boundsSchema.refine(
  ({ x, y, width, height }) =>
    x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1,
);
export const logicalBoundsConstraintSchema = z
  .strictObject({
    bounds: boundsSchema,
    logicalSize: z.tuple([positiveNumberSchema, positiveNumberSchema]),
  })
  .refine(
    ({ bounds, logicalSize }) =>
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.x + bounds.width <= logicalSize[0] &&
      bounds.y + bounds.height <= logicalSize[1],
  );

const sourceIntentSchema = semanticSurfaceV2Schema.shape.renderIntent;

const resolvedIntentSchema = z.strictObject({
  updateModel: sourceIntentSchema.shape.updateModel,
  interaction: sourceIntentSchema.shape.interaction,
  internalAnimation: sourceIntentSchema.shape.internalAnimation,
  selectedRendererId: rendererIdSchema,
  fallbackPolicy: z.enum(["reject", "degrade"]),
});

const renderSurfacePlanSchema = z.strictObject({
  id: rendererIdSchema,
  semanticSurfaceId: rendererIdSchema,
  logicalBounds: boundsSchema,
  layer: finiteNumberSchema,
  contentNodeIds: z.array(z.string()),
  states: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("capture") }),
      z.strictObject({ kind: z.literal("empty") }),
    ]),
  ),
});

const rendererEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("structured") }),
  z.strictObject({
    kind: z.literal("opaque"),
    entryId: rendererIdSchema,
    moduleHash: rendererIdSchema,
  }),
]);

export const rendererIdentitySchema = z.strictObject({
  id: rendererIdSchema,
  version: rendererIdSchema,
  contractVersion: rendererIdSchema,
  implementationHash: rendererIdSchema,
});

export const rendererFunctionSchema = z.function();

export const rendererCapabilitiesSchema = z.strictObject({
  inputKinds: z.tuple([z.literal("structured")]),
  updateModels: z.tuple([z.literal("static")]),
  interactions: z.tuple([z.literal("none")]),
  internalAnimations: z.tuple([z.literal("none")]),
  rendererPreferences: z.tuple([z.literal("baked-web")]),
  fallbackPolicies: z.tuple([z.literal("reject")]),
  deterministic: z.literal(true),
});

export const rendererBuildInputSchema = z.strictObject({
  surface: semanticSurfaceV2Schema,
  sourceIntent: sourceIntentSchema,
  resolvedIntent: resolvedIntentSchema,
  semanticsByState: z.record(rendererIdSchema, completedSemanticTreeV2Schema),
  fontAssets: z.record(
    rendererIdSchema,
    z.strictObject({
      mediaType: z.enum(["font/ttf", "font/otf"]),
      dataBase64: z.string().min(1),
      checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    }),
  ),
  plan: renderSurfacePlanSchema,
  entry: rendererEntrySchema,
  context: z.strictObject({
    locale: rendererIdSchema,
    timezone: rendererIdSchema,
    colorScheme: z.enum(["light", "dark"]),
    themeId: rendererIdSchema,
    themeHash: rendererIdSchema,
    inputHash: rendererIdSchema,
    buildContextHash: rendererIdSchema,
    environmentHash: rendererIdSchema,
    rendererConfigHash: rendererIdSchema,
    rendererFingerprint: rendererIdSchema,
    pixelTarget: z.tuple([finiteNumberSchema, finiteNumberSchema]),
  }),
});

export const diagnosticSchema = z.strictObject({
  code: z.string(),
  path: z.array(z.union([z.string(), finiteNumberSchema])),
  message: z.string(),
  relatedPath: z.array(z.union([z.string(), finiteNumberSchema])).optional(),
});

export const rendererSupportDecisionSchema = z.discriminatedUnion("supported", [
  z.strictObject({ supported: z.literal(true), diagnostics: z.tuple([]) }),
  z.strictObject({ supported: z.literal(false), diagnostics: z.array(diagnosticSchema) }),
]);

const captureSchema = z.strictObject({
  id: rendererIdSchema,
  stateId: rendererIdSchema,
  rgba: z.instanceof(Uint8Array),
  pixelSize: z.tuple([finiteNumberSchema, finiteNumberSchema]),
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
});

const hitRegionSchema = z.strictObject({
  interactionId: rendererIdSchema,
  semanticNodeId: rendererIdSchema,
  bounds: boundsSchema,
  coordinateSpace: z.literal("normalized"),
  priority: finiteNumberSchema,
});

export const rendererBuildResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), diagnostics: z.array(diagnosticSchema) }),
  z.strictObject({
    ok: z.literal(true),
    renderSurface: z.strictObject({
      id: rendererIdSchema,
      semanticSurfaceId: rendererIdSchema,
      logicalBounds: boundsSchema,
      layer: finiteNumberSchema,
    }),
    captures: z.array(captureSchema),
    hitRegionsByState: z.record(rendererIdSchema, z.array(hitRegionSchema)),
    provenance: rendererIdentitySchema.extend({
      inputHash: rendererIdSchema,
      buildContextHash: rendererIdSchema,
      environmentHash: rendererIdSchema,
      rendererConfigHash: rendererIdSchema,
      rendererFingerprint: rendererIdSchema,
    }),
    diagnostics: z.array(diagnosticSchema),
  }),
]);
