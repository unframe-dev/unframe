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
  top: nonNegativeFiniteNumberV2Schema,
  right: nonNegativeFiniteNumberV2Schema,
  bottom: nonNegativeFiniteNumberV2Schema,
  left: nonNegativeFiniteNumberV2Schema,
});
const absolutePlacementSchema = z.strictObject({
  kind: z.literal("absolute"),
  x: finiteNumberV2Schema,
  y: finiteNumberV2Schema,
  width: positiveFiniteNumberV2Schema,
  height: positiveFiniteNumberV2Schema,
});
const stackPlacementSchema = z.strictObject({
  kind: z.literal("stack"),
  grow: nonNegativeFiniteNumberV2Schema,
  width: positiveFiniteNumberV2Schema,
  height: positiveFiniteNumberV2Schema,
  alignSelf: z.enum(["auto", "start", "center", "end", "stretch"]),
  margin: edgeInsetsSchema,
});
const gridPlacementSchema = z.strictObject({
  kind: z.literal("grid"),
  column: positiveSafeUIntV2Schema,
  row: positiveSafeUIntV2Schema,
  columnSpan: positiveSafeUIntV2Schema,
  rowSpan: positiveSafeUIntV2Schema,
  width: positiveFiniteNumberV2Schema,
  height: positiveFiniteNumberV2Schema,
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
  gap: nonNegativeFiniteNumberV2Schema,
  padding: edgeInsetsSchema,
  alignItems: z.enum(["start", "center", "end", "stretch"]),
  justifyContent: z.enum(["start", "center", "end", "spaceBetween"]),
});
const gridTrackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), size: positiveFiniteNumberV2Schema }),
  z.strictObject({ kind: z.literal("fraction"), fraction: positiveFiniteNumberV2Schema }),
]);
const gridLayoutSchema = z.strictObject({
  kind: z.literal("grid"),
  columns: z.array(gridTrackSchema).min(1),
  rows: z.array(gridTrackSchema).min(1),
  columnGap: nonNegativeFiniteNumberV2Schema,
  rowGap: nonNegativeFiniteNumberV2Schema,
  padding: edgeInsetsSchema,
});
const frameLayoutSchema = z.discriminatedUnion("kind", [
  absoluteLayoutSchema,
  stackLayoutSchema,
  gridLayoutSchema,
]);
const borderSchema = z.strictObject({
  color: srgbaColorV2Schema,
  width: nonNegativeFiniteNumberV2Schema,
  radius: nonNegativeFiniteNumberV2Schema,
});
const commonContent = {
  id: idV2Schema,
  parentId: idV2Schema.nullable(),
  order: uint32V2Schema,
  semanticNodeId: idV2Schema.optional(),
  visible: z.boolean(),
  opacity: unitIntervalV2Schema,
};
const placedContent = { ...commonContent, placement: placementSchema };
const frameContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("frame"),
  children: z.array(idV2Schema),
  layout: frameLayoutSchema,
  backgroundColor: srgbaColorV2Schema,
  border: borderSchema,
  clip: z.boolean(),
});
const textStyleSchema = z.strictObject({
  fontAssetId: idV2Schema,
  fallbackFontAssetIds: z.array(idV2Schema),
  fontSize: positiveFiniteNumberV2Schema,
  lineHeight: positiveFiniteNumberV2Schema,
  color: srgbaColorV2Schema,
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
      variableId: idV2Schema,
      expectedType: z.literal("string"),
      format: z.strictObject({
        kind: z.literal("string"),
        allowedCodePointRanges: z
          .array(z.tuple([uint32V2Schema.max(1_114_111), uint32V2Schema.max(1_114_111)]))
          .min(1),
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
  ]),
  maxCodePoints: positiveSafeUIntV2Schema,
  style: textStyleSchema,
});
const imageStyleSchema = z.strictObject({
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorV2Schema,
  border: borderSchema,
});
const imageContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("image"),
  assetId: idV2Schema,
  style: imageStyleSchema,
});
const shapeGeometrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rectangle"),
    width: positiveFiniteNumberV2Schema,
    height: positiveFiniteNumberV2Schema,
    radius: nonNegativeFiniteNumberV2Schema,
  }),
  z.strictObject({
    kind: z.literal("ellipse"),
    width: positiveFiniteNumberV2Schema,
    height: positiveFiniteNumberV2Schema,
  }),
  z.strictObject({
    kind: z.literal("line"),
    endX: finiteNumberV2Schema,
    endY: finiteNumberV2Schema,
  }),
]);
const shapeStyleSchema = z.strictObject({
  fill: srgbaColorV2Schema,
  stroke: srgbaColorV2Schema,
  strokeWidth: nonNegativeFiniteNumberV2Schema,
});
const shapeContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("shape"),
  geometry: shapeGeometrySchema,
  style: shapeStyleSchema,
});
const videoStyleSchema = z.strictObject({
  fit: z.enum(["contain", "cover", "stretch"]),
  tint: srgbaColorV2Schema,
  border: borderSchema,
});
const videoContentSchema = z.strictObject({
  ...placedContent,
  kind: z.literal("video"),
  assetId: idV2Schema,
  loop: z.boolean(),
  style: videoStyleSchema,
});
const surfaceContentNodeSchema = z.discriminatedUnion("kind", [
  frameContentSchema,
  textContentSchema,
  imageContentSchema,
  shapeContentSchema,
  videoContentSchema,
]);

const commonOverride = {
  visible: z.boolean().optional(),
  opacity: unitIntervalV2Schema.optional(),
  placement: placementSchema.optional(),
};
const contentOverrideSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonOverride,
    kind: z.literal("frame"),
    layout: frameLayoutSchema.optional(),
    backgroundColor: srgbaColorV2Schema.optional(),
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
    assetId: idV2Schema.optional(),
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
    action: idV2Schema,
    actor: triggerActorSchema,
  }),
  z.strictObject({
    kind: z.literal("semanticEvent"),
    event: idV2Schema,
    actor: triggerActorSchema,
  }),
  z.strictObject({
    kind: z.literal("surfaceInteraction"),
    actor: triggerActorSchema,
    surfaceId: idV2Schema,
    interactionId: idV2Schema,
  }),
  z.strictObject({
    kind: z.literal("zoneEdge"),
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    subject: trackedSubjectSchema,
    zoneId: idV2Schema,
    edge: z.enum(["enter", "exit"]),
    dwellMilliseconds: safeUIntV2Schema.optional(),
    hysteresisMeters: nonNegativeFiniteNumberV2Schema.optional(),
  }),
  z.strictObject({
    kind: z.literal("motion"),
    actor: z.strictObject({ kind: z.literal("system"), source: z.literal("tracking") }),
    subject: trackedSubjectSchema,
    minimumDistanceMeters: positiveFiniteNumberV2Schema,
    windowMilliseconds: positiveSafeUIntV2Schema,
  }),
  z.strictObject({ kind: z.literal("timer"), afterMilliseconds: positiveSafeUIntV2Schema }),
  z.strictObject({ kind: z.literal("timelineCompleted"), timelineId: idV2Schema }),
  z.strictObject({ kind: z.literal("mediaCompleted"), surfaceId: idV2Schema }),
  z.strictObject({ kind: z.literal("modelClipCompleted"), nodeId: idV2Schema, clipId: idV2Schema }),
]);
const valueReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idV2Schema }),
  z.strictObject({ kind: z.literal("surfaceState"), surfaceId: idV2Schema }),
  z.strictObject({
    kind: z.literal("nodeField"),
    nodeId: idV2Schema,
    field: z.enum(["active", "visible", "opacity"]),
  }),
]);
export type GuardV2 =
  | { kind: "all"; guards: GuardV2[] }
  | { kind: "any"; guards: GuardV2[] }
  | { kind: "not"; guard: GuardV2 }
  | {
      kind: "compare";
      left: z.infer<typeof valueReferenceSchema>;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: z.infer<typeof scalarV2Schema>;
    };
const guardSchema: z.ZodType<GuardV2> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("all"), guards: z.array(guardSchema).min(1) }),
    z.strictObject({ kind: z.literal("any"), guards: z.array(guardSchema).min(1) }),
    z.strictObject({ kind: z.literal("not"), guard: guardSchema }),
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
  z.strictObject({ kind: z.literal("eventPayload"), field: idV2Schema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
]);
const numberActionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: finiteNumberV2Schema }),
  z.strictObject({ kind: z.literal("eventPayload"), field: idV2Schema }),
  z.strictObject({ kind: z.literal("variable"), variableId: idV2Schema }),
]);
const nodePatchSchema = z.strictObject({
  active: booleanActionValueSchema.optional(),
  visible: booleanActionValueSchema.optional(),
  opacity: numberActionValueSchema.optional(),
  transform: transformV2Schema.optional(),
});
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("surface.setState"),
    surfaceId: idV2Schema,
    stateId: idV2Schema,
    transition: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("cut") }),
        z.strictObject({
          kind: z.literal("crossfade"),
          durationMilliseconds: positiveSafeUIntV2Schema,
          easing: easingV2Schema,
          completion: z.literal("blocking"),
        }),
      ])
      .optional(),
  }),
  z.strictObject({ kind: z.literal("node.patch"), nodeId: idV2Schema, patch: nodePatchSchema }),
  z.strictObject({
    kind: z.literal("timeline.play"),
    timelineId: idV2Schema,
    completion: z.enum(["blocking", "nonBlocking"]),
    conflict: z.literal("reject"),
  }),
  z.strictObject({ kind: z.literal("timeline.stop"), timelineId: idV2Schema }),
  z.strictObject({
    kind: z.literal("variable.set"),
    variableId: idV2Schema,
    value: actionValueV2Schema,
  }),
  z.strictObject({ kind: z.literal("media.play"), surfaceId: idV2Schema }),
  z.strictObject({ kind: z.literal("media.pause"), surfaceId: idV2Schema }),
  z.strictObject({
    kind: z.literal("media.seek"),
    surfaceId: idV2Schema,
    positionSeconds: numberActionValueSchema,
  }),
  z.strictObject({
    kind: z.literal("modelClip.play"),
    nodeId: idV2Schema,
    clipId: idV2Schema,
    speed: positiveFiniteNumberV2Schema,
    loop: z.boolean(),
    completion: z.enum(["blocking", "nonBlocking"]),
    transition: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("immediate") }),
      z.strictObject({
        kind: z.literal("crossfade"),
        durationMilliseconds: positiveSafeUIntV2Schema,
        easing: easingV2Schema,
      }),
    ]),
    conflict: z.literal("reject"),
  }),
  z.strictObject({ kind: z.literal("modelClip.pause"), nodeId: idV2Schema }),
  z.strictObject({ kind: z.literal("modelClip.resume"), nodeId: idV2Schema }),
  z.strictObject({ kind: z.literal("modelClip.stop"), nodeId: idV2Schema }),
]);

const spatialBase = {
  id: idV2Schema,
  name: z.string().min(1).optional(),
  owner: resourceOwnerV2Schema,
  audience: projectionAudienceV2Schema,
  parent: spatialParentV2Schema,
  order: uint32V2Schema,
  transform: transformV2Schema,
  active: z.boolean(),
  visible: z.boolean(),
  opacity: unitIntervalV2Schema,
};
const spatialNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...spatialBase, kind: z.literal("container") }),
  z.strictObject({ ...spatialBase, kind: z.literal("model"), assetId: idV2Schema }),
  z.strictObject({ ...spatialBase, kind: z.literal("surface"), surfaceId: idV2Schema }),
  z.strictObject({
    ...spatialBase,
    kind: z.literal("shape"),
    geometry: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("box"), size: positiveVector3V2Schema }),
      z.strictObject({ kind: z.literal("sphere"), radius: positiveFiniteNumberV2Schema }),
    ]),
    material: z.strictObject({
      shaderModel: z.literal("unlit"),
      color: srgbaColorV2Schema,
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
        color: srgbColorV2Schema,
        intensityLux: nonNegativeFiniteNumberV2Schema,
        castsShadows: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("point"),
        color: srgbColorV2Schema,
        intensityCandela: nonNegativeFiniteNumberV2Schema,
        rangeMeters: positiveFiniteNumberV2Schema,
        castsShadows: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal("spot"),
        color: srgbColorV2Schema,
        intensityCandela: nonNegativeFiniteNumberV2Schema,
        rangeMeters: positiveFiniteNumberV2Schema,
        outerAngleDegrees: positiveFiniteNumberV2Schema.max(180),
        innerAngleDegrees: nonNegativeFiniteNumberV2Schema.max(180),
        castsShadows: z.boolean(),
      }),
    ]),
  }),
]);
const renderIntentSchema = z.strictObject({
  updateModel: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("static") }),
    z.strictObject({ kind: z.literal("finite-state"), stateIds: z.array(idV2Schema).min(1) }),
    z.strictObject({
      kind: z.literal("continuous-native-text"),
      maximumUpdateRateHz: positiveFiniteNumberV2Schema,
    }),
  ]),
  interaction: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("regions"), events: z.array(idV2Schema).min(1) }),
  ]),
  internalAnimation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("precomputed-video"),
      durationMilliseconds: positiveSafeUIntV2Schema,
    }),
  ]),
  rendererPreference: z.enum(["auto", "baked-web", "native-ui", "video"]),
  fallbackPolicy: z.enum(["reject", "degrade"]),
});
const semanticSurfaceSchema = z.strictObject({
  id: idV2Schema,
  hostNodeId: idV2Schema,
  physicalSizeMeters: positiveVector2V2Schema,
  logicalSize: positiveVector2V2Schema,
  fit: z.enum(["contain", "cover", "stretch"]),
  rootFrameId: idV2Schema,
  contentNodes: z.record(idV2Schema, surfaceContentNodeSchema),
  baseSemanticTree: semanticTreeDefinitionV2Schema,
  interactions: z.record(
    idV2Schema,
    z.strictObject({
      id: idV2Schema,
      kind: z.literal("click"),
      event: idV2Schema,
      hitPriority: uint32V2Schema,
    }),
  ),
  initialStateId: idV2Schema,
  states: z.record(
    idV2Schema,
    z.strictObject({
      id: idV2Schema,
      contentOverrides: z.record(idV2Schema, contentOverrideSchema),
      semanticOverrides: z.array(surfaceSemanticOverrideV2Schema),
      enabledInteractionIds: z.array(idV2Schema),
    }),
  ),
  renderIntent: renderIntentSchema,
});
const timelineValueSchema = z.union([finiteNumberV2Schema, vector3V2Schema, quaternionV2Schema]);
const timelineSchema = z.strictObject({
  id: idV2Schema,
  owner: resourceOwnerV2Schema,
  durationMilliseconds: positiveSafeUIntV2Schema,
  tracks: z
    .array(
      z.strictObject({
        target: z.strictObject({
          nodeId: idV2Schema,
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
              timeMilliseconds: safeUIntV2Schema,
              value: timelineValueSchema,
              easingToNext: easingV2Schema.optional(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});
const variableSchema = z.strictObject({
  id: idV2Schema,
  owner: resourceOwnerV2Schema,
  type: scalarTypeV2Schema,
  initialValue: scalarV2Schema,
});
const cueSchema = z.strictObject({
  id: idV2Schema,
  priority: safeUIntV2Schema,
  order: uint32V2Schema,
  trigger: triggerSchema,
  fixedPayload: z.record(idV2Schema, scalarV2Schema).optional(),
  guard: guardSchema.optional(),
  firePolicy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("oncePerStepEntry") }),
    z.strictObject({
      kind: z.literal("repeatable"),
      cooldownMilliseconds: safeUIntV2Schema,
    }),
  ]),
  actions: z.array(actionSchema),
  next: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stay") }),
    z.strictObject({ kind: z.literal("step"), stepId: idV2Schema }),
    z.strictObject({ kind: z.literal("group"), groupId: idV2Schema }),
    z.strictObject({ kind: z.literal("end") }),
  ]),
});

export const presentationDefinitionV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  presentationId: idV2Schema,
  metadata: z.strictObject({ title: z.string().min(1) }),
  stage: z.strictObject({
    coordinateSystem: z.strictObject({
      unit: z.literal("meter"),
      handedness: z.literal("right"),
      upAxis: z.literal("+Y"),
      forwardAxis: z.literal("-Z"),
    }),
    size: positiveVector3V2Schema,
    zones: z.record(
      idV2Schema,
      z.strictObject({
        id: idV2Schema,
        owner: resourceOwnerV2Schema,
        center: vector3V2Schema,
        size: positiveVector3V2Schema,
      }),
    ),
  }),
  scene: z.strictObject({
    nodes: z.record(idV2Schema, spatialNodeSchema),
    surfaces: z.record(idV2Schema, semanticSurfaceSchema),
  }),
  flow: z.strictObject({
    initialGroupId: idV2Schema,
    groups: z.record(
      idV2Schema,
      z.strictObject({
        id: idV2Schema,
        initialStepId: idV2Schema,
        steps: z.record(idV2Schema, z.strictObject({ id: idV2Schema, cues: z.array(cueSchema) })),
      }),
    ),
    variables: z.record(idV2Schema, variableSchema),
    timelines: z.record(idV2Schema, timelineSchema),
  }),
});

export type PresentationDefinitionV2 = z.infer<typeof presentationDefinitionV2Schema>;
