import * as z from "zod";

import {
  actionValueSchema,
  easingSchema,
  finiteNumberSchema,
  idSchema,
  nonNegativeFiniteNumberSchema,
  positiveFiniteNumberSchema,
  positiveSafeUIntSchema,
  positiveVector2Schema,
  positiveVector3Schema,
  projectionAudienceSchema,
  quaternionSchema,
  resourceOwnerSchema,
  safeUIntSchema,
  scalarTypeSchema,
  scalarSchema,
  spatialParentSchema,
  srgbColorSchema,
  srgbaColorSchema,
  transformSchema,
  uint32Schema,
  unitIntervalSchema,
  vector3Schema,
} from "./common";
import { semanticTreeDefinitionSchema, surfaceSemanticOverrideSchema } from "./semantics";

const edgeInsetsSchema = z.strictObject({
  top: nonNegativeFiniteNumberSchema,
  right: nonNegativeFiniteNumberSchema,
  bottom: nonNegativeFiniteNumberSchema,
  left: nonNegativeFiniteNumberSchema,
});
const absolutePlacementSchema = z.strictObject({
  kind: z.literal("absolute"),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: positiveFiniteNumberSchema,
  height: positiveFiniteNumberSchema,
});
const stackPlacementSchema = z.strictObject({
  kind: z.literal("stack"),
  grow: nonNegativeFiniteNumberSchema,
  width: positiveFiniteNumberSchema,
  height: positiveFiniteNumberSchema,
  alignSelf: z.enum(["auto", "start", "center", "end", "stretch"]),
  margin: edgeInsetsSchema,
});
const gridPlacementSchema = z.strictObject({
  kind: z.literal("grid"),
  column: positiveSafeUIntSchema,
  row: positiveSafeUIntSchema,
  columnSpan: positiveSafeUIntSchema,
  rowSpan: positiveSafeUIntSchema,
  width: positiveFiniteNumberSchema,
  height: positiveFiniteNumberSchema,
  alignSelf: z.enum(["start", "center", "end", "stretch"]),
  justifySelf: z.enum(["start", "center", "end", "stretch"]),
  margin: edgeInsetsSchema,
});
const placementSchema = z.discriminatedUnion("kind", [
  absolutePlacementSchema,
  stackPlacementSchema,
  gridPlacementSchema,
]);
const absoluteLayoutSchema = z.strictObject({ kind: z.literal("absolute") });
const stackLayoutSchema = z.strictObject({
  kind: z.literal("stack"),
  direction: z.enum(["horizontal", "vertical"]),
  gap: nonNegativeFiniteNumberSchema,
  padding: edgeInsetsSchema,
  alignItems: z.enum(["start", "center", "end", "stretch"]),
  justifyContent: z.enum(["start", "center", "end", "spaceBetween"]),
});
const gridTrackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), size: positiveFiniteNumberSchema }),
  z.strictObject({ kind: z.literal("fraction"), fraction: positiveFiniteNumberSchema }),
]);
const gridLayoutSchema = z.strictObject({
  kind: z.literal("grid"),
  columns: z.array(gridTrackSchema).min(1),
  rows: z.array(gridTrackSchema).min(1),
  columnGap: nonNegativeFiniteNumberSchema,
  rowGap: nonNegativeFiniteNumberSchema,
  padding: edgeInsetsSchema,
});
const frameLayoutSchema = z.discriminatedUnion("kind", [
  absoluteLayoutSchema,
  stackLayoutSchema,
  gridLayoutSchema,
]);
const borderSchema = z.strictObject({
  color: srgbaColorSchema,
  width: nonNegativeFiniteNumberSchema,
  radius: nonNegativeFiniteNumberSchema,
});
const commonContent = {
  id: idSchema,
  parentId: idSchema.nullable(),
  order: uint32Schema,
  semanticNodeId: idSchema.optional(),
  visible: z.boolean(),
  opacity: unitIntervalSchema,
};
const placedContent = { ...commonContent, placement: placementSchema };
const frameContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("frame"),
  children: z.array(idSchema),
  layout: frameLayoutSchema,
  backgroundColor: srgbaColorSchema,
  border: borderSchema,
  clip: z.boolean(),
});
const textStyleSchema = z.strictObject({
  fontAssetId: idSchema,
  fallbackFontAssetIds: z.array(idSchema),
  fontSize: positiveFiniteNumberSchema,
  lineHeight: positiveFiniteNumberSchema,
  color: srgbaColorSchema,
  weight: z.enum(["regular", "bold"]),
  align: z.enum(["start", "center", "end"]),
  overflow: z.enum(["clip", "ellipsis"]),
});
const textContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("text"),
  value: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("literal"), value: z.string() }),
    z.strictObject({
      kind: z.literal("variableString"),
      variableId: idSchema,
      expectedType: z.literal("string"),
      format: z.strictObject({
        kind: z.literal("string"),
        allowedCodePointRanges: z
          .array(z.tuple([uint32Schema.max(1_114_111), uint32Schema.max(1_114_111)]))
          .min(1),
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
  ]),
  maxCodePoints: positiveSafeUIntSchema,
  style: textStyleSchema,
});
const imageStyleSchema = z.strictObject({
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorSchema,
  border: borderSchema,
});
const imageContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("image"),
  assetId: idSchema,
  style: imageStyleSchema,
});
const shapeGeometrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rectangle"),
    width: positiveFiniteNumberSchema,
    height: positiveFiniteNumberSchema,
    radius: nonNegativeFiniteNumberSchema,
  }),
  z.strictObject({
    kind: z.literal("ellipse"),
    width: positiveFiniteNumberSchema,
    height: positiveFiniteNumberSchema,
  }),
  z.strictObject({
    kind: z.literal("line"),
    endX: finiteNumberSchema,
    endY: finiteNumberSchema,
  }),
]);
const shapeStyleSchema = z.strictObject({
  fill: srgbaColorSchema,
  stroke: srgbaColorSchema,
  strokeWidth: nonNegativeFiniteNumberSchema,
});
const shapeContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("shape"),
  geometry: shapeGeometrySchema,
  style: shapeStyleSchema,
});
const videoStyleSchema = z.strictObject({
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorSchema,
  border: borderSchema,
});
const videoContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("video"),
  assetId: idSchema,
  loop: z.boolean(),
  style: videoStyleSchema,
});
export const surfaceContentNodeSchema = z.discriminatedUnion("kind", [
  frameContentSchema,
  textContentSchema,
  imageContentSchema,
  shapeContentSchema,
  videoContentSchema,
]);
const surfaceContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("structured"),
    rootFrameId: idSchema,
    nodes: z.record(idSchema, surfaceContentNodeSchema),
  }),
  z.strictObject({
    kind: z.literal("opaque"),
    bindings: z.record(idSchema, idSchema),
  }),
]);

const commonOverride = {
  visible: z.boolean().optional(),
  opacity: unitIntervalSchema.optional(),
  placement: placementSchema.optional(),
};
const contentOverrideSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonOverride,
    kind: z.literal("frame"),
    layout: frameLayoutSchema.optional(),
    backgroundColor: srgbaColorSchema.optional(),
    border: borderSchema.optional(),
    clip: z.boolean().optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("text"),
    value: textContentSchema.shape.value.optional(),
    style: textStyleSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("image"),
    assetId: idSchema.optional(),
    style: imageStyleSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("shape"),
    geometry: shapeGeometrySchema.optional(),
    style: shapeStyleSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("video"),
    loop: z.boolean().optional(),
    style: videoStyleSchema.optional(),
  }),
]);

const triggerActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presenter") }),
  z.strictObject({
    kind: z.literal("system"),
    source: z.enum(["tracking", "timer", "timeline", "media", "runtime"]).optional(),
  }),
]);
const trackedSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("participant"),
    owner: z.strictObject({ kind: z.literal("presenter") }),
  }),
  z.strictObject({
    kind: z.literal("anchor"),
    owner: z.strictObject({ kind: z.literal("presenter") }),
    target: z.enum(["head", "leftHand", "rightHand", "body"]),
  }),
]);
const triggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("logicalInput"),
    action: idSchema,
    actor: triggerActorSchema,
  }),
  z.strictObject({
    kind: z.literal("semanticEvent"),
    event: idSchema,
    actor: triggerActorSchema,
  }),
  z.strictObject({
    kind: z.literal("surfaceInteraction"),
    actor: triggerActorSchema,
    surfaceId: idSchema,
    interactionId: idSchema,
  }),
  z.strictObject({
    kind: z.literal("zoneEdge"),
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    subject: trackedSubjectSchema,
    zoneId: idSchema,
    edge: z.enum(["enter", "exit"]),
    dwellMilliseconds: safeUIntSchema.optional(),
    hysteresisMeters: nonNegativeFiniteNumberSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("motion"),
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    subject: trackedSubjectSchema,
    minimumDistanceMeters: positiveFiniteNumberSchema,
    windowMilliseconds: positiveSafeUIntSchema,
  }),
  z.strictObject({ kind: z.literal("timer"), afterMilliseconds: positiveSafeUIntSchema }),
  z.strictObject({ kind: z.literal("timelineCompleted"), timelineId: idSchema }),
  z.strictObject({ kind: z.literal("mediaCompleted"), surfaceId: idSchema }),
  z.strictObject({ kind: z.literal("modelClipCompleted"), nodeId: idSchema, clipId: idSchema }),
]);
const valueReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idSchema }),
  z.strictObject({ kind: z.literal("surfaceState"), surfaceId: idSchema }),
  z.strictObject({
    kind: z.literal("nodeField"),
    nodeId: idSchema,
    field: z.enum(["active", "visible", "opacity"]),
  }),
]);
export type Guard =
  | { kind: "all"; guards: Guard[] }
  | { kind: "any"; guards: Guard[] }
  | { kind: "not"; guard: Guard }
  | {
      kind: "compare";
      left: z.infer<typeof valueReferenceSchema>;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: z.infer<typeof scalarSchema>;
    };
const guardSchema: z.ZodType<Guard> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("all"), guards: z.array(guardSchema).min(1) }),
    z.strictObject({ kind: z.literal("any"), guards: z.array(guardSchema).min(1) }),
    z.strictObject({ kind: z.literal("not"), guard: guardSchema }),
    z.strictObject({
      kind: z.literal("compare"),
      left: valueReferenceSchema,
      operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
      right: scalarSchema,
    }),
  ]),
);
const booleanActionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idSchema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
]);
const numberActionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: finiteNumberSchema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idSchema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
]);
const nodePatchSchema = z.strictObject({
  active: booleanActionValueSchema.optional(),
  visible: booleanActionValueSchema.optional(),
  opacity: numberActionValueSchema.optional(),
  transform: transformSchema.optional(),
});
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("surface.setState"),
    surfaceId: idSchema,
    stateId: idSchema,
    transition: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("cut") }),
        z.strictObject({
          kind: z.literal("crossfade"),
          durationMilliseconds: positiveSafeUIntSchema,
          easing: easingSchema,
          completion: z.literal("blocking"),
        }),
      ])
      .optional(),
  }),
  z.strictObject({ kind: z.literal("node.patch"), nodeId: idSchema, patch: nodePatchSchema }),
  z.strictObject({
    kind: z.literal("timeline.play"),
    timelineId: idSchema,
    completion: z.enum(["blocking", "nonBlocking"]),
    conflict: z.literal("reject"),
  }),
  z.strictObject({ kind: z.literal("timeline.stop"), timelineId: idSchema }),
  z.strictObject({
    kind: z.literal("variable.set"),
    variableId: idSchema,
    value: actionValueSchema,
  }),
  z.strictObject({ kind: z.literal("media.play"), surfaceId: idSchema }),
  z.strictObject({ kind: z.literal("media.pause"), surfaceId: idSchema }),
  z.strictObject({
    kind: z.literal("media.seek"),
    surfaceId: idSchema,
    positionSeconds: numberActionValueSchema,
  }),
  z.strictObject({
    kind: z.literal("modelClip.play"),
    nodeId: idSchema,
    clipId: idSchema,
    speed: positiveFiniteNumberSchema,
    loop: z.boolean(),
    completion: z.enum(["blocking", "nonBlocking"]),
    transition: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("immediate") }),
      z.strictObject({
        kind: z.literal("crossfade"),
        durationMilliseconds: positiveSafeUIntSchema,
        easing: easingSchema,
      }),
    ]),
    conflict: z.literal("reject"),
  }),
  z.strictObject({ kind: z.literal("modelClip.pause"), nodeId: idSchema }),
  z.strictObject({ kind: z.literal("modelClip.resume"), nodeId: idSchema }),
  z.strictObject({ kind: z.literal("modelClip.stop"), nodeId: idSchema }),
]);

const spatialBase = {
  id: idSchema,
  name: z.string().min(1).optional(),
  owner: resourceOwnerSchema,
  audience: projectionAudienceSchema,
  parent: spatialParentSchema,
  order: uint32Schema,
  transform: transformSchema,
  active: z.boolean(),
  visible: z.boolean(),
  opacity: unitIntervalSchema,
};
const spatialNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...spatialBase, kind: z.literal("container") }),
  z.strictObject({ ...spatialBase, kind: z.literal("model"), assetId: idSchema }),
  z.strictObject({ ...spatialBase, kind: z.literal("surface"), surfaceId: idSchema }),
  z.strictObject({
    ...spatialBase,
    kind: z.literal("shape"),
    geometry: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("box"), size: positiveVector3Schema }),
      z.strictObject({ kind: z.literal("sphere"), radius: positiveFiniteNumberSchema }),
    ]),
    material: z.strictObject({
      shaderModel: z.literal("unlit"),
      color: srgbaColorSchema,
      doubleSided: z.boolean(),
      castsShadows: z.literal(false),
      receivesShadows: z.literal(false),
    }),
  }),
  z.strictObject({
    ...spatialBase,
    kind: z.literal("light"),
    light: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("directional"),
        color: srgbColorSchema,
        intensityLux: nonNegativeFiniteNumberSchema,
        castsShadows: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("point"),
        color: srgbColorSchema,
        intensityCandela: nonNegativeFiniteNumberSchema,
        rangeMeters: positiveFiniteNumberSchema,
        castsShadows: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("spot"),
        color: srgbColorSchema,
        intensityCandela: nonNegativeFiniteNumberSchema,
        rangeMeters: positiveFiniteNumberSchema,
        outerAngleDegrees: positiveFiniteNumberSchema.max(180),
        innerAngleDegrees: nonNegativeFiniteNumberSchema.max(180),
        castsShadows: z.boolean(),
      }),
    ]),
  }),
]);
const renderIntentSchema = z.strictObject({
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: z.array(idSchema).min(1) }),
    z.strictObject({
      kind: z.literal("continuous-native-text"),
      maximumUpdateRateHz: positiveFiniteNumberSchema,
    }),
  ]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("regions"), events: z.array(idSchema).min(1) }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("precomputed-video"),
      durationMilliseconds: positiveSafeUIntSchema,
    }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  fallbackPolicy: z.enum(["reject", "degrade"]),
});
export const semanticSurfaceSchema = z.strictObject({
  id: idSchema,
  hostNodeId: idSchema,
  physicalSizeMeters: positiveVector2Schema,
  logicalSize: positiveVector2Schema,
  fit: z.enum(["contain", "cover", "stretch"]),
  content: surfaceContentSchema,
  baseSemanticTree: semanticTreeDefinitionSchema,
  interactions: z.record(
    idSchema,
    z.strictObject({
      id: idSchema,
      kind: z.literal("click"),
      event: idSchema,
      hitPriority: uint32Schema,
    }),
  ),
  initialStateId: idSchema,
  states: z.record(
    idSchema,
    z.strictObject({
      id: idSchema,
      contentOverrides: z.record(idSchema, contentOverrideSchema),
      semanticOverrides: z.array(surfaceSemanticOverrideSchema),
      enabledInteractionIds: z.array(idSchema),
    }),
  ),
  renderIntent: renderIntentSchema,
});
const timelineValueSchema = z.union([finiteNumberSchema, vector3Schema, quaternionSchema]);
const timelineSchema = z.strictObject({
  id: idSchema,
  owner: resourceOwnerSchema,
  durationMilliseconds: positiveSafeUIntSchema,
  tracks: z
    .array(
      z.strictObject({
        target: z.strictObject({
          nodeId: idSchema,
          property: z.enum([
            "opacity",
            "transform.position",
            "transform.rotation",
            "transform.scale",
          ]),
        }),
        keyframes: z
          .array(
            z.strictObject({
              timeMilliseconds: safeUIntSchema,
              value: timelineValueSchema,
              easingToNext: easingSchema.optional(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});
const variableSchema = z.strictObject({
  id: idSchema,
  owner: resourceOwnerSchema,
  type: scalarTypeSchema,
  initialValue: scalarSchema,
});
const cueSchema = z.strictObject({
  id: idSchema,
  priority: safeUIntSchema,
  order: uint32Schema,
  trigger: triggerSchema,
  fixedPayload: z.record(idSchema, scalarSchema).optional(),
  guard: guardSchema.optional(),
  firePolicy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("oncePerStepEntry") }),
    z.strictObject({
      kind: z.literal("repeatable"),
      cooldownMilliseconds: safeUIntSchema,
    }),
  ]),
  actions: z.array(actionSchema),
  next: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stay") }),
    z.strictObject({ kind: z.literal("step"), stepId: idSchema }),
    z.strictObject({ kind: z.literal("group"), groupId: idSchema }),
    z.strictObject({ kind: z.literal("end") }),
  ]),
});

export const presentationDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(2),
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
      idSchema,
      z.strictObject({
        id: idSchema,
        owner: resourceOwnerSchema,
        center: vector3Schema,
        size: positiveVector3Schema,
      }),
    ),
  }),
  scene: z.strictObject({
    nodes: z.record(idSchema, spatialNodeSchema),
    surfaces: z.record(idSchema, semanticSurfaceSchema),
  }),
  flow: z.strictObject({
    initialGroupId: idSchema,
    groups: z.record(
      idSchema,
      z.strictObject({
        id: idSchema,
        initialStepId: idSchema,
        steps: z.record(idSchema, z.strictObject({ id: idSchema, cues: z.array(cueSchema) })),
      }),
    ),
    variables: z.record(idSchema, variableSchema),
    timelines: z.record(idSchema, timelineSchema),
  }),
});

export type PresentationDefinition = z.infer<typeof presentationDefinitionSchema>;
export type SemanticSurface = z.infer<typeof semanticSurfaceSchema>;
export type SurfaceContentNode = z.infer<typeof surfaceContentNodeSchema>;
