import * as z from "zod";

import {
  actionValueV2Schema,
  easingV2Schema,
  finiteNumberV2Schema,
  idV2Schema,
  nonNegativeFiniteNumberV2Schema,
  positiveFiniteNumberV2Schema,
  positiveSafeUIntV2Schema,
  positiveVector2V2Schema,
  positiveVector3V2Schema,
  projectionAudienceV2Schema,
  quaternionV2Schema,
  resourceOwnerV2Schema,
  safeUIntV2Schema,
  scalarTypeV2Schema,
  scalarV2Schema,
  spatialParentV2Schema,
  srgbColorV2Schema,
  srgbaColorV2Schema,
  transformV2Schema,
  uint32V2Schema,
  unitIntervalV2Schema,
  vector3V2Schema,
} from "./common";
import { semanticTreeDefinitionV2Schema, surfaceSemanticOverrideV2Schema } from "./semantics";

const edgeInsetsSchema = z.strictObject({
  bottom: nonNegativeFiniteNumberV2Schema,
  left: nonNegativeFiniteNumberV2Schema,
  right: nonNegativeFiniteNumberV2Schema,
  top: nonNegativeFiniteNumberV2Schema,
});
const absolutePlacementSchema = z.strictObject({
  height: positiveFiniteNumberV2Schema,
  kind: z.literal("absolute"),
  width: positiveFiniteNumberV2Schema,
  x: finiteNumberV2Schema,
  y: finiteNumberV2Schema,
});
const stackPlacementSchema = z.strictObject({
  alignSelf: z.enum(["auto", "start", "center", "end", "stretch"]),
  grow: nonNegativeFiniteNumberV2Schema,
  height: positiveFiniteNumberV2Schema,
  kind: z.literal("stack"),
  margin: edgeInsetsSchema,
  width: positiveFiniteNumberV2Schema,
});
const gridPlacementSchema = z.strictObject({
  alignSelf: z.enum(["start", "center", "end", "stretch"]),
  column: positiveSafeUIntV2Schema,
  columnSpan: positiveSafeUIntV2Schema,
  height: positiveFiniteNumberV2Schema,
  justifySelf: z.enum(["start", "center", "end", "stretch"]),
  kind: z.literal("grid"),
  margin: edgeInsetsSchema,
  row: positiveSafeUIntV2Schema,
  rowSpan: positiveSafeUIntV2Schema,
  width: positiveFiniteNumberV2Schema,
});
const placementSchema = z.discriminatedUnion("kind", [
  absolutePlacementSchema,
  stackPlacementSchema,
  gridPlacementSchema,
]);
const absoluteLayoutSchema = z.strictObject({ kind: z.literal("absolute") });
const stackLayoutSchema = z.strictObject({
  alignItems: z.enum(["start", "center", "end", "stretch"]),
  direction: z.enum(["horizontal", "vertical"]),
  gap: nonNegativeFiniteNumberV2Schema,
  justifyContent: z.enum(["start", "center", "end", "spaceBetween"]),
  kind: z.literal("stack"),
  padding: edgeInsetsSchema,
});
const gridTrackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), size: positiveFiniteNumberV2Schema }),
  z.strictObject({ fraction: positiveFiniteNumberV2Schema, kind: z.literal("fraction") }),
]);
const gridLayoutSchema = z.strictObject({
  columnGap: nonNegativeFiniteNumberV2Schema,
  columns: z.array(gridTrackSchema).min(1),
  kind: z.literal("grid"),
  padding: edgeInsetsSchema,
  rowGap: nonNegativeFiniteNumberV2Schema,
  rows: z.array(gridTrackSchema).min(1),
});
const frameLayoutSchema = z.discriminatedUnion("kind", [
  absoluteLayoutSchema,
  stackLayoutSchema,
  gridLayoutSchema,
]);
const borderSchema = z.strictObject({
  color: srgbaColorV2Schema,
  radius: nonNegativeFiniteNumberV2Schema,
  width: nonNegativeFiniteNumberV2Schema,
});
const commonContent = {
  id: idV2Schema,
  opacity: unitIntervalV2Schema,
  order: uint32V2Schema,
  parentId: idV2Schema.nullable(),
  semanticNodeId: idV2Schema.optional(),
  visible: z.boolean(),
};
const placedContent = { ...commonContent, placement: placementSchema };
const frameContentSchema = z.strictObject({
  ...placedContent,
  backgroundColor: srgbaColorV2Schema,
  border: borderSchema,
  children: z.array(idV2Schema),
  clip: z.boolean(),
  kind: z.literal("frame"),
  layout: frameLayoutSchema,
});
const textStyleSchema = z.strictObject({
  align: z.enum(["start", "center", "end"]),
  color: srgbaColorV2Schema,
  fallbackFontAssetIds: z.array(idV2Schema),
  fontAssetId: idV2Schema,
  fontSize: positiveFiniteNumberV2Schema,
  lineHeight: positiveFiniteNumberV2Schema,
  overflow: z.enum(["clip", "ellipsis"]),
  weight: z.enum(["regular", "bold"]),
});
const textContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("text"),
  maxCodePoints: positiveSafeUIntV2Schema,
  style: textStyleSchema,
  value: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("literal"), value: z.string() }),
    z.strictObject({
      expectedType: z.literal("string"),
      format: z.strictObject({
        kind: z.literal("string"),
        allowedCodePointRanges: z
          .array(z.tuple([uint32V2Schema.max(1_114_111), uint32V2Schema.max(1_114_111)]))
          .min(1),
      }),
      kind: z.literal("variableString"),
      variableId: idV2Schema,
    }),
    z.strictObject({
      expectedType: z.literal("boolean"),
      format: z.strictObject({
        kind: z.literal("boolean"),
        trueLabel: z.string(),
        falseLabel: z.string(),
      }),
      kind: z.literal("variableBoolean"),
      variableId: idV2Schema,
    }),
    z.strictObject({
      expectedType: z.literal("number"),
      format: z.strictObject({
        kind: z.literal("number"),
        fractionDigits: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
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
  ]),
});
const imageStyleSchema = z.strictObject({
  border: borderSchema,
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorV2Schema,
});
const imageContentSchema = z.strictObject({
  ...placedContent,
  assetId: idV2Schema,
  kind: z.literal("image"),
  style: imageStyleSchema,
});
const shapeGeometrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    height: positiveFiniteNumberV2Schema,
    kind: z.literal("rectangle"),
    radius: nonNegativeFiniteNumberV2Schema,
    width: positiveFiniteNumberV2Schema,
  }),
  z.strictObject({
    height: positiveFiniteNumberV2Schema,
    kind: z.literal("ellipse"),
    width: positiveFiniteNumberV2Schema,
  }),
  z.strictObject({
    endX: finiteNumberV2Schema,
    endY: finiteNumberV2Schema,
    kind: z.literal("line"),
  }),
]);
const shapeStyleSchema = z.strictObject({
  fill: srgbaColorV2Schema,
  stroke: srgbaColorV2Schema,
  strokeWidth: nonNegativeFiniteNumberV2Schema,
});
const shapeContentSchema = z.strictObject({
  ...placedContent,
  geometry: shapeGeometrySchema,
  kind: z.literal("shape"),
  style: shapeStyleSchema,
});
const videoStyleSchema = z.strictObject({
  border: borderSchema,
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorV2Schema,
});
const videoContentSchema = z.strictObject({
  ...placedContent,
  assetId: idV2Schema,
  kind: z.literal("video"),
  loop: z.boolean(),
  style: videoStyleSchema,
});
export const surfaceContentNodeV2Schema = z.discriminatedUnion("kind", [
  frameContentSchema,
  textContentSchema,
  imageContentSchema,
  shapeContentSchema,
  videoContentSchema,
]);
const surfaceContentV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("structured"),
    nodes: z.record(idV2Schema, surfaceContentNodeV2Schema),
    rootFrameId: idV2Schema,
  }),
  z.strictObject({
    bindings: z.record(idV2Schema, idV2Schema),
    kind: z.literal("opaque"),
  }),
]);

const commonOverride = {
  opacity: unitIntervalV2Schema.optional(),
  placement: placementSchema.optional(),
  visible: z.boolean().optional(),
};
const contentOverrideSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonOverride,
    backgroundColor: srgbaColorV2Schema.optional(),
    border: borderSchema.optional(),
    clip: z.boolean().optional(),
    kind: z.literal("frame"),
    layout: frameLayoutSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("text"),
    style: textStyleSchema.optional(),
    value: textContentSchema.shape.value.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    assetId: idV2Schema.optional(),
    kind: z.literal("image"),
    style: imageStyleSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    geometry: shapeGeometrySchema.optional(),
    kind: z.literal("shape"),
    style: shapeStyleSchema.optional(),
  }),
  z.strictObject({
    ...commonOverride,
    kind: z.literal("video"),
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
    action: idV2Schema,
    actor: triggerActorSchema,
    kind: z.literal("logicalInput"),
  }),
  z.strictObject({
    actor: triggerActorSchema,
    event: idV2Schema,
    kind: z.literal("semanticEvent"),
  }),
  z.strictObject({
    actor: triggerActorSchema,
    interactionId: idV2Schema,
    kind: z.literal("surfaceInteraction"),
    surfaceId: idV2Schema,
  }),
  z.strictObject({
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    dwellMilliseconds: safeUIntV2Schema.optional(),
    edge: z.enum(["enter", "exit"]),
    hysteresisMeters: nonNegativeFiniteNumberV2Schema.optional(),
    kind: z.literal("zoneEdge"),
    subject: trackedSubjectSchema,
    zoneId: idV2Schema,
  }),
  z.strictObject({
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    kind: z.literal("motion"),
    minimumDistanceMeters: positiveFiniteNumberV2Schema,
    subject: trackedSubjectSchema,
    windowMilliseconds: positiveSafeUIntV2Schema,
  }),
  z.strictObject({ afterMilliseconds: positiveSafeUIntV2Schema, kind: z.literal("timer") }),
  z.strictObject({ kind: z.literal("timelineCompleted"), timelineId: idV2Schema }),
  z.strictObject({ kind: z.literal("mediaCompleted"), surfaceId: idV2Schema }),
  z.strictObject({ clipId: idV2Schema, kind: z.literal("modelClipCompleted"), nodeId: idV2Schema }),
]);
const valueReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
  z.strictObject({ field: idV2Schema, kind: z.literal("eventPayload") }),
  z.strictObject({ kind: z.literal("surfaceState"), surfaceId: idV2Schema }),
  z.strictObject({
    field: z.enum(["active", "visible", "opacity"]),
    kind: z.literal("nodeField"),
    nodeId: idV2Schema,
  }),
]);
export type GuardV2 =
  | { guards: Array<GuardV2>; kind: "all" }
  | { guards: Array<GuardV2>; kind: "any" }
  | { guard: GuardV2; kind: "not" }
  | {
      kind: "compare";
      left: z.infer<typeof valueReferenceSchema>;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: z.infer<typeof scalarV2Schema>;
    };
const guardSchema: z.ZodType<GuardV2> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ guards: z.array(guardSchema).min(1), kind: z.literal("all") }),
    z.strictObject({ guards: z.array(guardSchema).min(1), kind: z.literal("any") }),
    z.strictObject({ guard: guardSchema, kind: z.literal("not") }),
    z.strictObject({
      kind: z.literal("compare"),
      left: valueReferenceSchema,
      operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
      right: scalarV2Schema,
    }),
  ]),
);
const booleanActionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.boolean() }),
  z.strictObject({ field: idV2Schema, kind: z.literal("eventPayload") }),
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
]);
const numberActionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: finiteNumberV2Schema }),
  z.strictObject({ field: idV2Schema, kind: z.literal("eventPayload") }),
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
]);
const nodePatchSchema = z.strictObject({
  active: booleanActionValueSchema.optional(),
  opacity: numberActionValueSchema.optional(),
  transform: transformV2Schema.optional(),
  visible: booleanActionValueSchema.optional(),
});
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("surface.setState"),
    stateId: idV2Schema,
    surfaceId: idV2Schema,
    transition: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("cut") }),
        z.strictObject({
          completion: z.literal("blocking"),
          durationMilliseconds: positiveSafeUIntV2Schema,
          easing: easingV2Schema,
          kind: z.literal("crossfade"),
        }),
      ])
      .optional(),
  }),
  z.strictObject({ kind: z.literal("node.patch"), nodeId: idV2Schema, patch: nodePatchSchema }),
  z.strictObject({
    completion: z.enum(["blocking", "nonBlocking"]),
    conflict: z.literal("reject"),
    kind: z.literal("timeline.play"),
    timelineId: idV2Schema,
  }),
  z.strictObject({ kind: z.literal("timeline.stop"), timelineId: idV2Schema }),
  z.strictObject({
    kind: z.literal("variable.set"),
    value: actionValueV2Schema,
    variableId: idV2Schema,
  }),
  z.strictObject({ kind: z.literal("media.play"), surfaceId: idV2Schema }),
  z.strictObject({ kind: z.literal("media.pause"), surfaceId: idV2Schema }),
  z.strictObject({
    kind: z.literal("media.seek"),
    positionSeconds: numberActionValueSchema,
    surfaceId: idV2Schema,
  }),
  z.strictObject({
    clipId: idV2Schema,
    completion: z.enum(["blocking", "nonBlocking"]),
    conflict: z.literal("reject"),
    kind: z.literal("modelClip.play"),
    loop: z.boolean(),
    nodeId: idV2Schema,
    speed: positiveFiniteNumberV2Schema,
    transition: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("immediate") }),
      z.strictObject({
        durationMilliseconds: positiveSafeUIntV2Schema,
        easing: easingV2Schema,
        kind: z.literal("crossfade"),
      }),
    ]),
  }),
  z.strictObject({ kind: z.literal("modelClip.pause"), nodeId: idV2Schema }),
  z.strictObject({ kind: z.literal("modelClip.resume"), nodeId: idV2Schema }),
  z.strictObject({ kind: z.literal("modelClip.stop"), nodeId: idV2Schema }),
]);

const spatialBase = {
  active: z.boolean(),
  audience: projectionAudienceV2Schema,
  id: idV2Schema,
  name: z.string().min(1).optional(),
  opacity: unitIntervalV2Schema,
  order: uint32V2Schema,
  owner: resourceOwnerV2Schema,
  parent: spatialParentV2Schema,
  transform: transformV2Schema,
  visible: z.boolean(),
};
const spatialNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...spatialBase, kind: z.literal("container") }),
  z.strictObject({ ...spatialBase, assetId: idV2Schema, kind: z.literal("model") }),
  z.strictObject({ ...spatialBase, kind: z.literal("surface"), surfaceId: idV2Schema }),
  z.strictObject({
    ...spatialBase,
    geometry: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("box"), size: positiveVector3V2Schema }),
      z.strictObject({ kind: z.literal("sphere"), radius: positiveFiniteNumberV2Schema }),
    ]),
    kind: z.literal("shape"),
    material: z.strictObject({
      castsShadows: z.literal(false),
      color: srgbaColorV2Schema,
      doubleSided: z.boolean(),
      receivesShadows: z.literal(false),
      shaderModel: z.literal("unlit"),
    }),
  }),
  z.strictObject({
    ...spatialBase,
    kind: z.literal("light"),
    light: z.discriminatedUnion("kind", [
      z.strictObject({
        castsShadows: z.boolean(),
        color: srgbColorV2Schema,
        intensityLux: nonNegativeFiniteNumberV2Schema,
        kind: z.literal("directional"),
      }),
      z.strictObject({
        castsShadows: z.boolean(),
        color: srgbColorV2Schema,
        intensityCandela: nonNegativeFiniteNumberV2Schema,
        kind: z.literal("point"),
        rangeMeters: positiveFiniteNumberV2Schema,
      }),
      z.strictObject({
        castsShadows: z.boolean(),
        color: srgbColorV2Schema,
        innerAngleDegrees: nonNegativeFiniteNumberV2Schema.max(180),
        intensityCandela: nonNegativeFiniteNumberV2Schema,
        kind: z.literal("spot"),
        outerAngleDegrees: positiveFiniteNumberV2Schema.max(180),
        rangeMeters: positiveFiniteNumberV2Schema,
      }),
    ]),
  }),
]);
const renderIntentSchema = z.strictObject({
  fallbackPolicy: z.enum(["reject", "degrade"]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ events: z.array(idV2Schema).min(1), kind: z.literal("regions") }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      durationMilliseconds: positiveSafeUIntV2Schema,
      kind: z.literal("precomputed-video"),
    }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: z.array(idV2Schema).min(1) }),
    z.strictObject({
      kind: z.literal("continuous-native-text"),
      maximumUpdateRateHz: positiveFiniteNumberV2Schema,
    }),
  ]),
});
export const semanticSurfaceV2Schema = z.strictObject({
  baseSemanticTree: semanticTreeDefinitionV2Schema,
  content: surfaceContentV2Schema,
  fit: z.enum(["contain", "cover", "stretch"]),
  hostNodeId: idV2Schema,
  id: idV2Schema,
  initialStateId: idV2Schema,
  interactions: z.record(
    idV2Schema,
    z.strictObject({
      event: idV2Schema,
      hitPriority: uint32V2Schema,
      id: idV2Schema,
      kind: z.literal("click"),
    }),
  ),
  logicalSize: positiveVector2V2Schema,
  physicalSizeMeters: positiveVector2V2Schema,
  renderIntent: renderIntentSchema,
  states: z.record(
    idV2Schema,
    z.strictObject({
      contentOverrides: z.record(idV2Schema, contentOverrideSchema),
      enabledInteractionIds: z.array(idV2Schema),
      id: idV2Schema,
      semanticOverrides: z.array(surfaceSemanticOverrideV2Schema),
    }),
  ),
});
const timelineValueSchema = z.union([finiteNumberV2Schema, vector3V2Schema, quaternionV2Schema]);
const timelineSchema = z.strictObject({
  durationMilliseconds: positiveSafeUIntV2Schema,
  id: idV2Schema,
  owner: resourceOwnerV2Schema,
  tracks: z
    .array(
      z.strictObject({
        keyframes: z
          .array(
            z.strictObject({
              easingToNext: easingV2Schema.optional(),
              timeMilliseconds: safeUIntV2Schema,
              value: timelineValueSchema,
            }),
          )
          .min(2),
        target: z.strictObject({
          nodeId: idV2Schema,
          property: z.enum([
            "opacity",
            "transform.position",
            "transform.rotation",
            "transform.scale",
          ]),
        }),
      }),
    )
    .min(1),
});
const variableSchema = z.strictObject({
  id: idV2Schema,
  initialValue: scalarV2Schema,
  owner: resourceOwnerV2Schema,
  type: scalarTypeV2Schema,
});
const cueSchema = z.strictObject({
  actions: z.array(actionSchema),
  firePolicy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("oncePerStepEntry") }),
    z.strictObject({
      cooldownMilliseconds: safeUIntV2Schema,
      kind: z.literal("repeatable"),
    }),
  ]),
  fixedPayload: z.record(idV2Schema, scalarV2Schema).optional(),
  guard: guardSchema.optional(),
  id: idV2Schema,
  next: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stay") }),
    z.strictObject({ kind: z.literal("step"), stepId: idV2Schema }),
    z.strictObject({ groupId: idV2Schema, kind: z.literal("group") }),
    z.strictObject({ kind: z.literal("end") }),
  ]),
  order: uint32V2Schema,
  priority: safeUIntV2Schema,
  trigger: triggerSchema,
});

export const presentationDefinitionV2Schema = z.strictObject({
  flow: z.strictObject({
    groups: z.record(
      idV2Schema,
      z.strictObject({
        id: idV2Schema,
        initialStepId: idV2Schema,
        steps: z.record(idV2Schema, z.strictObject({ id: idV2Schema, cues: z.array(cueSchema) })),
      }),
    ),
    initialGroupId: idV2Schema,
    timelines: z.record(idV2Schema, timelineSchema),
    variables: z.record(idV2Schema, variableSchema),
  }),
  metadata: z.strictObject({ title: z.string().min(1) }),
  presentationId: idV2Schema,
  scene: z.strictObject({
    nodes: z.record(idV2Schema, spatialNodeSchema),
    surfaces: z.record(idV2Schema, semanticSurfaceV2Schema),
  }),
  schemaVersion: z.literal(2),
  stage: z.strictObject({
    coordinateSystem: z.strictObject({
      forwardAxis: z.literal("-Z"),
      handedness: z.literal("right"),
      unit: z.literal("meter"),
      upAxis: z.literal("+Y"),
    }),
    size: positiveVector3V2Schema,
    zones: z.record(
      idV2Schema,
      z.strictObject({
        center: vector3V2Schema,
        id: idV2Schema,
        owner: resourceOwnerV2Schema,
        size: positiveVector3V2Schema,
      }),
    ),
  }),
});

export type PresentationDefinitionV2 = z.infer<typeof presentationDefinitionV2Schema>;
export type SemanticSurfaceV2 = z.infer<typeof semanticSurfaceV2Schema>;
export type SurfaceContentNodeV2 = z.infer<typeof surfaceContentNodeV2Schema>;
