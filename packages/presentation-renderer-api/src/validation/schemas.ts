import * as z from "zod";

export const rendererIdSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const positiveNumberSchema = finiteNumberSchema.positive();
const nonNegativeIntegerSchema = z.int().nonnegative();
const uniqueIdArraySchema = z
  .array(rendererIdSchema)
  .refine((values) => new Set(values).size === values.length);

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

const semanticNodeSchema = z.strictObject({
  id: rendererIdSchema,
  parentId: rendererIdSchema.nullable(),
  order: nonNegativeIntegerSchema,
  role: z.enum(["heading", "paragraph", "image", "button", "table", "list", "listItem"]),
  text: z.string().optional(),
  language: rendererIdSchema.optional(),
  alt: z.string().optional(),
  interactionId: rendererIdSchema.optional(),
});

const semanticTreeSchema = z.strictObject({
  rootNodeIds: uniqueIdArraySchema,
  nodes: z.record(rendererIdSchema, semanticNodeSchema),
});

const interactionSchema = z.strictObject({
  id: rendererIdSchema,
  kind: z.literal("click"),
  event: rendererIdSchema,
});

const stateSchema = z.strictObject({
  id: rendererIdSchema,
  semanticOverrides: z.array(
    z.strictObject({
      nodes: z.record(
        z.string(),
        z.strictObject({
          included: z.boolean().optional(),
          text: z.string().nullable().optional(),
          language: rendererIdSchema.nullable().optional(),
          alt: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
  enabledInteractionIds: uniqueIdArraySchema,
});

const sourceIntentSchema = z.strictObject({
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: uniqueIdArraySchema.min(1) }),
    z.strictObject({
      kind: z.literal("continuous"),
      source: z.enum(["timeline", "runtime-data", "user-input"]),
      maximumUpdateRateHz: positiveNumberSchema.optional(),
    }),
  ]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("native-input") }),
    z.strictObject({ kind: z.literal("regions"), events: uniqueIdArraySchema.min(1) }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("runtime") }),
    z.strictObject({ kind: z.literal("precomputed"), durationSeconds: positiveNumberSchema }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  fallbackPolicy: z.enum(["reject", "degrade"]),
});

const resolvedIntentSchema = z.strictObject({
  updateModel: sourceIntentSchema.shape.updateModel,
  interaction: sourceIntentSchema.shape.interaction,
  internalAnimation: sourceIntentSchema.shape.internalAnimation,
  selectedRendererId: rendererIdSchema,
  fallbackPolicy: z.enum(["reject", "degrade"]),
});

const contentNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: rendererIdSchema,
    kind: z.literal("frame"),
    parentId: rendererIdSchema.nullable(),
    order: nonNegativeIntegerSchema,
    layout: z.strictObject({ kind: z.literal("absolute") }),
    children: z.array(rendererIdSchema),
  }),
  z.strictObject({
    id: rendererIdSchema,
    kind: z.literal("text"),
    parentId: rendererIdSchema.nullable(),
    order: nonNegativeIntegerSchema,
    placement: z.strictObject({
      kind: z.literal("absolute"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: positiveNumberSchema,
      height: positiveNumberSchema,
    }),
    text: z.string(),
  }),
]);

const surfaceSchema = z.strictObject({
  id: rendererIdSchema,
  hostNodeId: rendererIdSchema,
  physicalSizeMeters: z.tuple([positiveNumberSchema, positiveNumberSchema]),
  logicalSize: z.tuple([positiveNumberSchema, positiveNumberSchema]),
  fit: z.enum(["contain", "cover", "stretch"]),
  rootFrameId: rendererIdSchema,
  contentNodes: z.record(rendererIdSchema, contentNodeSchema),
  baseSemanticTree: semanticTreeSchema,
  interactions: z.record(rendererIdSchema, interactionSchema),
  initialStateId: rendererIdSchema,
  states: z.record(rendererIdSchema, stateSchema),
  renderIntent: sourceIntentSchema,
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
  surface: surfaceSchema,
  sourceIntent: sourceIntentSchema,
  resolvedIntent: resolvedIntentSchema,
  semanticsByState: z.record(rendererIdSchema, semanticTreeSchema),
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
  event: rendererIdSchema,
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
