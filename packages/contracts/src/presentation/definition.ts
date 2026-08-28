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
  z.strictObject({ kind: z.literal("group"), groupId: idSchema }),
]);

const audienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);

const parentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: idSchema }),
  z.strictObject({
    kind: z.literal("anchor"),
    target: z.enum(["head", "leftHand", "rightHand", "body"]),
    owner: z.strictObject({ kind: z.literal("presenter") }),
    followPosition: z.boolean(),
    followRotation: z.boolean(),
  }),
]);

const absolutePlacementSchema = z.strictObject({
  kind: z.literal("absolute"),
  x: z.number(),
  y: z.number(),
  width: positiveNumberSchema,
  height: positiveNumberSchema,
});

const frameSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("frame"),
  parentId: idSchema.nullable(),
  order: z.number(),
  layout: z.strictObject({ kind: z.literal("absolute") }),
  children: z.array(idSchema),
});

const textSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("text"),
  parentId: idSchema.nullable(),
  order: z.number(),
  placement: absolutePlacementSchema,
  text: z.string(),
});

const contentNodeSchema = z.discriminatedUnion("kind", [frameSchema, textSchema]);

const interactionSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("click"),
  event: idSchema,
});

const nodeOverrideSchema = z.strictObject({
  included: z.boolean().optional(),
  text: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
});

const uniqueIdArraySchema = z
  .array(idSchema)
  .refine((ids) => new Set(ids).size === ids.length, "Interaction IDs must be unique")
  .meta({ uniqueItems: true });

const stateSchema = z.strictObject({
  id: idSchema,
  semanticOverrides: z.array(z.strictObject({ nodes: z.record(z.string(), nodeOverrideSchema) })),
  enabledInteractionIds: uniqueIdArraySchema,
});

const renderIntentSchema = z.strictObject({
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: z.array(idSchema).min(1) }),
    z.strictObject({
      kind: z.literal("continuous"),
      source: z.enum(["timeline", "runtime-data", "user-input"]),
      maximumUpdateRateHz: positiveNumberSchema.optional(),
    }),
  ]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("regions"), events: z.array(idSchema).min(1) }),
    z.strictObject({ kind: z.literal("native-input") }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("precomputed"), durationSeconds: positiveNumberSchema }),
    z.strictObject({ kind: z.literal("runtime") }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  fallbackPolicy: z.enum(["reject", "degrade"]),
});

export const semanticSurfaceSchema = z.strictObject({
  id: idSchema,
  hostNodeId: idSchema,
  physicalSizeMeters: vector2Schema,
  logicalSize: vector2Schema,
  fit: z.enum(["contain", "cover", "stretch"]),
  rootFrameId: idSchema,
  contentNodes: z.record(z.string(), contentNodeSchema),
  baseSemanticTree: semanticTreeSchema,
  interactions: z.record(z.string(), interactionSchema),
  initialStateId: idSchema,
  states: z.record(z.string(), stateSchema),
  renderIntent: renderIntentSchema,
});

const surfaceNodeSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),
  kind: z.literal("surface"),
  owner: ownerSchema,
  audience: audienceSchema,
  parent: parentSchema,
  order: z.number(),
  transform: z.strictObject({
    position: vector3Schema,
    rotation: quaternionSchema,
    scale: positiveVector3Schema,
  }),
  active: z.boolean(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  surfaceId: idSchema,
});

const variableSchema = z.strictObject({
  id: idSchema,
  owner: ownerSchema,
  type: z.enum(["string", "boolean", "number", "null"]),
  initialValue: z.union([z.string(), z.boolean(), z.number(), z.null()]),
});

const stepSchema = z.strictObject({
  id: idSchema,
  cues: z.array(z.unknown()).max(0),
});

const groupSchema = z.strictObject({
  id: idSchema,
  initialStepId: idSchema,
  steps: z.record(z.string(), stepSchema),
});

export const presentationDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  presentationId: idSchema,
  metadata: z.strictObject({ title: z.string().min(1) }),
  stage: z.strictObject({
    coordinateSystem: z.strictObject({
      unit: z.literal("meter"),
      handedness: z.literal("right"),
      upAxis: z.literal("+Y"),
      forwardAxis: z.literal("-Z"),
    }),
    size: positiveVector3Schema,
    zones: z.record(
      z.string(),
      z.strictObject({
        id: idSchema,
        owner: ownerSchema,
        center: vector3Schema,
        size: positiveVector3Schema,
      }),
    ),
  }),
  assets: z.record(
    z.string(),
    z.strictObject({ id: idSchema, mediaType: idSchema, checksum: idSchema }),
  ),
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
  flow: z.strictObject({
    initialGroupId: idSchema,
    groups: z.record(z.string(), groupSchema),
    variables: z.record(z.string(), variableSchema),
  }),
});

export type SerializedPresentationDefinitionV1 = z.infer<typeof presentationDefinitionSchema>;
