import type { JsxComponentStructureInput, JsxPresentationInput } from "../domain/jsx-input.js";
import { validateReactSceneItem } from "./react-component.js";
import type {
  ReactPresentationInput,
  ReactSceneBase,
  MixedPresentationInput,
} from "./react-component.js";
import { z } from "zod";
import {
  isDeclaration,
  readOwnDataArray,
  readOwnDataRecord,
  snapshotDeclaration,
} from "../internal/declaration-validation.js";
import {
  assertFlowIds,
  assertId,
  assertOwner,
  assertRecordKeys,
  assertSource,
  assertStableNested,
  assertVector,
  finiteNumberSchema,
  idSchema,
  invalid,
  nonNegativeIntegerSchema,
  positiveSafeIntegerSchema,
} from "../internal/declaration-assertions.js";
import type {
  StableDeclaration,
  StringPropDeclaration,
  NumberPropDeclaration,
  BooleanPropDeclaration,
  PropReference,
  SlotDeclaration,
  PartDeclaration,
  VariantDeclaration,
  StateDeclaration,
  ActionPrecondition,
  ActionEffect,
  ActionDeclaration,
  OutputProducer,
  OutputDeclaration,
  TokenReference,
  NamedStyleReference,
  AssetReference,
  SpatialDeclaration,
  AbsoluteLayoutDeclaration,
  SemanticOverrideDeclaration,
  FrameDeclaration,
  TextDeclaration,
  SlotPlaceholderDeclaration,
  SurfaceDeclaration,
  ContentNodeDeclaration,
  ComponentInstanceDeclaration,
  DetachDeclaration,
  ThemeDeclaration,
  ComponentManifest,
  ComponentStructure,
  ComponentActionInvocation,
  ComponentOutputReference,
  CueDeclaration,
  PresentationDeclaration,
} from "../domain/declarations.js";

type WithoutKind<T extends { kind: string }> = T extends unknown ? Omit<T, "kind"> : never;
type WithoutStableKind<T extends StableDeclaration & { kind: string }> = Omit<T, "kind">;
type Exact<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;

const jsonValueSchema = z.json();
const sourceSchema = z.strictObject({
  file: idSchema,
  range: z
    .tuple([nonNegativeIntegerSchema, nonNegativeIntegerSchema])
    .refine(([start, end]) => start <= end)
    .optional(),
});
const stableShape = { id: idSchema, source: sourceSchema.optional() };
const requiredPropSchema = z.strictObject({ required: z.literal(true) });
const defaultStringPropSchema = z.strictObject({ default: z.string() });
const defaultNumberPropSchema = z.strictObject({ default: finiteNumberSchema });
const defaultBooleanPropSchema = z.strictObject({ default: z.boolean() });
const stringPropSchema = z.union([requiredPropSchema, defaultStringPropSchema]);
const numberPropSchema = z.union([requiredPropSchema, defaultNumberPropSchema]);
const booleanPropSchema = z.union([requiredPropSchema, defaultBooleanPropSchema]);
const propDeclarationSchema = z.union([
  requiredPropSchema.extend({ kind: z.literal("string") }),
  defaultStringPropSchema.extend({ kind: z.literal("string") }),
  requiredPropSchema.extend({ kind: z.literal("number") }),
  defaultNumberPropSchema.extend({ kind: z.literal("number") }),
  requiredPropSchema.extend({ kind: z.literal("boolean") }),
  defaultBooleanPropSchema.extend({ kind: z.literal("boolean") }),
]);
const slotSchema = z.strictObject({});
const slotDeclarationSchema = slotSchema.extend({ kind: z.literal("slot") });
const partSchema = z.strictObject({});
const partDeclarationSchema = partSchema.extend({ kind: z.literal("part") });
const variantShape = { default: idSchema.optional(), values: z.array(idSchema) };
const hasDeclaredVariantDefault = ({
  default: defaultValue,
  values,
}: {
  default?: string | undefined;
  values: Array<string>;
}) => defaultValue === undefined || values.includes(defaultValue);
const variantSchema = z.strictObject(variantShape).refine(hasDeclaredVariantDefault);
const variantDeclarationSchema = z
  .strictObject({
    kind: z.literal("variant"),
    ...variantShape,
  })
  .refine(hasDeclaredVariantDefault);
const stateShape = { initial: z.boolean().optional() };
const stateSchema = z.strictObject(stateShape);
const stateDeclarationSchema = z.strictObject({
  kind: z.literal("state"),
  ...stateShape,
});

const resourceOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ groupId: idSchema, kind: z.literal("group") }),
]);
const stringPropReferenceSchema = z.strictObject({
  expectedType: z.literal("string"),
  kind: z.literal("prop-ref"),
  propId: idSchema,
});
const numberPropReferenceSchema = z.strictObject({
  expectedType: z.literal("number"),
  kind: z.literal("prop-ref"),
  propId: idSchema,
});
const booleanPropReferenceSchema = z.strictObject({
  expectedType: z.literal("boolean"),
  kind: z.literal("prop-ref"),
  propId: idSchema,
});
const stringValueSchema = z.union([z.string(), stringPropReferenceSchema]);
const nonEmptyStringValueSchema = z.union([idSchema, stringPropReferenceSchema]);
const numberValueSchema = z.union([finiteNumberSchema, numberPropReferenceSchema]);
const booleanValueSchema = z.union([z.boolean(), booleanPropReferenceSchema]);
const absoluteLayoutSchema = z.strictObject({
  height: z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
  kind: z.literal("absolute"),
  width: z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
  x: numberValueSchema,
  y: numberValueSchema,
});
const concreteAbsoluteLayoutSchema = z.strictObject({
  height: finiteNumberSchema.positive(),
  kind: z.literal("absolute"),
  width: finiteNumberSchema.positive(),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
});
const namedStyleReferenceSchema = z.strictObject({
  kind: z.literal("named-style-ref"),
  styleId: idSchema,
});
const tokenReferenceSchemaFor = <const C extends string>(category: C) =>
  z.strictObject({
    category: z.literal(category),
    kind: z.literal("token-ref"),
    tokenId: idSchema,
  });
const colorTokenReferenceSchema = tokenReferenceSchemaFor("color");
const logicalLengthTokenReferenceSchema = tokenReferenceSchemaFor("logicalLength");
const spatialLengthTokenReferenceSchema = tokenReferenceSchemaFor("spatialLength");
const fontFaceTokenReferenceSchema = tokenReferenceSchemaFor("fontFace");
const durationTokenReferenceSchema = tokenReferenceSchemaFor("duration");
const easingTokenReferenceSchema = tokenReferenceSchemaFor("easing");
const tokenReferenceSchema = z.discriminatedUnion("category", [
  colorTokenReferenceSchema,
  logicalLengthTokenReferenceSchema,
  spatialLengthTokenReferenceSchema,
  fontFaceTokenReferenceSchema,
  durationTokenReferenceSchema,
  easingTokenReferenceSchema,
]);
const assetReferenceSchema = z.strictObject({ assetId: idSchema, kind: z.literal("asset-ref") });
const unitIntervalSchema = finiteNumberSchema.min(0).max(1);
const concreteSrgbaColorSchema = z.strictObject({
  alpha: unitIntervalSchema,
  blue: unitIntervalSchema,
  green: unitIntervalSchema,
  red: unitIntervalSchema,
});
const srgbaColorSchema = z.strictObject({
  alpha: z.union([unitIntervalSchema, numberPropReferenceSchema]),
  blue: z.union([unitIntervalSchema, numberPropReferenceSchema]),
  green: z.union([unitIntervalSchema, numberPropReferenceSchema]),
  red: z.union([unitIntervalSchema, numberPropReferenceSchema]),
});
const colorValueSchema = z.union([srgbaColorSchema, colorTokenReferenceSchema]);
const concreteColorValueSchema = z.union([concreteSrgbaColorSchema, colorTokenReferenceSchema]);
const positiveLogicalLengthValueSchema = z.union([
  finiteNumberSchema.positive(),
  numberPropReferenceSchema,
  logicalLengthTokenReferenceSchema,
]);
const nonNegativeLogicalLengthValueSchema = z.union([
  finiteNumberSchema.nonnegative(),
  numberPropReferenceSchema,
  logicalLengthTokenReferenceSchema,
]);
const positiveConcreteLogicalLengthValueSchema = z.union([
  finiteNumberSchema.positive(),
  logicalLengthTokenReferenceSchema,
]);
const nonNegativeConcreteLogicalLengthValueSchema = z.union([
  finiteNumberSchema.nonnegative(),
  logicalLengthTokenReferenceSchema,
]);
const fontReferenceSchema = z.union([assetReferenceSchema, fontFaceTokenReferenceSchema]);
const borderSchema = z.strictObject({
  color: colorValueSchema,
  radius: nonNegativeLogicalLengthValueSchema,
  width: nonNegativeLogicalLengthValueSchema,
});
const textStyleSchema = z.strictObject({
  align: z.union([z.enum(["start", "center", "end"]), stringPropReferenceSchema]).optional(),
  color: colorValueSchema.optional(),
  fallbackFonts: z.array(fontReferenceSchema).optional(),
  font: fontReferenceSchema.optional(),
  fontSize: positiveLogicalLengthValueSchema.optional(),
  lineHeight: positiveLogicalLengthValueSchema.optional(),
  overflow: z.union([z.enum(["clip", "ellipsis"]), stringPropReferenceSchema]).optional(),
  weight: z.union([z.enum(["regular", "bold"]), stringPropReferenceSchema]).optional(),
});
const frameStyleSchema = z.strictObject({
  backgroundColor: colorValueSchema.optional(),
  border: borderSchema.optional(),
  clip: booleanValueSchema.optional(),
});
const namedBorderSchema = z.strictObject({
  color: concreteColorValueSchema,
  radius: nonNegativeConcreteLogicalLengthValueSchema,
  width: nonNegativeConcreteLogicalLengthValueSchema,
});
const namedTextStyleSchema = z.strictObject({
  align: z.enum(["start", "center", "end"]).optional(),
  color: concreteColorValueSchema.optional(),
  fallbackFonts: z.array(fontReferenceSchema).optional(),
  font: fontReferenceSchema.optional(),
  fontSize: positiveConcreteLogicalLengthValueSchema.optional(),
  lineHeight: positiveConcreteLogicalLengthValueSchema.optional(),
  overflow: z.enum(["clip", "ellipsis"]).optional(),
  weight: z.enum(["regular", "bold"]).optional(),
});
const namedFrameStyleSchema = z.strictObject({
  backgroundColor: concreteColorValueSchema.optional(),
  border: namedBorderSchema.optional(),
  clip: z.boolean().optional(),
});
const primitiveShape = {
  opacity: z.union([unitIntervalSchema, numberPropReferenceSchema]).optional(),
  semanticNodeId: idSchema.optional(),
  visible: booleanValueSchema.optional(),
};
const semanticOverrideSchema = z.strictObject({
  ...stableShape,
  alt: z.string().nullable().optional(),
  included: z.boolean().optional(),
  kind: z.literal("semantic-override"),
  label: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  targetId: idSchema,
  text: z.string().nullable().optional(),
});
const contentOverrideSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    backgroundColor: colorValueSchema.optional(),
    border: borderSchema.optional(),
    clip: booleanValueSchema.optional(),
    kind: z.literal("frame"),
    layout: z.strictObject({ kind: z.literal("absolute") }).optional(),
    opacity: z.union([unitIntervalSchema, numberPropReferenceSchema]).optional(),
    placement: absoluteLayoutSchema.optional(),
    visible: booleanValueSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    opacity: z.union([unitIntervalSchema, numberPropReferenceSchema]).optional(),
    placement: absoluteLayoutSchema.optional(),
    style: textStyleSchema.optional(),
    value: stringValueSchema.optional(),
    visible: booleanValueSchema.optional(),
  }),
]);
const interactionDeclarationSchema = z.strictObject({
  ...stableShape,
  event: idSchema,
  hitPriority: z.number().int().safe().min(0).max(4_294_967_295),
  kind: z.literal("click"),
});
const semanticNodeBaseShape = {
  ...stableShape,
  order: z.number().int().min(0).max(4_294_967_295),
  parentId: idSchema.nullable(),
};
const semanticLanguageShape = { language: z.string().min(1).optional() };
const semanticTextShape = { text: nonEmptyStringValueSchema, ...semanticLanguageShape };
const semanticNodeSchema = z.discriminatedUnion("role", [
  z.strictObject({
    ...semanticNodeBaseShape,
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    role: z.literal("heading"),
    ...semanticTextShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    role: z.literal("paragraph"),
    ...semanticTextShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    alt: z.string().min(1),
    role: z.literal("image"),
    ...semanticLanguageShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    interactionId: idSchema,
    role: z.literal("button"),
    ...semanticTextShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    ordered: z.boolean(),
    role: z.literal("list"),
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    role: z.literal("listItem"),
    ...semanticTextShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    label: z.string().min(1).optional(),
    role: z.literal("table"),
    ...semanticLanguageShape,
  }),
  z.strictObject({ ...semanticNodeBaseShape, role: z.literal("row") }),
  z.strictObject({ ...semanticNodeBaseShape, role: z.literal("cell"), ...semanticTextShape }),
  z.strictObject({
    ...semanticNodeBaseShape,
    role: z.literal("columnHeader"),
    ...semanticTextShape,
  }),
  z.strictObject({
    ...semanticNodeBaseShape,
    role: z.literal("rowHeader"),
    ...semanticTextShape,
  }),
]);
const surfaceStateSchema = z.strictObject({
  ...stableShape,
  contentOverrides: z.record(idSchema, contentOverrideSchema).optional(),
  enabledInteractionIds: z.array(idSchema),
  semanticOverrides: z.array(semanticOverrideSchema),
});
const baseSemanticTreeSchema = z.strictObject({
  nodes: z.record(idSchema, semanticNodeSchema),
  rootNodeIds: z.array(idSchema),
});
const contentNodeSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      ...stableShape,
      ...primitiveShape,
      children: z.array(contentNodeSchema),
      kind: z.literal("frame"),
      layout: absoluteLayoutSchema,
      namedStyle: namedStyleReferenceSchema.optional(),
      style: frameStyleSchema.optional(),
    }),
    z.strictObject({
      ...stableShape,
      ...primitiveShape,
      kind: z.literal("text"),
      layout: absoluteLayoutSchema,
      maxCodePoints: z.union([positiveSafeIntegerSchema, numberPropReferenceSchema]),
      namedStyle: namedStyleReferenceSchema.optional(),
      style: textStyleSchema.optional(),
      value: stringValueSchema,
    }),
    z.strictObject({
      ...stableShape,
      kind: z.literal("slot-placeholder"),
      semanticParentId: idSchema.optional(),
      slotId: idSchema,
    }),
  ]),
);
const frameDeclarationSchema = z.strictObject({
  ...stableShape,
  ...primitiveShape,
  children: z.array(contentNodeSchema),
  kind: z.literal("frame"),
  layout: absoluteLayoutSchema,
  namedStyle: namedStyleReferenceSchema.optional(),
  style: frameStyleSchema.optional(),
});
const surfaceDeclarationSchema = z.strictObject({
  ...stableShape,
  baseSemanticTree: baseSemanticTreeSchema,
  fit: z.enum(["contain", "cover", "stretch"]),
  initialStateId: idSchema,
  interactions: z.record(idSchema, interactionDeclarationSchema),
  kind: z.literal("surface"),
  logicalSize: z.tuple([
    z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
    z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
  ]),
  physicalSizeMeters: z.tuple([
    z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
    z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
  ]),
  renderIntent: z.strictObject({
    fallbackPolicy: z.literal("reject"),
    interaction: z.enum(["none", "regions"]),
    internalAnimation: z.literal("none"),
    rendererPreference: z.literal("baked-web"),
    updateModel: z.enum(["static", "finite-state"]),
  }),
  root: frameDeclarationSchema,
  states: z.record(idSchema, surfaceStateSchema),
});

const projectionAudienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);
const spatialDeclarationSchema = z.strictObject({
  ...stableShape,
  active: z.boolean(),
  audience: projectionAudienceSchema,
  kind: z.literal("spatial"),
  name: z.string(),
  opacity: finiteNumberSchema.min(0).max(1),
  order: nonNegativeIntegerSchema,
  owner: resourceOwnerSchema,
  parent: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stage") }),
    z.strictObject({ kind: z.literal("node"), nodeId: idSchema }),
  ]),
  transform: z.strictObject({
    position: z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]),
    rotation: z.tuple([
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
    ]),
    scale: z.tuple([
      finiteNumberSchema.positive(),
      finiteNumberSchema.positive(),
      finiteNumberSchema.positive(),
    ]),
  }),
  visible: z.boolean(),
});
const componentInstanceSchema = z.strictObject({
  ...stableShape,
  componentId: idSchema,
  kind: z.literal("component-instance"),
  owner: resourceOwnerSchema,
  partOverrides: z.array(
    z.discriminatedUnion("targetKind", [
      z.strictObject({
        partId: idSchema,
        placement: concreteAbsoluteLayoutSchema.optional(),
        style: namedFrameStyleSchema.optional(),
        targetKind: z.literal("frame"),
      }),
      z.strictObject({
        content: z.string().optional(),
        partId: idSchema,
        placement: concreteAbsoluteLayoutSchema.optional(),
        style: namedTextStyleSchema.optional(),
        targetKind: z.literal("text"),
      }),
    ]),
  ),
  props: z.record(idSchema, z.union([z.string(), finiteNumberSchema, z.boolean()])),
  slots: z.record(idSchema, z.array(idSchema)),
  spatialNodeId: idSchema.optional(),
  variants: z.record(idSchema, idSchema),
  version: finiteNumberSchema,
});
const detachSchema = z.strictObject({
  ...stableShape,
  instanceId: idSchema,
  kind: z.literal("detach"),
  mode: z.literal("structured"),
  provenance: z.strictObject({ componentId: idSchema, version: finiteNumberSchema }),
});

const actionValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("literal"),
    value: z.union([z.null(), z.boolean(), finiteNumberSchema, z.string()]),
  }),
  z.strictObject({ field: idSchema, kind: z.literal("eventPayload") }),
  z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
  z.strictObject({ inputId: idSchema, kind: z.literal("input") }),
]);
const actionPreconditionSchema = z.strictObject({
  kind: z.literal("surfaceState"),
  stateId: idSchema,
  surfaceId: idSchema,
});
const actionEffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("setSurfaceState"),
    stateId: idSchema,
    surfaceId: idSchema,
    transition: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("cut") }),
        z.strictObject({
          completion: z.literal("blocking"),
          durationMilliseconds: z.number().int().positive().safe(),
          easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
          kind: z.literal("crossfade"),
        }),
      ])
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("setVariable"),
    value: actionValueSchema,
    variableId: idSchema,
  }),
  z.strictObject({
    kind: z.literal("patchNode"),
    nodeId: idSchema,
    patch: z.strictObject({
      active: actionValueSchema.optional(),
      opacity: actionValueSchema.optional(),
      visible: actionValueSchema.optional(),
    }),
  }),
  z.strictObject({
    completion: z.enum(["blocking", "nonBlocking"]),
    kind: z.literal("playTimeline"),
    timelineId: idSchema,
  }),
]);
const actionDeclarationSchema = z.strictObject({
  effects: z.array(actionEffectSchema).min(1),
  inputs: z.record(idSchema, z.enum(["null", "boolean", "number", "string"])),
  kind: z.literal("action"),
  preconditions: z.array(actionPreconditionSchema),
});
const outputPayloadFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("null"), value: z.null() }),
  z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ type: z.literal("number"), value: finiteNumberSchema }),
  z.strictObject({ type: z.literal("string"), value: z.string() }),
]);
const outputProducerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ interactionId: idSchema, kind: z.literal("surfaceInteraction") }),
  z.strictObject({ kind: z.literal("timelineCompleted"), timelineId: idSchema }),
  z.strictObject({ kind: z.literal("mediaCompleted"), surfaceId: idSchema }),
  z.strictObject({ afterMilliseconds: finiteNumberSchema.nonnegative(), kind: z.literal("timer") }),
]);
const outputDeclarationSchema = z.strictObject({
  kind: z.literal("output"),
  payload: z.record(idSchema, outputPayloadFieldSchema),
  producer: outputProducerSchema,
});
const manifestMembersShape = {
  actions: z.record(idSchema, actionDeclarationSchema),
  outputs: z.record(idSchema, outputDeclarationSchema),
  parts: z.record(idSchema, partDeclarationSchema),
  props: z.record(idSchema, propDeclarationSchema),
  slots: z.record(idSchema, slotDeclarationSchema),
  states: z.record(idSchema, stateDeclarationSchema),
  variants: z.record(idSchema, variantDeclarationSchema),
};
const opaqueSemanticSurfaceSchema = z.strictObject({
  baseSemanticTree: baseSemanticTreeSchema,
  bindingKey: idSchema,
  id: idSchema,
  initialStateId: idSchema,
  interactions: z.record(idSchema, interactionDeclarationSchema),
  states: z.record(idSchema, surfaceStateSchema),
});
const componentManifestSchema = z.union([
  z.strictObject({
    componentId: idSchema,
    source: sourceSchema.optional(),
    version: positiveSafeIntegerSchema,
    ...manifestMembersShape,
    authoring: z.strictObject({ mode: z.literal("structured"), structure: idSchema }),
    renderers: z.array(idSchema),
  }),
  z.strictObject({
    componentId: idSchema,
    source: sourceSchema.optional(),
    version: positiveSafeIntegerSchema,
    ...manifestMembersShape,
    authoring: z.strictObject({ mode: z.literal("opaque") }),
    renderers: z.record(
      idSchema,
      z.strictObject({ bindingKeys: z.array(idSchema), entry: idSchema }),
    ),
    semantics: z.strictObject({
      surfaces: z.array(opaqueSemanticSurfaceSchema),
      targets: z.array(
        z.strictObject({
          bindingKey: idSchema.optional(),
          id: idSchema,
          kind: z.enum(["node", "timeline", "variable", "media"]),
        }),
      ),
    }),
  }),
]);
const variantStyleOverrideSchema = z.discriminatedUnion("targetKind", [
  z.strictObject({ style: frameStyleSchema, targetId: idSchema, targetKind: z.literal("frame") }),
  z.strictObject({ style: textStyleSchema, targetId: idSchema, targetKind: z.literal("text") }),
]);
const componentStructureShape = {
  ...stableShape,
  componentId: idSchema,
  partBindings: z.record(idSchema, idSchema),
  timelines: z.array(
    z.strictObject({
      ...stableShape,
      durationMilliseconds: positiveSafeIntegerSchema,
      tracks: z
        .array(
          z.strictObject({
            keyframes: z
              .array(
                z.strictObject({
                  easingToNext: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]).optional(),
                  timeMilliseconds: nonNegativeIntegerSchema,
                  value: z.union([
                    finiteNumberSchema,
                    z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]),
                    z.tuple([
                      finiteNumberSchema,
                      finiteNumberSchema,
                      finiteNumberSchema,
                      finiteNumberSchema,
                    ]),
                  ]),
                }),
              )
              .min(2),
            target: z.strictObject({
              kind: z.literal("host"),
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
    }),
  ),
  variantStyles: z.record(idSchema, z.record(idSchema, z.array(variantStyleOverrideSchema))),
};
const componentStructureSchema = z.union([
  z.strictObject({ ...componentStructureShape, root: surfaceDeclarationSchema }),
  z.strictObject({
    ...componentStructureShape,
    baseSemanticTree: baseSemanticTreeSchema,
    root: frameDeclarationSchema,
  }),
]);
const cueTriggerSchema = z.union([
  z.strictObject({ event: idSchema, kind: z.literal("event") }),
  z.strictObject({
    componentInstanceId: idSchema,
    kind: z.literal("component.output"),
    outputId: idSchema,
  }),
]);
const componentActionInvocationSchema = z.strictObject({
  actionId: idSchema,
  arguments: z.record(idSchema, actionValueSchema),
  componentInstanceId: idSchema,
  kind: z.literal("component.action"),
});
const componentOutputReferenceSchema = z.strictObject({
  componentInstanceId: idSchema,
  kind: z.literal("component.output"),
  outputId: idSchema,
});
const cueGuardSchema: z.ZodType<import("../domain/declarations.js").CueGuard> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ guards: z.array(cueGuardSchema).min(1), kind: z.literal("all") }),
    z.strictObject({ guards: z.array(cueGuardSchema).min(1), kind: z.literal("any") }),
    z.strictObject({ guard: cueGuardSchema, kind: z.literal("not") }),
    z.strictObject({
      kind: z.literal("compare"),
      left: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("variable"), variableId: idSchema }),
        z.strictObject({ field: idSchema, kind: z.literal("eventPayload") }),
        z.strictObject({ kind: z.literal("surfaceState"), surfaceId: idSchema }),
        z.strictObject({
          field: z.enum(["active", "visible", "opacity"]),
          kind: z.literal("nodeField"),
          nodeId: idSchema,
        }),
      ]),
      operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
      right: z.union([z.null(), z.boolean(), finiteNumberSchema, z.string()]),
    }),
  ]),
);
const cueSchema = z
  .strictObject({
    ...stableShape,
    actions: z.array(componentActionInvocationSchema),
    firePolicy: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("oncePerStepEntry") }),
        z.strictObject({
          cooldownMilliseconds: nonNegativeIntegerSchema,
          kind: z.literal("repeatable"),
        }),
      ])
      .optional(),
    guard: cueGuardSchema.optional(),
    next: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("stay") }),
        z.strictObject({ kind: z.literal("end") }),
        z.strictObject({ kind: z.literal("step"), stepId: idSchema }),
        z.strictObject({ groupId: idSchema, kind: z.literal("group") }),
      ])
      .optional(),
    order: nonNegativeIntegerSchema.optional(),
    priority: nonNegativeIntegerSchema.optional(),
    toGroupId: idSchema.optional(),
    toStepId: idSchema.optional(),
    trigger: cueTriggerSchema,
  })
  .refine(
    (value) =>
      [value.next, value.toStepId, value.toGroupId].filter((item) => item !== undefined).length <=
      1,
  );
const flowStepSchema = z.strictObject({ ...stableShape, cues: z.array(cueSchema) });
const flowGroupSchema = z.strictObject({
  ...stableShape,
  initialStepId: idSchema,
  steps: z.record(idSchema, flowStepSchema),
});
const variableSchema = z.union([
  z.strictObject({
    ...stableShape,
    initialValue: z.null(),
    owner: resourceOwnerSchema,
    type: z.literal("null"),
  }),
  z.strictObject({
    ...stableShape,
    initialValue: z.boolean(),
    owner: resourceOwnerSchema,
    type: z.literal("boolean"),
  }),
  z.strictObject({
    ...stableShape,
    initialValue: finiteNumberSchema,
    owner: resourceOwnerSchema,
    type: z.literal("number"),
  }),
  z.strictObject({
    ...stableShape,
    initialValue: z.string(),
    owner: resourceOwnerSchema,
    type: z.literal("string"),
  }),
]);
const presentationSchema = z.strictObject({
  ...stableShape,
  assets: z.array(z.strictObject({ assetId: idSchema, kind: z.literal("asset-ref") })),
  flow: z.strictObject({
    groups: z.record(idSchema, flowGroupSchema),
    initialGroupId: idSchema,
    variables: z.record(idSchema, variableSchema),
  }),
  metadata: z.strictObject({ title: z.string().min(1) }),
  operations: z.array(detachSchema),
  scene: z.strictObject({
    components: z.array(componentInstanceSchema),
    spatial: z.array(spatialDeclarationSchema),
  }),
  stage: z.strictObject({
    coordinateSystem: z.strictObject({
      forwardAxis: z.literal("-Z"),
      handedness: z.literal("right"),
      unit: z.literal("meter"),
      upAxis: z.literal("+Y"),
    }),
    size: z.tuple([
      finiteNumberSchema.positive(),
      finiteNumberSchema.positive(),
      finiteNumberSchema.positive(),
    ]),
  }),
  theme: z.strictObject({ themeId: idSchema }).optional(),
});
const themeSchema = z.strictObject({
  ...stableShape,
  namedStyles: z.record(
    idSchema,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("text"), style: namedTextStyleSchema }),
      z.strictObject({ kind: z.literal("frame"), style: namedFrameStyleSchema }),
    ]),
  ),
  tokens: z.record(
    idSchema,
    z.discriminatedUnion("category", [
      z.strictObject({
        category: z.literal("color"),
        value: z.union([concreteSrgbaColorSchema, colorTokenReferenceSchema]),
      }),
      z.strictObject({
        category: z.literal("logicalLength"),
        value: z.union([finiteNumberSchema, logicalLengthTokenReferenceSchema]),
      }),
      z.strictObject({
        category: z.literal("spatialLength"),
        value: z.union([finiteNumberSchema, spatialLengthTokenReferenceSchema]),
      }),
      z.strictObject({
        category: z.literal("fontFace"),
        value: z.union([assetReferenceSchema, fontFaceTokenReferenceSchema]),
      }),
      z.strictObject({
        category: z.literal("duration"),
        value: z.union([finiteNumberSchema, durationTokenReferenceSchema]),
      }),
      z.strictObject({
        category: z.literal("easing"),
        value: z.union([
          z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
          easingTokenReferenceSchema,
        ]),
      }),
    ]),
  ),
});

const assertSchema = (schema: z.ZodType, value: unknown, message: string): void => {
  if (!schema.safeParse(value).success) {
    invalid(message);
  }
};

const staticBuilderResultSchemas = new Map<string, z.ZodType>([
  ["definePresentation", presentationSchema],
  ["defineTheme", themeSchema],
  ["defineComponentManifest", componentManifestSchema],
  ["defineComponentStructure", componentStructureSchema],
  ["stringProp", propDeclarationSchema],
  ["numberProp", propDeclarationSchema],
  ["booleanProp", propDeclarationSchema],
  [
    "propRef",
    z.discriminatedUnion("expectedType", [
      stringPropReferenceSchema,
      numberPropReferenceSchema,
      booleanPropReferenceSchema,
    ]),
  ],
  ["slot", slotDeclarationSchema],
  ["slotPlaceholder", contentNodeSchema],
  ["part", partDeclarationSchema],
  ["variant", variantDeclarationSchema],
  ["state", stateDeclarationSchema],
  ["action", actionDeclarationSchema],
  ["output", outputDeclarationSchema],
  ["surfaceState", actionPreconditionSchema],
  ["setSurfaceState", actionEffectSchema],
  ["playTimeline", actionEffectSchema],
  ["surfaceInteraction", outputProducerSchema],
  ["timelineCompleted", outputProducerSchema],
  ["mediaCompleted", outputProducerSchema],
  ["after", outputProducerSchema],
  ["invokeComponentAction", componentActionInvocationSchema],
  ["componentOutput", componentOutputReferenceSchema],
  ["cue", cueSchema],
  ["tokenRef", tokenReferenceSchema],
  ["namedStyleRef", namedStyleReferenceSchema],
  ["assetRef", assetReferenceSchema],
  ["spatial", spatialDeclarationSchema],
  ["frame", frameDeclarationSchema],
  ["text", contentNodeSchema],
  ["surface", surfaceDeclarationSchema],
  ["semanticOverride", semanticOverrideSchema],
  ["componentInstance", componentInstanceSchema],
  ["detach", detachSchema],
]);

export const validateStaticBuilderResult = (builder: string, value: unknown): boolean => {
  const schema = staticBuilderResultSchemas.get(builder);
  if (!schema) {
    return false;
  }
  try {
    const snapshot = snapshotDeclaration(value);
    if (!schema.safeParse(snapshot).success) {
      return false;
    }
    if (builder === "definePresentation") {
      assertPresentationDeclaration(snapshot);
    } else if (builder === "defineTheme") {
      assertThemeDeclaration(snapshot);
    } else if (builder === "defineComponentManifest") {
      assertComponentManifest(snapshot);
    } else if (builder === "defineComponentStructure") {
      assertComponentStructure(snapshot);
    } else if (builder === "surface") {
      assertSurfaceIds(snapshot as SurfaceDeclaration);
    } else if (builder === "spatial") {
      assertSpatialFields(snapshot as SpatialDeclaration);
    } else if (builder === "componentInstance") {
      assertComponentInstanceIds(snapshot as ComponentInstanceDeclaration);
    } else if (
      ["frame", "text", "slotPlaceholder", "semanticOverride", "detach", "cue"].includes(builder)
    ) {
      assertStableNested(snapshot as StableDeclaration, "id");
    }
    return true;
  } catch {
    return false;
  }
};

const assertJsonSafe = <T>(value: T): T => {
  const snapshot = snapshotDeclaration(value);
  if (!jsonValueSchema.safeParse(snapshot).success) {
    invalid("Declarations must contain finite JSON numbers.");
  }
  return snapshot as T;
};

const defineStable = <const T extends StableDeclaration>(value: T): T => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.id);
  assertSource(declaration.source);
  return value;
};
const build = <const T>(value: T): T => {
  assertJsonSafe(value);
  return value;
};

const assertLayout = (layout: AbsoluteLayoutDeclaration): void => {
  const result = absoluteLayoutSchema.safeParse(layout);
  if (!result.success) {
    const dimensions = result.error.issues.some(
      ({ path }) => path[0] === "width" || path[0] === "height",
    );
    invalid(
      dimensions
        ? "layout size must contain positive finite numbers."
        : "layout position must contain finite numbers.",
    );
  }
};
const assertSpatialFields = (value: SpatialDeclaration): void => {
  assertStableNested(value, "spatial node id");
  assertOwner(value.owner);
  if (value.parent.kind === "node") {
    assertId(value.parent.nodeId, "spatial parent nodeId");
  }
  assertVector(value.transform.position, 3, "transform.position");
  assertVector(value.transform.rotation, 4, "transform.rotation");
  assertVector(value.transform.scale, 3, "transform.scale", true);
  if (!nonNegativeIntegerSchema.safeParse(value.order).success) {
    invalid("Spatial order must be a non-negative integer.");
  }
  if (!finiteNumberSchema.min(0).max(1).safeParse(value.opacity).success) {
    invalid("Spatial opacity must be between 0 and 1.");
  }
};
const assertComponentInstanceIds = (value: ComponentInstanceDeclaration): void => {
  assertStableNested(value, "component instance id");
  assertId(value.componentId, "componentId");
  if (value.spatialNodeId !== undefined) {
    assertId(value.spatialNodeId, "spatialNodeId");
  }
  assertOwner(value.owner);
  assertRecordKeys(value.slots, "slot binding id");
  for (const targetIds of Object.values(value.slots)) {
    for (const targetId of targetIds) {
      assertId(targetId, "slot binding targetId");
    }
  }
  assertRecordKeys(value.variants, "variant id");
  for (const variantValue of Object.values(value.variants)) {
    assertId(variantValue, "variant value");
  }
  for (const partOverride of value.partOverrides) {
    assertId(partOverride.partId, "part override id");
  }
  assertRecordKeys(value.props, "prop binding id");
};
const assertContentIds = (node: ContentNodeDeclaration): void => {
  assertStableNested(node, "content node id");
  if (node.kind === "slot-placeholder") {
    assertId(node.slotId, "slotId");
    if (node.semanticParentId !== undefined) {
      assertId(node.semanticParentId, "semanticParentId");
    }
    return;
  }
  assertLayout(node.layout);
  if (node.kind === "frame") {
    for (const child of node.children) {
      assertContentIds(child);
    }
  }
};
const assertSurfaceIds = (
  value: Pick<
    SurfaceDeclaration,
    | "id"
    | "source"
    | "physicalSizeMeters"
    | "logicalSize"
    | "root"
    | "baseSemanticTree"
    | "initialStateId"
    | "states"
    | "interactions"
  >,
): void => {
  assertStableNested(value, "surface id");
  assertContentIds(value.root);
  assertSchema(
    z.tuple([
      z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
      z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
    ]),
    value.physicalSizeMeters,
    "physicalSizeMeters must contain positive finite numbers or number Prop references.",
  );
  assertSchema(
    z.tuple([
      z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
      z.union([finiteNumberSchema.positive(), numberPropReferenceSchema]),
    ]),
    value.logicalSize,
    "logicalSize must contain positive finite numbers or number Prop references.",
  );
  assertSurfaceSemanticIds(value);
};
const assertSurfaceSemanticIds = (
  value: Pick<
    SurfaceDeclaration,
    "baseSemanticTree" | "initialStateId" | "states" | "interactions"
  >,
): void => {
  assertRecordKeys(value.interactions, "interaction record key");
  for (const interaction of Object.values(value.interactions)) {
    assertStableNested(interaction, "interaction id");
    assertId(interaction.event, "interaction event");
  }
  assertId(value.initialStateId, "initialStateId");
  for (const rootNodeId of value.baseSemanticTree.rootNodeIds) {
    assertId(rootNodeId, "semantic root id");
  }
  assertRecordKeys(value.baseSemanticTree.nodes, "semantic node record key");
  for (const node of Object.values(value.baseSemanticTree.nodes)) {
    assertStableNested(node, "semantic node id");
    if (node.parentId !== null) {
      assertId(node.parentId, "semantic parentId");
    }
    if ("interactionId" in node) {
      assertId(node.interactionId, "semantic interactionId");
    }
  }
  assertRecordKeys(value.states, "surface state record key");
  for (const stateValue of Object.values(value.states)) {
    assertStableNested(stateValue, "surface state id");
    if (stateValue.contentOverrides) {
      assertRecordKeys(stateValue.contentOverrides, "content override id");
    }
    for (const interactionId of stateValue.enabledInteractionIds) {
      assertId(interactionId, "enabledInteractionId");
    }
    for (const stateOverride of stateValue.semanticOverrides) {
      assertStableNested(stateOverride, "semantic override id");
      assertId(stateOverride.targetId, "semantic override targetId");
    }
  }
};
const assertPresentationDeclaration = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as PresentationDeclaration;
  assertVector(declaration.stage.size, 3, "stage.size", true);
  assertFlowIds(declaration.flow);
  for (const node of declaration.scene.spatial) {
    assertSpatialFields(node);
  }
  for (const instance of declaration.scene.components) {
    assertComponentInstanceIds(instance);
  }
  for (const reference of declaration.assets) {
    assertId(reference.assetId, "assetId");
  }
  if (declaration.theme !== undefined) {
    assertId(declaration.theme.themeId, "themeId");
  }
  for (const operation of declaration.operations) {
    assertStableNested(operation, "operation id");
    assertId(operation.instanceId, "operation instanceId");
    assertId(operation.provenance.componentId, "operation provenance componentId");
  }
  assertStableNested(declaration, "id");
  assertSchema(presentationSchema, declaration, "Invalid Presentation declaration.");
};
const assertThemeDeclaration = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ThemeDeclaration;
  assertRecordKeys(declaration.tokens, "theme token id");
  assertRecordKeys(declaration.namedStyles, "named style id");
  assertStableNested(declaration, "id");
  assertSchema(themeSchema, declaration, "Invalid Theme declaration.");
};
const assertComponentManifest = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ComponentManifest;
  assertId(declaration.componentId, "componentId");
  assertSource(declaration.source);
  if (!positiveSafeIntegerSchema.safeParse(declaration.version).success) {
    invalid("Component version must be a positive integer.");
  }
  for (const [label, members] of Object.entries({
    action: declaration.actions,
    output: declaration.outputs,
    part: declaration.parts,
    prop: declaration.props,
    slot: declaration.slots,
    state: declaration.states,
    variant: declaration.variants,
  })) {
    assertRecordKeys(members, `${label} id`);
  }
  for (const actionValue of Object.values(declaration.actions)) {
    assertRecordKeys(actionValue.inputs, "action input id");
    if (!z.array(z.unknown()).min(1).safeParse(actionValue.effects).success) {
      invalid("Component actions must declare at least one effect.");
    }
    for (const precondition of actionValue.preconditions) {
      assertId(precondition.surfaceId, "action precondition surfaceId");
      assertId(precondition.stateId, "action precondition stateId");
    }
    for (const effect of actionValue.effects) {
      if (effect.kind === "setSurfaceState") {
        assertId(effect.surfaceId, "action effect surfaceId");
        assertId(effect.stateId, "action effect stateId");
      } else if (effect.kind === "setVariable") {
        assertId(effect.variableId, "action effect variableId");
      } else if (effect.kind === "patchNode") {
        assertId(effect.nodeId, "action effect nodeId");
      } else {
        assertId(effect.timelineId, "action effect timelineId");
      }
    }
  }
  for (const variantValue of Object.values(declaration.variants)) {
    for (const option of variantValue.values) {
      assertId(option, "variant value");
    }
    if (variantValue.default !== undefined) {
      assertId(variantValue.default, "variant default");
    }
  }
  for (const outputValue of Object.values(declaration.outputs)) {
    assertRecordKeys(outputValue.payload, "output payload id");
    if (outputValue.producer.kind === "surfaceInteraction") {
      assertId(outputValue.producer.interactionId, "output producer interactionId");
    } else if (outputValue.producer.kind === "timelineCompleted") {
      assertId(outputValue.producer.timelineId, "output producer timelineId");
    } else if (outputValue.producer.kind === "mediaCompleted") {
      assertId(outputValue.producer.surfaceId, "output producer surfaceId");
    } else if (
      !finiteNumberSchema.nonnegative().safeParse(outputValue.producer.afterMilliseconds).success
    ) {
      invalid("output producer afterMilliseconds must be a non-negative finite number.");
    }
  }
  if (!("semantics" in declaration)) {
    for (const rendererId of declaration.renderers) {
      assertId(rendererId, "renderer id");
    }
  } else {
    assertRecordKeys(declaration.renderers, "renderer id");
    for (const renderer of Object.values(declaration.renderers)) {
      assertId(renderer.entry, "renderer entry");
      for (const bindingKey of renderer.bindingKeys) {
        assertId(bindingKey, "renderer bindingKey");
      }
    }
    for (const target of declaration.semantics.targets) {
      assertId(target.id, "opaque semantic target id");
      if (target.bindingKey !== undefined) {
        assertId(target.bindingKey, "opaque bindingKey");
      }
    }
    for (const semanticSurface of declaration.semantics.surfaces) {
      assertId(semanticSurface.id, "opaque surface id");
      assertId(semanticSurface.bindingKey, "opaque surface bindingKey");
      assertSurfaceSemanticIds(semanticSurface);
    }
  }
  assertSchema(componentManifestSchema, declaration, "Invalid Component Manifest declaration.");
};
const assertComponentStructure = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ComponentStructure;
  assertId(declaration.componentId, "componentId");
  assertRecordKeys(declaration.partBindings, "part binding id");
  for (const targetId of Object.values(declaration.partBindings)) {
    assertId(targetId, "part binding targetId");
  }
  for (const timeline of declaration.timelines) {
    assertStableNested(timeline, "timeline id");
  }
  if (declaration.root.kind === "surface") {
    assertSurfaceIds(declaration.root);
  } else {
    assertContentIds(declaration.root);
  }
  assertStableNested(declaration, "id");
  assertSchema(componentStructureSchema, declaration, "Invalid Component Structure declaration.");
};

export const isPresentationDeclaration = (value: unknown): value is PresentationDeclaration =>
  isDeclaration(value, assertPresentationDeclaration);
export const isThemeDeclaration = (value: unknown): value is ThemeDeclaration =>
  isDeclaration(value, assertThemeDeclaration);
export const isComponentManifest = (value: unknown): value is ComponentManifest =>
  isDeclaration(value, assertComponentManifest);
export const isComponentStructure = (value: unknown): value is ComponentStructure =>
  isDeclaration(value, assertComponentStructure);

export function definePresentation<const T extends PresentationDeclaration>(value: T): T;
export function definePresentation(value: JsxPresentationInput): PresentationDeclaration;
export function definePresentation<
  const S extends ReadonlyArray<
    PresentationDeclaration["scene"]["components"][number] | ReactSceneBase
  >,
>(value: MixedPresentationInput<S>): MixedPresentationInput<S>;
export function definePresentation<const S extends ReadonlyArray<ReactSceneBase>>(
  value: ReactPresentationInput<S>,
): ReactPresentationInput<S>;
export function definePresentation(
  value:
    | PresentationDeclaration
    | JsxPresentationInput
    | ReactPresentationInput<ReadonlyArray<ReactSceneBase>>
    | MixedPresentationInput<
        ReadonlyArray<PresentationDeclaration["scene"]["components"][number] | ReactSceneBase>
      >,
):
  | PresentationDeclaration
  | ReactPresentationInput<ReadonlyArray<ReactSceneBase>>
  | MixedPresentationInput<
      ReadonlyArray<PresentationDeclaration["scene"]["components"][number] | ReactSceneBase>
    > {
  const fields = readOwnDataRecord(value);
  if (Array.isArray(fields.scene)) {
    const scene = readOwnDataArray(fields.scene);
    delete fields.scene;
    const header = assertJsonSafe(fields) as unknown as Omit<PresentationDeclaration, "scene">;
    assertSchema(
      presentationSchema.omit({ scene: true }),
      header,
      "Invalid React Presentation header.",
    );
    assertFlowIds(header.flow);
    const instanceIds = new Set<string>();
    for (const item of scene) {
      const instanceId = validateReactSceneItem(item);
      if (instanceIds.has(instanceId)) {
        invalid("Duplicate React Component instance ID.");
      }
      instanceIds.add(instanceId);
    }
    return value as ReactPresentationInput<ReadonlyArray<ReactSceneBase>>;
  }
  const sceneFields = readOwnDataRecord(fields.scene);
  const components = readOwnDataArray(sceneFields.components);
  const reactComponents = components.filter((item) => {
    const record = readOwnDataRecord(item);
    return Object.hasOwn(record, "component");
  });
  if (reactComponents.length) {
    const structured = components.filter((item) => !reactComponents.includes(item));
    assertPresentationDeclaration({ ...fields, scene: { ...sceneFields, components: structured } });
    const ids = new Set(structured.map((item) => readOwnDataRecord(item).id));
    for (const item of reactComponents) {
      const instanceId = validateReactSceneItem(item);
      if (ids.has(instanceId)) {
        invalid("Duplicate Component instance ID.");
      }
      ids.add(instanceId);
    }
    return value as MixedPresentationInput<
      ReadonlyArray<PresentationDeclaration["scene"]["components"][number] | ReactSceneBase>
    >;
  }
  assertPresentationDeclaration(value);
  return value as PresentationDeclaration;
}
export const defineTheme = <const T extends ThemeDeclaration>(value: T): T => {
  assertThemeDeclaration(value);
  return value;
};
export const defineComponentManifest = <const T extends ComponentManifest>(value: T): T => {
  assertComponentManifest(value);
  return value;
};
export function defineComponentStructure<const T extends ComponentStructure>(value: T): T;
export function defineComponentStructure(value: JsxComponentStructureInput): ComponentStructure;
export function defineComponentStructure(
  value: ComponentStructure | JsxComponentStructureInput,
): ComponentStructure {
  assertComponentStructure(value);
  return value as ComponentStructure;
}

export const stringProp = <const T extends WithoutKind<StringPropDeclaration>>(
  value: Exact<T, WithoutKind<StringPropDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertSchema(stringPropSchema, declaration, "Invalid string prop declaration.");
  return build({ ...declaration, kind: "string" as const });
};
export const numberProp = <const T extends WithoutKind<NumberPropDeclaration>>(
  value: Exact<T, WithoutKind<NumberPropDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertSchema(numberPropSchema, declaration, "Invalid number prop declaration.");
  return build({ ...declaration, kind: "number" as const });
};
export const booleanProp = <const T extends WithoutKind<BooleanPropDeclaration>>(
  value: Exact<T, WithoutKind<BooleanPropDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertSchema(booleanPropSchema, declaration, "Invalid boolean prop declaration.");
  return build({ ...declaration, kind: "boolean" as const });
};
export const slot = <const T extends WithoutKind<SlotDeclaration>>(
  value: Exact<T, WithoutKind<SlotDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertSchema(slotSchema, declaration, "Invalid slot declaration.");
  return build({ ...declaration, kind: "slot" as const });
};
export const part = <const T extends WithoutKind<PartDeclaration>>(
  value: Exact<T, WithoutKind<PartDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertSchema(partSchema, declaration, "Invalid part declaration.");
  return build({ ...declaration, kind: "part" as const });
};
export const variant = <const T extends WithoutKind<VariantDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertSchema(variantSchema, declaration, "Invalid variant declaration.");
  return build({ ...declaration, kind: "variant" as const });
};
export function state(): StateDeclaration;
export function state<const T extends WithoutKind<StateDeclaration>>(
  value: T,
): T & { kind: "state" };
export function state(value: WithoutKind<StateDeclaration> = {}): StateDeclaration {
  const declaration = assertJsonSafe(value);
  assertSchema(stateSchema, declaration, "Invalid state declaration.");
  return build({ ...declaration, kind: "state" });
}
export const action = <const T extends WithoutKind<ActionDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  if (!z.array(z.unknown()).min(1).safeParse(declaration.effects).success) {
    invalid("Component actions must declare at least one effect.");
  }
  const result = { ...declaration, kind: "action" as const };
  assertSchema(actionDeclarationSchema, result, "Invalid action declaration.");
  return build(result);
};
export const output = <const T extends WithoutKind<OutputDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  const result = { ...declaration, kind: "output" as const };
  assertSchema(outputDeclarationSchema, result, "Invalid output declaration.");
  return build(result);
};

export const surfaceState = (surfaceId: string, stateId: string): ActionPrecondition => {
  assertId(surfaceId, "surfaceId");
  assertId(stateId, "stateId");
  return { kind: "surfaceState", stateId, surfaceId };
};
export const setSurfaceState = (
  surfaceId: string,
  stateId: string,
  transition?: Extract<ActionEffect, { kind: "setSurfaceState" }>["transition"],
): ActionEffect => {
  assertId(surfaceId, "surfaceId");
  assertId(stateId, "stateId");
  const effect: Extract<ActionEffect, { kind: "setSurfaceState" }> = {
    kind: "setSurfaceState",
    stateId,
    surfaceId,
    ...(transition ? { transition } : {}),
  };
  assertSchema(actionEffectSchema, effect, "Invalid Surface State effect.");
  return effect;
};
export const playTimeline = (
  timelineId: string,
  options: { completion: "blocking" | "nonBlocking" },
): ActionEffect => {
  assertId(timelineId, "timelineId");
  const declaration = assertJsonSafe(options);
  if (
    !z.strictObject({ completion: z.enum(["blocking", "nonBlocking"]) }).safeParse(declaration)
      .success
  ) {
    invalid("completion must be blocking or nonBlocking.");
  }
  return build({ kind: "playTimeline", timelineId, ...declaration });
};
export const surfaceInteraction = (interactionId: string): OutputProducer => {
  assertId(interactionId, "interactionId");
  return { interactionId, kind: "surfaceInteraction" };
};
export const timelineCompleted = (timelineId: string): OutputProducer => {
  assertId(timelineId, "timelineId");
  return { kind: "timelineCompleted", timelineId };
};
export const mediaCompleted = (surfaceId: string): OutputProducer => {
  assertId(surfaceId, "surfaceId");
  return { kind: "mediaCompleted", surfaceId };
};
export const after = (afterMilliseconds: number): OutputProducer => {
  if (!finiteNumberSchema.nonnegative().safeParse(afterMilliseconds).success) {
    invalid("afterMilliseconds must be a non-negative finite number.");
  }
  return { afterMilliseconds, kind: "timer" };
};
export const invokeComponentAction = <const T extends Omit<ComponentActionInvocation, "kind">>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.componentInstanceId, "componentInstanceId");
  assertId(declaration.actionId, "actionId");
  const result = { ...declaration, kind: "component.action" as const };
  assertSchema(componentActionInvocationSchema, result, "Invalid Component Action invocation.");
  return build(result);
};
export const componentOutput = <const T extends Omit<ComponentOutputReference, "kind">>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.componentInstanceId, "componentInstanceId");
  assertId(declaration.outputId, "outputId");
  const result = { ...declaration, kind: "component.output" as const };
  assertSchema(componentOutputReferenceSchema, result, "Invalid Component Output reference.");
  return build(result);
};
export const cue = <const T extends CueDeclaration>(value: T): T => {
  const declaration = assertJsonSafe(value);
  assertSchema(cueSchema, declaration, "Invalid cue declaration.");
  return defineStable(value);
};

export const tokenRef = <const T extends WithoutKind<TokenReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.tokenId, "tokenId");
  const result = { ...declaration, kind: "token-ref" as const };
  assertSchema(tokenReferenceSchema, result, "Invalid Token reference.");
  return build(result);
};
export const propRef = <
  const T extends WithoutKind<PropReference<"string" | "number" | "boolean">>,
>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.propId, "propId");
  const result = { ...declaration, kind: "prop-ref" as const };
  assertSchema(
    z.discriminatedUnion("expectedType", [
      stringPropReferenceSchema,
      numberPropReferenceSchema,
      booleanPropReferenceSchema,
    ]),
    result,
    "Invalid Prop reference.",
  );
  return build(result);
};
export const namedStyleRef = <const T extends WithoutKind<NamedStyleReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.styleId, "styleId");
  const result = { ...declaration, kind: "named-style-ref" as const };
  assertSchema(namedStyleReferenceSchema, result, "Invalid Named Style reference.");
  return build(result);
};
export const assetRef = <const T extends WithoutKind<AssetReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.assetId, "assetId");
  const result = { ...declaration, kind: "asset-ref" as const };
  assertSchema(assetReferenceSchema, result, "Invalid Asset reference.");
  return build(result);
};

export const spatial = <const T extends WithoutStableKind<SpatialDeclaration>>(value: T) => {
  const snapshot = assertJsonSafe(value);
  const declaration = { ...snapshot, kind: "spatial" as const };
  assertSpatialFields(declaration);
  assertSchema(spatialDeclarationSchema, declaration, "Invalid spatial declaration.");
  return defineStable(declaration);
};
export const frame = <const T extends WithoutStableKind<FrameDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertLayout(declaration.layout);
  const result = { ...declaration, kind: "frame" as const };
  assertSchema(frameDeclarationSchema, result, "Invalid frame declaration.");
  return defineStable(result);
};
export const text = <const T extends WithoutStableKind<TextDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertLayout(declaration.layout);
  const result = { ...declaration, kind: "text" as const };
  assertSchema(contentNodeSchema, result, "Invalid text declaration.");
  return defineStable(result);
};
export const slotPlaceholder = <const T extends WithoutStableKind<SlotPlaceholderDeclaration>>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.slotId, "slotId");
  if (declaration.semanticParentId !== undefined) {
    assertId(declaration.semanticParentId, "semanticParentId");
  }
  const result = { ...declaration, kind: "slot-placeholder" as const };
  assertSchema(contentNodeSchema, result, "Invalid Slot placeholder declaration.");
  return defineStable(result);
};
export const surface = <const T extends WithoutStableKind<SurfaceDeclaration>>(value: T) => {
  const snapshot = assertJsonSafe(value);
  const declaration = { ...snapshot, kind: "surface" as const };
  assertSurfaceIds(declaration);
  assertSchema(surfaceDeclarationSchema, declaration, "Invalid Surface declaration.");
  return defineStable(declaration);
};
export const semanticOverride = <const T extends WithoutStableKind<SemanticOverrideDeclaration>>(
  value: Exact<T, WithoutStableKind<SemanticOverrideDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.targetId, "targetId");
  const result = { ...declaration, kind: "semantic-override" as const };
  assertSchema(semanticOverrideSchema, result, "Invalid semantic override declaration.");
  return defineStable(result);
};
export const componentInstance = <const T extends WithoutStableKind<ComponentInstanceDeclaration>>(
  value: T,
) => {
  const snapshot = assertJsonSafe(value);
  assertId(snapshot.componentId, "componentId");
  if (snapshot.spatialNodeId !== undefined) {
    assertId(snapshot.spatialNodeId, "spatialNodeId");
  }
  const declaration = { ...snapshot, kind: "component-instance" as const };
  assertComponentInstanceIds(declaration);
  assertSchema(componentInstanceSchema, declaration, "Invalid Component Instance declaration.");
  return defineStable(declaration);
};
export const detach = <const T extends WithoutStableKind<DetachDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.instanceId, "instanceId");
  assertId(declaration.provenance.componentId, "provenance.componentId");
  const result = { ...declaration, kind: "detach" as const };
  assertSchema(detachSchema, result, "Invalid detach declaration.");
  return defineStable(result);
};
