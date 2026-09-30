import * as z from "zod";

import {
  idSchema,
  positiveNumberSchema,
  positiveVector3Schema,
  quaternionSchema,
  semanticTreeSchema,
  vector2Schema,
  vector3Schema,
} from "./common";

const ownerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ groupId: idSchema, kind: z.literal("group") }),
]);

const audienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);

const parentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: idSchema }),
  z.strictObject({
    followPosition: z.boolean(),
    followRotation: z.boolean(),
    kind: z.literal("anchor"),
    owner: z.strictObject({ kind: z.literal("presenter") }),
    target: z.enum(["head", "leftHand", "rightHand", "body"]),
  }),
]);

const absolutePlacementSchema = z.strictObject({
  height: positiveNumberSchema,
  kind: z.literal("absolute"),
  width: positiveNumberSchema,
  x: z.number(),
  y: z.number(),
});

const frameSchema = z.strictObject({
  children: z.array(idSchema),
  id: idSchema,
  kind: z.literal("frame"),
  layout: z.strictObject({ kind: z.literal("absolute") }),
  order: z.number(),
  parentId: idSchema.nullable(),
});

const textSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("text"),
  order: z.number(),
  parentId: idSchema.nullable(),
  placement: absolutePlacementSchema,
  text: z.string(),
});

const contentNodeSchema = z.discriminatedUnion("kind", [frameSchema, textSchema]);

const interactionSchema = z.strictObject({
  event: idSchema,
  id: idSchema,
  kind: z.literal("click"),
});

const nodeOverrideSchema = z.strictObject({
  alt: z.string().nullable().optional(),
  included: z.boolean().optional(),
  language: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
});

const uniqueIdArraySchema = z
  .array(idSchema)
  .refine((ids) => new Set(ids).size === ids.length, "Interaction IDs must be unique")
  .meta({ uniqueItems: true });

const stateSchema = z.strictObject({
  enabledInteractionIds: uniqueIdArraySchema,
  id: idSchema,
  semanticOverrides: z.array(z.strictObject({ nodes: z.record(z.string(), nodeOverrideSchema) })),
});

const renderIntentSchema = z.strictObject({
  fallbackPolicy: z.enum(["reject", "degrade"]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ events: z.array(idSchema).min(1), kind: z.literal("regions") }),
    z.strictObject({ kind: z.literal("native-input") }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ durationSeconds: positiveNumberSchema, kind: z.literal("precomputed") }),
    z.strictObject({ kind: z.literal("runtime") }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: z.array(idSchema).min(1) }),
    z.strictObject({
      kind: z.literal("continuous"),
      maximumUpdateRateHz: positiveNumberSchema.optional(),
      source: z.enum(["timeline", "runtime-data", "user-input"]),
    }),
  ]),
});

export const semanticSurfaceSchema = z.strictObject({
  baseSemanticTree: semanticTreeSchema,
  contentNodes: z.record(z.string(), contentNodeSchema),
  fit: z.enum(["contain", "cover", "stretch"]),
  hostNodeId: idSchema,
  id: idSchema,
  initialStateId: idSchema,
  interactions: z.record(z.string(), interactionSchema),
  logicalSize: vector2Schema,
  physicalSizeMeters: vector2Schema,
  renderIntent: renderIntentSchema,
  rootFrameId: idSchema,
  states: z.record(z.string(), stateSchema),
});

const surfaceNodeSchema = z.strictObject({
  active: z.boolean(),
  audience: audienceSchema,
  id: idSchema,
  kind: z.literal("surface"),
  name: z.string().optional(),
  opacity: z.number().min(0).max(1),
  order: z.number(),
  owner: ownerSchema,
  parent: parentSchema,
  surfaceId: idSchema,
  transform: z.strictObject({
    position: vector3Schema,
    rotation: quaternionSchema,
    scale: positiveVector3Schema,
  }),
  visible: z.boolean(),
});

const variableSchema = z.strictObject({
  id: idSchema,
  initialValue: z.union([z.string(), z.boolean(), z.number(), z.null()]),
  owner: ownerSchema,
  type: z.enum(["string", "boolean", "number", "null"]),
});

const stepSchema = z.strictObject({
  cues: z.array(z.unknown()).max(0),
  id: idSchema,
});

const groupSchema = z.strictObject({
  id: idSchema,
  initialStepId: idSchema,
  steps: z.record(z.string(), stepSchema),
});

export const presentationDefinitionSchema = z.strictObject({
  assets: z.record(
    z.string(),
    z.strictObject({ checksum: idSchema, id: idSchema, mediaType: idSchema }),
  ),
  flow: z.strictObject({
    groups: z.record(z.string(), groupSchema),
    initialGroupId: idSchema,
    variables: z.record(z.string(), variableSchema),
  }),
  metadata: z.strictObject({ title: z.string().min(1) }),
  presentationId: idSchema,
  scene: z.strictObject({
    nodes: z
      .record(z.string(), surfaceNodeSchema)
      .refine((nodes) => Object.keys(nodes).length > 0, "A scene must contain a node")
      .meta({ minProperties: 1 }),
    surfaces: z
      .record(z.string(), semanticSurfaceSchema)
      .refine((surfaces) => Object.keys(surfaces).length > 0, "A scene must contain a surface")
      .meta({ minProperties: 1 }),
  }),
  schemaVersion: z.literal(1),
  stage: z.strictObject({
    coordinateSystem: z.strictObject({
      forwardAxis: z.literal("-Z"),
      handedness: z.literal("right"),
      unit: z.literal("meter"),
      upAxis: z.literal("+Y"),
    }),
    size: positiveVector3Schema,
    zones: z.record(
      z.string(),
      z.strictObject({
        center: vector3Schema,
        id: idSchema,
        owner: ownerSchema,
        size: positiveVector3Schema,
      }),
    ),
  }),
});

export type SerializedPresentationDefinitionV1 = z.infer<typeof presentationDefinitionSchema>;
