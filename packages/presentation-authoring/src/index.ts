import type { Diagnostic } from "@unframe/presentation-core";
import { z } from "zod";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export type Scalar = null | boolean | number | string;
export type ScalarType = "null" | "boolean" | "number" | "string";

export type SourceMetadata = {
  file: string;
  range?: readonly [start: number, end: number];
};
export type StableDeclaration = { id: string; source?: SourceMetadata };
export type AuthoringDiagnostic = Diagnostic & {
  severity?: "error" | "warning";
  source?: SourceMetadata;
};

export type ResourceOwner = { kind: "presentation" } | { kind: "group"; groupId: string };
export type ProjectionAudience = { kind: "all" } | { kind: "role"; role: "presenter" | "viewer" };

export type StringPropDeclaration = { kind: "string"; required?: boolean; default?: string };
export type NumberPropDeclaration = { kind: "number"; required?: boolean; default?: number };
export type BooleanPropDeclaration = { kind: "boolean"; required?: boolean; default?: boolean };
export type PropDeclaration =
  | StringPropDeclaration
  | NumberPropDeclaration
  | BooleanPropDeclaration;

export type SlotDeclaration = {
  kind: "slot";
  accepts: readonly string[];
  cardinality: "one" | "many";
  required?: boolean;
};
export type PartDeclaration = {
  kind: "part";
  overridable: readonly ("content" | "placement" | "style")[];
};
export type VariantDeclaration = {
  kind: "variant";
  values: readonly string[];
  default?: string;
};
export type StateDeclaration = { kind: "state"; initial?: boolean };

export type ActionValue =
  | { kind: "literal"; value: Scalar }
  | { kind: "eventPayload"; field: string }
  | { kind: "variable"; variableId: string };
export type ActionPrecondition = {
  kind: "surfaceState";
  surfaceId: string;
  stateId: string;
};
export type ActionEffect =
  | { kind: "setSurfaceState"; surfaceId: string; stateId: string }
  | {
      kind: "playTimeline";
      timelineId: string;
      completion: "blocking" | "nonBlocking";
    };
export type ActionDeclaration = {
  kind: "action";
  inputs: Readonly<Record<string, ScalarType>>;
  preconditions: readonly ActionPrecondition[];
  effects: readonly ActionEffect[];
};

export type OutputPayloadField =
  | { type: "null"; value: null }
  | { type: "boolean"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string };
export type OutputProducer =
  | { kind: "surfaceInteraction"; interactionId: string }
  | { kind: "timelineCompleted"; timelineId: string }
  | { kind: "mediaCompleted"; surfaceId: string }
  | { kind: "timer"; afterMilliseconds: number };
export type OutputDeclaration = {
  kind: "output";
  payload: Readonly<Record<string, OutputPayloadField>>;
  producer: OutputProducer;
};

export type TokenReference = { kind: "token-ref"; tokenId: string };
export type NamedStyleReference = { kind: "named-style-ref"; styleId: string };
export type AssetReference = { kind: "asset-ref"; assetId: string };

export type TransformDeclaration = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
};
export type StageDeclaration = {
  coordinateSystem: {
    unit: "meter";
    handedness: "right";
    upAxis: "+Y";
    forwardAxis: "-Z";
  };
  size: readonly [number, number, number];
};

export type SpatialDeclaration = StableDeclaration & {
  kind: "spatial";
  name: string;
  owner: ResourceOwner;
  audience: ProjectionAudience;
  parent: { kind: "stage" } | { kind: "node"; nodeId: string };
  order: number;
  transform: TransformDeclaration;
  active: boolean;
  visible: boolean;
  opacity: number;
};
export type AbsoluteLayoutDeclaration = {
  kind: "absolute";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SemanticNodeDeclaration = StableDeclaration & {
  parentId: string | null;
  order: number;
  role: "heading" | "paragraph" | "image" | "button" | "table" | "list" | "listItem";
  text?: string;
  language?: string;
  alt?: string;
  interactionId?: never;
};
export type InteractionDeclaration = StableDeclaration & {
  kind: "click";
  event: string;
};
export type SemanticOverrideDeclaration = StableDeclaration & {
  kind: "semantic-override";
  targetId: string;
  included?: boolean;
  text?: string | null;
  language?: string | null;
  alt?: string | null;
};
export type SurfaceStateDeclaration = StableDeclaration & {
  semanticOverrides: readonly SemanticOverrideDeclaration[];
  enabledInteractionIds: readonly string[];
};

export type FrameDeclaration = StableDeclaration & {
  kind: "frame";
  layout: AbsoluteLayoutDeclaration;
  children: readonly ContentNodeDeclaration[];
  style?: NamedStyleReference;
};
export type TextDeclaration = StableDeclaration & {
  kind: "text";
  value: string;
  layout: AbsoluteLayoutDeclaration;
  style?: NamedStyleReference;
};
export type SurfaceDeclaration = StableDeclaration & {
  kind: "surface";
  physicalSizeMeters: readonly [number, number];
  logicalSize: readonly [number, number];
  fit: "contain" | "cover" | "stretch";
  root: FrameDeclaration;
  baseSemanticTree: {
    rootNodeIds: readonly string[];
    nodes: Readonly<Record<string, SemanticNodeDeclaration>>;
  };
  interactions: Readonly<Record<string, never>>;
  initialStateId: string;
  states: Readonly<Record<string, SurfaceStateDeclaration>>;
  renderIntent: {
    updateModel: "static";
    interaction: "none";
    internalAnimation: "none";
    rendererPreference: "baked-web";
    fallbackPolicy: "reject";
  };
};
export type ContentNodeDeclaration = FrameDeclaration | TextDeclaration;
export type StructureRootDeclaration = SurfaceDeclaration | FrameDeclaration;

export type PartOverrideDeclaration = {
  partId: string;
  content?: Json;
  placement?: AbsoluteLayoutDeclaration;
  style?: Readonly<Record<string, Json>>;
};
export type ComponentPackageLock = {
  packageVersion: string;
  packageIntegrity: string;
  manifestHash: string;
  structureHash?: string;
};
export type ComponentInstanceDeclaration = StableDeclaration & {
  kind: "component-instance";
  componentId: string;
  version: number;
  packageLock: ComponentPackageLock;
  owner: ResourceOwner;
  spatialNodeId: string;
  props: Readonly<Record<string, Json | AssetReference | TokenReference>>;
  slots: Readonly<Record<string, readonly string[]>>;
  variants: Readonly<Record<string, string>>;
  partOverrides: readonly PartOverrideDeclaration[];
};
export type DetachDeclaration = StableDeclaration & {
  kind: "detach";
  mode: "structured";
  instanceId: string;
  provenance: { componentId: string; version: number };
};

export type ThemeDeclaration = StableDeclaration & {
  tokens: Readonly<Record<string, Json>>;
  namedStyles: Readonly<Record<string, Readonly<Record<string, Json>>>>;
};

type ComponentManifestMembers = {
  props: Readonly<Record<string, PropDeclaration>>;
  slots: Readonly<Record<string, SlotDeclaration>>;
  parts: Readonly<Record<string, PartDeclaration>>;
  variants: Readonly<Record<string, VariantDeclaration>>;
  states: Readonly<Record<string, StateDeclaration>>;
  actions: Readonly<Record<string, ActionDeclaration>>;
  outputs: Readonly<Record<string, OutputDeclaration>>;
};
export type OpaqueSemanticTarget = {
  id: string;
  kind: "node" | "timeline" | "variable" | "media";
  bindingKey?: string;
};
export type OpaqueSurfaceSemanticAdapter = {
  id: string;
  bindingKey: string;
  baseSemanticTree: SurfaceDeclaration["baseSemanticTree"];
  interactions: SurfaceDeclaration["interactions"];
  initialStateId: string;
  states: SurfaceDeclaration["states"];
};
export type OpaqueSemantics = {
  targets: readonly OpaqueSemanticTarget[];
  surfaces: readonly OpaqueSurfaceSemanticAdapter[];
};
export type ComponentManifest = ComponentManifestMembers & {
  componentId: string;
  version: number;
  source?: SourceMetadata;
} & (
    | {
        authoring: { mode: "structured"; structure: string };
        renderers: readonly string[];
      }
    | {
        authoring: { mode: "opaque" };
        renderers: Readonly<Record<string, { entry: string; bindingKeys: readonly string[] }>>;
        semantics: OpaqueSemantics;
      }
  );

export type ComponentStructure = StableDeclaration & {
  componentId: string;
  root: StructureRootDeclaration;
  partBindings: Readonly<Record<string, string>>;
  slotPlacements: Readonly<Record<string, string>>;
  timelines: readonly StableDeclaration[];
};

export type ComponentActionInvocation = {
  kind: "component.action";
  componentInstanceId: string;
  actionId: string;
  arguments: Readonly<Record<string, ActionValue>>;
};
export type ComponentOutputReference = {
  kind: "component.output";
  componentInstanceId: string;
  outputId: string;
};
export type CueTrigger = { kind: "event"; event: string } | ComponentOutputReference;
export type CueDeclaration = StableDeclaration & {
  trigger: CueTrigger;
  actions: readonly ComponentActionInvocation[];
  toStepId?: string;
  toGroupId?: string;
};
export type FlowStepDeclaration = StableDeclaration & { cues: readonly CueDeclaration[] };
export type FlowGroupDeclaration = StableDeclaration & {
  initialStepId: string;
  steps: Readonly<Record<string, FlowStepDeclaration>>;
};
export type VariableDeclaration =
  | (StableDeclaration & { owner: ResourceOwner; type: "null"; initialValue: null })
  | (StableDeclaration & { owner: ResourceOwner; type: "boolean"; initialValue: boolean })
  | (StableDeclaration & { owner: ResourceOwner; type: "number"; initialValue: number })
  | (StableDeclaration & { owner: ResourceOwner; type: "string"; initialValue: string });
export type FlowDeclaration = {
  initialGroupId: string;
  groups: Readonly<Record<string, FlowGroupDeclaration>>;
  variables: Readonly<Record<string, VariableDeclaration>>;
};
export type PresentationDeclaration = StableDeclaration & {
  metadata: { title: string };
  stage: StageDeclaration;
  scene: {
    spatial: readonly SpatialDeclaration[];
    components: readonly ComponentInstanceDeclaration[];
  };
  theme?: { themeId: string };
  assets: readonly AssetReference[];
  flow: FlowDeclaration;
  operations: readonly DetachDeclaration[];
};

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

const snapshotJson = (value: unknown, ancestors = new WeakSet<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value !== "object") invalid("Declarations must contain JSON-safe values.");

  const object = value as object;
  if (ancestors.has(object)) invalid("Declarations must not contain cycles.");
  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        Object.keys(value).length !== value.length ||
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        )
      )
        invalid("Declarations must not contain sparse arrays or custom array properties.");
      const snapshot: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor))
          invalid("Declarations must contain data properties.");
        snapshot.push(
          snapshotJson((descriptor as PropertyDescriptor & { value: unknown }).value, ancestors),
        );
      }
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      invalid("Declarations must be plain data.");
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key !== "string") invalid("Declarations must use string object keys.");
      const stringKey = key as string;
      const descriptor = Object.getOwnPropertyDescriptor(object, stringKey);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
        invalid("Declarations must contain enumerable data properties only.");
      Object.defineProperty(snapshot, stringKey, {
        value: snapshotJson(
          (descriptor as PropertyDescriptor & { value: unknown }).value,
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(object);
  }
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

const assertJsonSafe = (value: unknown, ancestors = new WeakSet<object>()): void => {
  const snapshot = snapshotJson(value, ancestors);
  if (!jsonValueSchema.safeParse(snapshot).success)
    invalid("Declarations must contain finite JSON numbers.");
};

const defineStable = <const T extends StableDeclaration>(value: T): T => {
  assertId(value.id);
  assertSource(value.source);
  assertJsonSafe(value);
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

export const definePresentation = <const T extends PresentationDeclaration>(value: T): T => {
  assertJsonSafe(value);
  assertVector(value.stage.size, 3, "stage.size", true);
  assertFlowIds(value.flow);
  for (const node of value.scene.spatial) {
    assertSpatialFields(node);
  }
  for (const instance of value.scene.components) {
    assertComponentInstanceIds(instance);
  }
  for (const reference of value.assets) assertId(reference.assetId, "assetId");
  if (value.theme !== undefined) assertId(value.theme.themeId, "themeId");
  for (const operation of value.operations) {
    assertStableNested(operation, "operation id");
    assertId(operation.instanceId, "operation instanceId");
    assertId(operation.provenance.componentId, "operation provenance componentId");
  }
  return defineStable(value);
};
export const defineTheme = <const T extends ThemeDeclaration>(value: T): T => {
  assertJsonSafe(value);
  assertRecordKeys(value.tokens, "theme token id");
  assertRecordKeys(value.namedStyles, "named style id");
  return defineStable(value);
};
export const defineComponentManifest = <const T extends ComponentManifest>(value: T): T => {
  assertJsonSafe(value);
  assertId(value.componentId, "componentId");
  assertSource(value.source);
  if (!positiveSafeIntegerSchema.safeParse(value.version).success)
    invalid("Component version must be a positive integer.");
  for (const [label, members] of Object.entries({
    prop: value.props,
    slot: value.slots,
    part: value.parts,
    variant: value.variants,
    state: value.states,
    action: value.actions,
    output: value.outputs,
  }))
    assertRecordKeys(members, `${label} id`);
  for (const actionValue of Object.values(value.actions)) {
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
  for (const slotValue of Object.values(value.slots))
    for (const accepted of slotValue.accepts) assertId(accepted, "slot accepted kind");
  for (const variantValue of Object.values(value.variants)) {
    for (const option of variantValue.values) assertId(option, "variant value");
    if (variantValue.default !== undefined) assertId(variantValue.default, "variant default");
  }
  for (const outputValue of Object.values(value.outputs)) {
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
  if (!("semantics" in value)) {
    for (const rendererId of value.renderers) assertId(rendererId, "renderer id");
  } else {
    assertRecordKeys(value.renderers, "renderer id");
    for (const renderer of Object.values(value.renderers)) {
      assertId(renderer.entry, "renderer entry");
      for (const bindingKey of renderer.bindingKeys) assertId(bindingKey, "renderer bindingKey");
    }
    for (const target of value.semantics.targets) {
      assertId(target.id, "opaque semantic target id");
      if (target.bindingKey !== undefined) assertId(target.bindingKey, "opaque bindingKey");
    }
    for (const semanticSurface of value.semantics.surfaces) {
      assertId(semanticSurface.id, "opaque surface id");
      assertId(semanticSurface.bindingKey, "opaque surface bindingKey");
      assertSurfaceSemanticIds(semanticSurface);
    }
  }
  assertJsonSafe(value);
  return value;
};
export const defineComponentStructure = <const T extends ComponentStructure>(value: T): T => {
  assertJsonSafe(value);
  assertId(value.componentId, "componentId");
  assertRecordKeys(value.partBindings, "part binding id");
  for (const targetId of Object.values(value.partBindings))
    assertId(targetId, "part binding targetId");
  assertRecordKeys(value.slotPlacements, "slot placement id");
  for (const targetId of Object.values(value.slotPlacements))
    assertId(targetId, "slot placement targetId");
  for (const timeline of value.timelines) assertStableNested(timeline, "timeline id");
  if (value.root.kind === "surface") assertSurfaceIds(value.root);
  else assertContentIds(value.root);
  return defineStable(value);
};

export const stringProp = <const T extends WithoutKind<StringPropDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(stringPropSchema, value, "Invalid string prop declaration."),
  build({ ...value, kind: "string" as const })
);
export const numberProp = <const T extends WithoutKind<NumberPropDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(numberPropSchema, value, "Invalid number prop declaration."),
  build({ ...value, kind: "number" as const })
);
export const booleanProp = <const T extends WithoutKind<BooleanPropDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(booleanPropSchema, value, "Invalid boolean prop declaration."),
  build({ ...value, kind: "boolean" as const })
);
export const slot = <const T extends WithoutKind<SlotDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(slotSchema, value, "Invalid slot declaration."),
  build({ ...value, kind: "slot" as const })
);
export const part = <const T extends WithoutKind<PartDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(partSchema, value, "Invalid part declaration."),
  build({ ...value, kind: "part" as const })
);
export const variant = <const T extends WithoutKind<VariantDeclaration>>(value: T) => (
  assertJsonSafe(value),
  assertSchema(variantSchema, value, "Invalid variant declaration."),
  build({ ...value, kind: "variant" as const })
);
export function state(): StateDeclaration;
export function state<const T extends WithoutKind<StateDeclaration>>(
  value: T,
): T & { kind: "state" };
export function state(value: WithoutKind<StateDeclaration> = {}): StateDeclaration {
  assertJsonSafe(value);
  assertSchema(stateSchema, value, "Invalid state declaration.");
  return build({ ...value, kind: "state" });
}
export const action = <const T extends WithoutKind<ActionDeclaration>>(value: T) =>
  (assertJsonSafe(value), !z.array(z.unknown()).min(1).safeParse(value.effects).success)
    ? invalid("Component actions must declare at least one effect.")
    : build({ ...value, kind: "action" as const });
export const output = <const T extends WithoutKind<OutputDeclaration>>(value: T) => (
  assertJsonSafe(value),
  build({ ...value, kind: "output" as const })
);

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
  assertJsonSafe(options);
  if (!z.object({ completion: z.enum(["blocking", "nonBlocking"]) }).safeParse(options).success)
    invalid("completion must be blocking or nonBlocking.");
  return build({ kind: "playTimeline", timelineId, ...options });
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
  assertJsonSafe(value);
  assertId(value.componentInstanceId, "componentInstanceId");
  assertId(value.actionId, "actionId");
  return build({ ...value, kind: "component.action" as const });
};
export const componentOutput = <const T extends Omit<ComponentOutputReference, "kind">>(
  value: T,
) => {
  assertJsonSafe(value);
  assertId(value.componentInstanceId, "componentInstanceId");
  assertId(value.outputId, "outputId");
  return build({ ...value, kind: "component.output" as const });
};
export const cue = <const T extends CueDeclaration>(value: T): T => defineStable(value);

export const tokenRef = <const T extends WithoutKind<TokenReference>>(value: T) => {
  assertJsonSafe(value);
  assertId(value.tokenId, "tokenId");
  return build({ ...value, kind: "token-ref" as const });
};
export const namedStyleRef = <const T extends WithoutKind<NamedStyleReference>>(value: T) => {
  assertJsonSafe(value);
  assertId(value.styleId, "styleId");
  return build({ ...value, kind: "named-style-ref" as const });
};
export const assetRef = <const T extends WithoutKind<AssetReference>>(value: T) => {
  assertJsonSafe(value);
  assertId(value.assetId, "assetId");
  return build({ ...value, kind: "asset-ref" as const });
};

export const spatial = <const T extends WithoutStableKind<SpatialDeclaration>>(value: T) => {
  assertJsonSafe(value);
  const declaration = { ...value, kind: "spatial" as const };
  assertSpatialFields(declaration);
  return defineStable(declaration);
};
export const frame = <const T extends WithoutStableKind<FrameDeclaration>>(value: T) => {
  assertJsonSafe(value);
  assertLayout(value.layout);
  return defineStable({ ...value, kind: "frame" as const });
};
export const text = <const T extends WithoutStableKind<TextDeclaration>>(value: T) => {
  assertJsonSafe(value);
  assertLayout(value.layout);
  return defineStable({ ...value, kind: "text" as const });
};
export const surface = <const T extends WithoutStableKind<SurfaceDeclaration>>(value: T) => {
  assertJsonSafe(value);
  const declaration = { ...value, kind: "surface" as const };
  assertSurfaceIds(declaration);
  return defineStable(declaration);
};
export const semanticOverride = <const T extends WithoutStableKind<SemanticOverrideDeclaration>>(
  value: Exact<T, WithoutStableKind<SemanticOverrideDeclaration>>,
) => {
  assertJsonSafe(value);
  assertId(value.targetId, "targetId");
  return defineStable({ ...value, kind: "semantic-override" as const });
};
export const componentInstance = <const T extends WithoutStableKind<ComponentInstanceDeclaration>>(
  value: T,
) => {
  assertJsonSafe(value);
  assertId(value.componentId, "componentId");
  assertId(value.spatialNodeId, "spatialNodeId");
  const declaration = { ...value, kind: "component-instance" as const };
  assertComponentInstanceIds(declaration);
  return defineStable(declaration);
};
export const detach = <const T extends WithoutStableKind<DetachDeclaration>>(value: T) => {
  assertJsonSafe(value);
  assertId(value.instanceId, "instanceId");
  assertId(value.provenance.componentId, "provenance.componentId");
  return defineStable({ ...value, kind: "detach" as const });
};
