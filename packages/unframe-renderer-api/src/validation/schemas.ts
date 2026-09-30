import * as z from "zod";
import { completedSemanticTreeV2Schema, semanticSurfaceV2Schema } from "@unframe/unframe-core";

export const rendererIdSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const positiveNumberSchema = finiteNumberSchema.positive();
const nonNegativeIntegerSchema = z.int().nonnegative();
const boundsSchema = z.strictObject({
  height: finiteNumberSchema,
  width: finiteNumberSchema,
  x: finiteNumberSchema,
  y: finiteNumberSchema,
});

export const renderLayerSchema = nonNegativeIntegerSchema;
export const pixelTargetSchema = z.tuple([z.int().positive(), z.int().positive()]);
export const renderStateIdsSchema = z.array(rendererIdSchema).min(1);
export const capturePixelSizeSchema = pixelTargetSchema;
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
  fallbackPolicy: z.enum(["reject", "degrade"]),
  interaction: sourceIntentSchema.shape.interaction,
  internalAnimation: sourceIntentSchema.shape.internalAnimation,
  selectedRendererId: rendererIdSchema,
  updateModel: sourceIntentSchema.shape.updateModel,
});

const renderSurfacePlanSchema = z.strictObject({
  clipWindow: boundsSchema,
  id: rendererIdSchema,
  layer: finiteNumberSchema,
  logicalBounds: boundsSchema,
  ownership: z.discriminatedUnion("kind", [
    z.strictObject({
      contextNodeIds: z.array(rendererIdSchema),
      kind: z.literal("structured"),
      ownedContentNodeIds: z.array(rendererIdSchema),
    }),
    z.strictObject({ bindingKeys: z.array(rendererIdSchema), kind: z.literal("opaque") }),
  ]),
  semanticSurfaceId: rendererIdSchema,
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
    entryId: rendererIdSchema,
    kind: z.literal("opaque"),
    moduleHash: rendererIdSchema,
  }),
]);

export const rendererIdentitySchema = z.strictObject({
  contractVersion: rendererIdSchema,
  id: rendererIdSchema,
  implementationHash: rendererIdSchema,
  version: rendererIdSchema,
});

export const rendererFunctionSchema = z.function();

export const rendererCapabilitiesSchema = z.strictObject({
  deterministic: z.literal(true),
  fallbackPolicies: z.tuple([z.literal("reject")]),
  inputKinds: z
    .array(z.enum(["structured", "opaque"]))
    .min(1)
    .max(2),
  interactions: z
    .array(z.enum(["none", "regions"]))
    .min(1)
    .max(2),
  internalAnimations: z.tuple([z.literal("none")]),
  rendererPreferences: z.tuple([z.literal("baked-web")]),
  updateModels: z
    .array(z.enum(["static", "finite-state"]))
    .min(1)
    .max(2),
});

export const rendererBuildInputSchema = z.strictObject({
  context: z.strictObject({
    buildContextHash: rendererIdSchema,
    colorScheme: z.enum(["light", "dark"]),
    environmentHash: rendererIdSchema,
    inputHash: rendererIdSchema,
    locale: rendererIdSchema,
    pixelTarget: z.tuple([finiteNumberSchema, finiteNumberSchema]),
    rendererConfigHash: rendererIdSchema,
    rendererFingerprint: rendererIdSchema,
    themeHash: rendererIdSchema,
    themeId: rendererIdSchema,
    timezone: rendererIdSchema,
  }),
  entry: rendererEntrySchema,
  fontAssets: z.record(
    rendererIdSchema,
    z.strictObject({
      checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      dataBase64: z.string().min(1),
      mediaType: z.enum(["font/ttf", "font/otf"]),
    }),
  ),
  plan: renderSurfacePlanSchema,
  resolvedIntent: resolvedIntentSchema,
  semanticsByState: z.record(rendererIdSchema, completedSemanticTreeV2Schema),
  sourceIntent: sourceIntentSchema,
  surface: semanticSurfaceV2Schema,
});

export const diagnosticSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), finiteNumberSchema])),
  relatedPath: z.array(z.union([z.string(), finiteNumberSchema])).optional(),
});

export const rendererSupportDecisionSchema = z.discriminatedUnion("supported", [
  z.strictObject({ diagnostics: z.tuple([]), supported: z.literal(true) }),
  z.strictObject({ diagnostics: z.array(diagnosticSchema), supported: z.literal(false) }),
]);

const captureSchema = z.strictObject({
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
  colorSpace: z.literal("srgb"),
  id: rendererIdSchema,
  pixelSize: z.tuple([finiteNumberSchema, finiteNumberSchema]),
  rgba: z.instanceof(Uint8Array),
  stateId: rendererIdSchema,
});

const hitRegionSchema = z.strictObject({
  bounds: boundsSchema,
  coordinateSpace: z.literal("normalized"),
  interactionId: rendererIdSchema,
  priority: finiteNumberSchema,
  semanticNodeId: rendererIdSchema,
});

export const rendererBuildResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ diagnostics: z.array(diagnosticSchema), ok: z.literal(false) }),
  z.strictObject({
    captures: z.array(captureSchema),
    diagnostics: z.array(diagnosticSchema),
    hitRegionsByState: z.record(rendererIdSchema, z.array(hitRegionSchema)).optional(),
    ok: z.literal(true),
    provenance: rendererIdentitySchema.extend({
      buildContextHash: rendererIdSchema,
      environmentHash: rendererIdSchema,
      inputHash: rendererIdSchema,
      rendererConfigHash: rendererIdSchema,
      rendererFingerprint: rendererIdSchema,
    }),
    renderSurface: z.strictObject({
      id: rendererIdSchema,
      layer: finiteNumberSchema,
      logicalBounds: boundsSchema,
      semanticSurfaceId: rendererIdSchema,
    }),
  }),
]);
