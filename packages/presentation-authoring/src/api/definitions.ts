import { z } from "zod";
import { isDeclaration, snapshotDeclaration } from "../internal/declaration-validation.js";
import type {
  SourceMetadata,
  StableDeclaration,
  ResourceOwner,
  StringPropDeclaration,
  NumberPropDeclaration,
  BooleanPropDeclaration,
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
  FlowDeclaration,
  PresentationDeclaration,
} from "../domain/declarations.js";

type WithoutKind<T extends { kind: string }> = Omit<T, "kind">;
type WithoutStableKind<T extends StableDeclaration & { kind: string }> = Omit<T, "kind">;
type Exact<T, Shape> = T & Record<Exclude<keyof T, keyof Shape>, never>;

const invalid = (message: string): never => {
  throw new TypeError(message);
};

const idSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveSafeIntegerSchema = z.number().int().safe().positive();
const jsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    finiteNumberSchema,
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const stringPropSchema = z.object({
  required: z.boolean().optional(),
  default: z.string().optional(),
});
const numberPropSchema = z.object({
  required: z.boolean().optional(),
  default: finiteNumberSchema.optional(),
});
const booleanPropSchema = z.object({
  required: z.boolean().optional(),
  default: z.boolean().optional(),
});
const slotSchema = z.object({
  accepts: z.array(idSchema),
  cardinality: z.enum(["one", "many"]),
  required: z.boolean().optional(),
});
const partSchema = z.object({ overridable: z.array(z.enum(["content", "placement", "style"])) });
const variantSchema = z.object({ values: z.array(idSchema), default: idSchema.optional() });
const stateSchema = z.object({ initial: z.boolean().optional() });

const assertSchema = (schema: z.ZodType, value: unknown, message: string): void => {
  if (!schema.safeParse(value).success) invalid(message);
};

const assertId: (value: unknown, label?: string) => asserts value is string = (
  value,
  label = "id",
) => {
  if (!idSchema.safeParse(value).success) invalid(`${label} must be a non-empty id.`);
};
const assertFinite = (values: readonly number[], label: string, positive = false): void => {
  const schema = z.array(positive ? finiteNumberSchema.positive() : finiteNumberSchema);
  if (!schema.safeParse(values).success)
    invalid(`${label} must contain ${positive ? "positive " : ""}finite numbers.`);
};
const assertVector = (
  values: readonly number[],
  length: number,
  label: string,
  positive = false,
): void => {
  if (!z.array(finiteNumberSchema).length(length).safeParse(values).success)
    invalid(`${label} must contain exactly ${length} numbers.`);
  assertFinite(values, label, positive);
};
const assertSource = (source: SourceMetadata | undefined): void => {
  if (source === undefined) return;
  assertId(source.file, "source.file");
  const rangeSchema = z
    .tuple([nonNegativeIntegerSchema, nonNegativeIntegerSchema])
    .refine(([start, end]) => start <= end);
  if (source.range !== undefined && !rangeSchema.safeParse(source.range).success)
    invalid("source.range must be ordered non-negative integer offsets.");
};

const assertJsonSafe = <T>(value: T): T => {
  const snapshot = snapshotDeclaration(value);
  if (!jsonValueSchema.safeParse(snapshot).success)
    invalid("Declarations must contain finite JSON numbers.");
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

const assertStableNested = (value: StableDeclaration, label: string): void => {
  assertId(value.id, label);
  assertSource(value.source);
};
const assertRecordKeys = (value: Readonly<Record<string, unknown>>, label: string): void => {
  if (!z.record(idSchema, z.unknown()).safeParse(value).success)
    invalid(`${label} must be a non-empty id.`);
};
const assertOwner = (owner: ResourceOwner): void => {
  const result = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("presentation") }),
      z.object({ kind: z.literal("group"), groupId: idSchema }),
    ])
    .safeParse(owner);
  if (!result.success) invalid("owner.groupId must be a non-empty id.");
};
const assertLayout = (layout: AbsoluteLayoutDeclaration): void => {
  const result = z
    .object({
      kind: z.literal("absolute"),
      x: finiteNumberSchema,
      y: finiteNumberSchema,
      width: finiteNumberSchema.positive(),
      height: finiteNumberSchema.positive(),
    })
    .safeParse(layout);
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
  if (value.parent.kind === "node") assertId(value.parent.nodeId, "spatial parent nodeId");
  assertVector(value.transform.position, 3, "transform.position");
  assertVector(value.transform.rotation, 4, "transform.rotation");
  assertVector(value.transform.scale, 3, "transform.scale", true);
  if (!nonNegativeIntegerSchema.safeParse(value.order).success)
    invalid("Spatial order must be a non-negative integer.");
  if (!finiteNumberSchema.min(0).max(1).safeParse(value.opacity).success)
    invalid("Spatial opacity must be between 0 and 1.");
};
const assertComponentInstanceIds = (value: ComponentInstanceDeclaration): void => {
  assertStableNested(value, "component instance id");
  assertId(value.componentId, "componentId");
  assertId(value.spatialNodeId, "spatialNodeId");
  assertOwner(value.owner);
  assertId(value.packageLock.packageVersion, "packageLock.packageVersion");
  assertId(value.packageLock.packageIntegrity, "packageLock.packageIntegrity");
  assertId(value.packageLock.manifestHash, "packageLock.manifestHash");
  if (value.packageLock.structureHash !== undefined)
    assertId(value.packageLock.structureHash, "packageLock.structureHash");
  assertRecordKeys(value.slots, "slot binding id");
  for (const targetIds of Object.values(value.slots))
    for (const targetId of targetIds) assertId(targetId, "slot binding targetId");
  assertRecordKeys(value.variants, "variant id");
  for (const variantValue of Object.values(value.variants)) assertId(variantValue, "variant value");
  for (const partOverride of value.partOverrides) assertId(partOverride.partId, "part override id");
  assertRecordKeys(value.props, "prop binding id");
};
const assertContentIds = (node: ContentNodeDeclaration): void => {
  assertStableNested(node, "content node id");
  assertLayout(node.layout);
  if (node.kind === "frame") for (const child of node.children) assertContentIds(child);
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
  assertVector(value.physicalSizeMeters, 2, "physicalSizeMeters", true);
  assertVector(value.logicalSize, 2, "logicalSize", true);
  assertSurfaceSemanticIds(value);
};
const assertSurfaceSemanticIds = (
  value: Pick<
    SurfaceDeclaration,
    "baseSemanticTree" | "initialStateId" | "states" | "interactions"
  >,
): void => {
  if (Object.keys(value.interactions).length !== 0)
    invalid("The initial non-interactive Surface milestone requires empty interactions.");
  assertId(value.initialStateId, "initialStateId");
  for (const rootNodeId of value.baseSemanticTree.rootNodeIds)
    assertId(rootNodeId, "semantic root id");
  assertRecordKeys(value.baseSemanticTree.nodes, "semantic node record key");
  for (const node of Object.values(value.baseSemanticTree.nodes)) {
    assertStableNested(node, "semantic node id");
    if (node.parentId !== null) assertId(node.parentId, "semantic parentId");
    if (node.interactionId !== undefined)
      invalid("The initial non-interactive Surface milestone forbids semantic interactionId.");
  }
  assertRecordKeys(value.states, "surface state record key");
  for (const stateValue of Object.values(value.states)) {
    assertStableNested(stateValue, "surface state id");
    if (stateValue.enabledInteractionIds.length !== 0)
      invalid("The initial non-interactive Surface milestone cannot enable interactions.");
    for (const interactionId of stateValue.enabledInteractionIds)
      assertId(interactionId, "enabledInteractionId");
    for (const stateOverride of stateValue.semanticOverrides) {
      assertStableNested(stateOverride, "semantic override id");
      assertId(stateOverride.targetId, "semantic override targetId");
    }
  }
};
const assertFlowIds = (flow: FlowDeclaration): void => {
  assertId(flow.initialGroupId, "flow.initialGroupId");
  assertRecordKeys(flow.groups, "flow group record key");
  for (const group of Object.values(flow.groups)) {
    assertStableNested(group, "flow group id");
    assertId(group.initialStepId, "flow group initialStepId");
    assertRecordKeys(group.steps, "flow step record key");
    for (const step of Object.values(group.steps)) {
      assertStableNested(step, "flow step id");
      for (const cueValue of step.cues) {
        assertStableNested(cueValue, "cue id");
        if (cueValue.trigger.kind === "event") assertId(cueValue.trigger.event, "cue event");
        else {
          assertId(cueValue.trigger.componentInstanceId, "cue output componentInstanceId");
          assertId(cueValue.trigger.outputId, "cue outputId");
        }
        for (const invocation of cueValue.actions) {
          assertId(invocation.componentInstanceId, "cue action componentInstanceId");
          assertId(invocation.actionId, "cue actionId");
          assertRecordKeys(invocation.arguments, "cue action argument id");
        }
        if (cueValue.toStepId !== undefined) assertId(cueValue.toStepId, "cue toStepId");
        if (cueValue.toGroupId !== undefined) assertId(cueValue.toGroupId, "cue toGroupId");
      }
    }
  }
  assertRecordKeys(flow.variables, "flow variable record key");
  for (const variable of Object.values(flow.variables)) {
    assertStableNested(variable, "flow variable id");
    assertOwner(variable.owner);
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
  for (const reference of declaration.assets) assertId(reference.assetId, "assetId");
  if (declaration.theme !== undefined) assertId(declaration.theme.themeId, "themeId");
  for (const operation of declaration.operations) {
    assertStableNested(operation, "operation id");
    assertId(operation.instanceId, "operation instanceId");
    assertId(operation.provenance.componentId, "operation provenance componentId");
  }
  assertStableNested(declaration, "id");
};
const assertThemeDeclaration = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ThemeDeclaration;
  assertRecordKeys(declaration.tokens, "theme token id");
  assertRecordKeys(declaration.namedStyles, "named style id");
  assertStableNested(declaration, "id");
};
const assertComponentManifest = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ComponentManifest;
  assertId(declaration.componentId, "componentId");
  assertSource(declaration.source);
  if (!positiveSafeIntegerSchema.safeParse(declaration.version).success)
    invalid("Component version must be a positive integer.");
  for (const [label, members] of Object.entries({
    prop: declaration.props,
    slot: declaration.slots,
    part: declaration.parts,
    variant: declaration.variants,
    state: declaration.states,
    action: declaration.actions,
    output: declaration.outputs,
  }))
    assertRecordKeys(members, `${label} id`);
  for (const actionValue of Object.values(declaration.actions)) {
    assertRecordKeys(actionValue.inputs, "action input id");
    if (!z.array(z.unknown()).min(1).safeParse(actionValue.effects).success)
      invalid("Component actions must declare at least one effect.");
    for (const precondition of actionValue.preconditions) {
      assertId(precondition.surfaceId, "action precondition surfaceId");
      assertId(precondition.stateId, "action precondition stateId");
    }
    for (const effect of actionValue.effects) {
      if (effect.kind === "setSurfaceState") {
        assertId(effect.surfaceId, "action effect surfaceId");
        assertId(effect.stateId, "action effect stateId");
      } else assertId(effect.timelineId, "action effect timelineId");
    }
  }
  for (const slotValue of Object.values(declaration.slots))
    for (const accepted of slotValue.accepts) assertId(accepted, "slot accepted kind");
  for (const variantValue of Object.values(declaration.variants)) {
    for (const option of variantValue.values) assertId(option, "variant value");
    if (variantValue.default !== undefined) assertId(variantValue.default, "variant default");
  }
  for (const outputValue of Object.values(declaration.outputs)) {
    assertRecordKeys(outputValue.payload, "output payload id");
    if (outputValue.producer.kind === "surfaceInteraction")
      assertId(outputValue.producer.interactionId, "output producer interactionId");
    else if (outputValue.producer.kind === "timelineCompleted")
      assertId(outputValue.producer.timelineId, "output producer timelineId");
    else if (outputValue.producer.kind === "mediaCompleted")
      assertId(outputValue.producer.surfaceId, "output producer surfaceId");
    else if (
      !finiteNumberSchema.nonnegative().safeParse(outputValue.producer.afterMilliseconds).success
    )
      invalid("output producer afterMilliseconds must be a non-negative finite number.");
  }
  if (!("semantics" in declaration)) {
    for (const rendererId of declaration.renderers) assertId(rendererId, "renderer id");
  } else {
    assertRecordKeys(declaration.renderers, "renderer id");
    for (const renderer of Object.values(declaration.renderers)) {
      assertId(renderer.entry, "renderer entry");
      for (const bindingKey of renderer.bindingKeys) assertId(bindingKey, "renderer bindingKey");
    }
    for (const target of declaration.semantics.targets) {
      assertId(target.id, "opaque semantic target id");
      if (target.bindingKey !== undefined) assertId(target.bindingKey, "opaque bindingKey");
    }
    for (const semanticSurface of declaration.semantics.surfaces) {
      assertId(semanticSurface.id, "opaque surface id");
      assertId(semanticSurface.bindingKey, "opaque surface bindingKey");
      assertSurfaceSemanticIds(semanticSurface);
    }
  }
};
const assertComponentStructure = (value: unknown): void => {
  const declaration = assertJsonSafe(value) as ComponentStructure;
  assertId(declaration.componentId, "componentId");
  assertRecordKeys(declaration.partBindings, "part binding id");
  for (const targetId of Object.values(declaration.partBindings))
    assertId(targetId, "part binding targetId");
  assertRecordKeys(declaration.slotPlacements, "slot placement id");
  for (const targetId of Object.values(declaration.slotPlacements))
    assertId(targetId, "slot placement targetId");
  for (const timeline of declaration.timelines) assertStableNested(timeline, "timeline id");
  if (declaration.root.kind === "surface") assertSurfaceIds(declaration.root);
  else assertContentIds(declaration.root);
  assertStableNested(declaration, "id");
};

export const isPresentationDeclaration = (value: unknown): value is PresentationDeclaration =>
  isDeclaration(value, assertPresentationDeclaration);
export const isThemeDeclaration = (value: unknown): value is ThemeDeclaration =>
  isDeclaration(value, assertThemeDeclaration);
export const isComponentManifest = (value: unknown): value is ComponentManifest =>
  isDeclaration(value, assertComponentManifest);
export const isComponentStructure = (value: unknown): value is ComponentStructure =>
  isDeclaration(value, assertComponentStructure);

export const definePresentation = <const T extends PresentationDeclaration>(value: T): T => {
  assertPresentationDeclaration(value);
  return value;
};
export const defineTheme = <const T extends ThemeDeclaration>(value: T): T => {
  assertThemeDeclaration(value);
  return value;
};
export const defineComponentManifest = <const T extends ComponentManifest>(value: T): T => {
  assertComponentManifest(value);
  return value;
};
export const defineComponentStructure = <const T extends ComponentStructure>(value: T): T => {
  assertComponentStructure(value);
  return value;
};

export const stringProp = <const T extends WithoutKind<StringPropDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertSchema(stringPropSchema, declaration, "Invalid string prop declaration.");
  return build({ ...declaration, kind: "string" as const });
};
export const numberProp = <const T extends WithoutKind<NumberPropDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertSchema(numberPropSchema, declaration, "Invalid number prop declaration.");
  return build({ ...declaration, kind: "number" as const });
};
export const booleanProp = <const T extends WithoutKind<BooleanPropDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertSchema(booleanPropSchema, declaration, "Invalid boolean prop declaration.");
  return build({ ...declaration, kind: "boolean" as const });
};
export const slot = <const T extends WithoutKind<SlotDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertSchema(slotSchema, declaration, "Invalid slot declaration.");
  return build({ ...declaration, kind: "slot" as const });
};
export const part = <const T extends WithoutKind<PartDeclaration>>(value: T) => {
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
  if (!z.array(z.unknown()).min(1).safeParse(declaration.effects).success)
    invalid("Component actions must declare at least one effect.");
  return build({ ...declaration, kind: "action" as const });
};
export const output = <const T extends WithoutKind<OutputDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  return build({ ...declaration, kind: "output" as const });
};

export const surfaceState = (surfaceId: string, stateId: string): ActionPrecondition => {
  assertId(surfaceId, "surfaceId");
  assertId(stateId, "stateId");
  return { kind: "surfaceState", surfaceId, stateId };
};
export const setSurfaceState = (surfaceId: string, stateId: string): ActionEffect => {
  assertId(surfaceId, "surfaceId");
  assertId(stateId, "stateId");
  return { kind: "setSurfaceState", surfaceId, stateId };
};
export const playTimeline = (
  timelineId: string,
  options: { completion: "blocking" | "nonBlocking" },
): ActionEffect => {
  assertId(timelineId, "timelineId");
  const declaration = assertJsonSafe(options);
  if (!z.object({ completion: z.enum(["blocking", "nonBlocking"]) }).safeParse(declaration).success)
    invalid("completion must be blocking or nonBlocking.");
  return build({ kind: "playTimeline", timelineId, ...declaration });
};
export const surfaceInteraction = (interactionId: string): OutputProducer => {
  assertId(interactionId, "interactionId");
  return { kind: "surfaceInteraction", interactionId };
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
  if (!finiteNumberSchema.nonnegative().safeParse(afterMilliseconds).success)
    invalid("afterMilliseconds must be a non-negative finite number.");
  return { kind: "timer", afterMilliseconds };
};
export const invokeComponentAction = <const T extends Omit<ComponentActionInvocation, "kind">>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.componentInstanceId, "componentInstanceId");
  assertId(declaration.actionId, "actionId");
  return build({ ...declaration, kind: "component.action" as const });
};
export const componentOutput = <const T extends Omit<ComponentOutputReference, "kind">>(
  value: T,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.componentInstanceId, "componentInstanceId");
  assertId(declaration.outputId, "outputId");
  return build({ ...declaration, kind: "component.output" as const });
};
export const cue = <const T extends CueDeclaration>(value: T): T => defineStable(value);

export const tokenRef = <const T extends WithoutKind<TokenReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.tokenId, "tokenId");
  return build({ ...declaration, kind: "token-ref" as const });
};
export const namedStyleRef = <const T extends WithoutKind<NamedStyleReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.styleId, "styleId");
  return build({ ...declaration, kind: "named-style-ref" as const });
};
export const assetRef = <const T extends WithoutKind<AssetReference>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.assetId, "assetId");
  return build({ ...declaration, kind: "asset-ref" as const });
};

export const spatial = <const T extends WithoutStableKind<SpatialDeclaration>>(value: T) => {
  const snapshot = assertJsonSafe(value);
  const declaration = { ...snapshot, kind: "spatial" as const };
  assertSpatialFields(declaration);
  return defineStable(declaration);
};
export const frame = <const T extends WithoutStableKind<FrameDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertLayout(declaration.layout);
  return defineStable({ ...declaration, kind: "frame" as const });
};
export const text = <const T extends WithoutStableKind<TextDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertLayout(declaration.layout);
  return defineStable({ ...declaration, kind: "text" as const });
};
export const surface = <const T extends WithoutStableKind<SurfaceDeclaration>>(value: T) => {
  const snapshot = assertJsonSafe(value);
  const declaration = { ...snapshot, kind: "surface" as const };
  assertSurfaceIds(declaration);
  return defineStable(declaration);
};
export const semanticOverride = <const T extends WithoutStableKind<SemanticOverrideDeclaration>>(
  value: Exact<T, WithoutStableKind<SemanticOverrideDeclaration>>,
) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.targetId, "targetId");
  return defineStable({ ...declaration, kind: "semantic-override" as const });
};
export const componentInstance = <const T extends WithoutStableKind<ComponentInstanceDeclaration>>(
  value: T,
) => {
  const snapshot = assertJsonSafe(value);
  assertId(snapshot.componentId, "componentId");
  assertId(snapshot.spatialNodeId, "spatialNodeId");
  const declaration = { ...snapshot, kind: "component-instance" as const };
  assertComponentInstanceIds(declaration);
  return defineStable(declaration);
};
export const detach = <const T extends WithoutStableKind<DetachDeclaration>>(value: T) => {
  const declaration = assertJsonSafe(value);
  assertId(declaration.instanceId, "instanceId");
  assertId(declaration.provenance.componentId, "provenance.componentId");
  return defineStable({ ...declaration, kind: "detach" as const });
};
