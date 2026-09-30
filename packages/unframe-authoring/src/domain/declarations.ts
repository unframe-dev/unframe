import type { Diagnostic } from "@unframe/unframe-core";

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
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

export type ResourceOwner = { kind: "presentation" } | { groupId: string; kind: "group" };
export type ProjectionAudience = { kind: "all" } | { kind: "role"; role: "presenter" | "viewer" };

type RequiredProp = { default?: never; required: true };
type DefaultProp<T> = { default: T; required?: never };
export type StringPropDeclaration = { kind: "string" } & (RequiredProp | DefaultProp<string>);
export type NumberPropDeclaration = { kind: "number" } & (RequiredProp | DefaultProp<number>);
export type BooleanPropDeclaration = { kind: "boolean" } & (RequiredProp | DefaultProp<boolean>);
export type PropDeclaration =
  | StringPropDeclaration
  | NumberPropDeclaration
  | BooleanPropDeclaration;
export type PropReference<T extends "string" | "number" | "boolean"> = {
  expectedType: T;
  kind: "prop-ref";
  propId: string;
};
export type StringValueDeclaration = string | PropReference<"string">;
export type NumberValueDeclaration = number | PropReference<"number">;
export type BooleanValueDeclaration = boolean | PropReference<"boolean">;

export type SlotDeclaration = {
  kind: "slot";
};
export type PartDeclaration = {
  kind: "part";
};
export type VariantDeclaration = {
  default?: string;
  kind: "variant";
  values: ReadonlyArray<string>;
};
export type StateDeclaration = { initial?: boolean; kind: "state" };

export type ActionValue =
  | { kind: "literal"; value: Scalar }
  | { field: string; kind: "eventPayload" }
  | { kind: "variable"; variableId: string }
  | { inputId: string; kind: "input" };
export type ActionPrecondition = {
  kind: "surfaceState";
  stateId: string;
  surfaceId: string;
};
export type ActionEffect =
  | {
      kind: "setSurfaceState";
      stateId: string;
      surfaceId: string;
      transition?:
        | { kind: "cut" }
        | {
            completion: "blocking";
            durationMilliseconds: number;
            easing: "linear" | "cubicIn" | "cubicOut" | "cubicInOut";
            kind: "crossfade";
          };
    }
  | { kind: "setVariable"; value: ActionValue; variableId: string }
  | {
      kind: "patchNode";
      nodeId: string;
      patch: { active?: ActionValue; opacity?: ActionValue; visible?: ActionValue };
    }
  | {
      completion: "blocking" | "nonBlocking";
      kind: "playTimeline";
      timelineId: string;
    };
export type ActionDeclaration = {
  effects: ReadonlyArray<ActionEffect>;
  inputs: Readonly<Record<string, ScalarType>>;
  kind: "action";
  preconditions: ReadonlyArray<ActionPrecondition>;
};

export type OutputPayloadField =
  | { type: "null"; value: null }
  | { type: "boolean"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string };
export type OutputProducer =
  | { interactionId: string; kind: "surfaceInteraction" }
  | { kind: "timelineCompleted"; timelineId: string }
  | { kind: "mediaCompleted"; surfaceId: string }
  | { afterMilliseconds: number; kind: "timer" };
export type OutputDeclaration = {
  kind: "output";
  payload: Readonly<Record<string, OutputPayloadField>>;
  producer: OutputProducer;
};

export type TokenCategory =
  | "color"
  | "logicalLength"
  | "spatialLength"
  | "fontFace"
  | "duration"
  | "easing";
export type TokenReference<C extends TokenCategory = TokenCategory> = {
  category: C;
  kind: "token-ref";
  tokenId: string;
};
export type NamedStyleReference = { kind: "named-style-ref"; styleId: string };
export type AssetReference = { assetId: string; kind: "asset-ref" };

export type TransformDeclaration = {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  scale: readonly [number, number, number];
};
export type StageDeclaration = {
  coordinateSystem: {
    forwardAxis: "-Z";
    handedness: "right";
    unit: "meter";
    upAxis: "+Y";
  };
  size: readonly [number, number, number];
};

export type SpatialDeclaration = StableDeclaration & {
  active: boolean;
  audience: ProjectionAudience;
  kind: "spatial";
  name: string;
  opacity: number;
  order: number;
  owner: ResourceOwner;
  parent: { kind: "stage" } | { kind: "node"; nodeId: string };
  transform: TransformDeclaration;
  visible: boolean;
};
export type AbsoluteLayoutDeclaration = {
  height: NumberValueDeclaration;
  kind: "absolute";
  width: NumberValueDeclaration;
  x: NumberValueDeclaration;
  y: NumberValueDeclaration;
};
export type ConcreteAbsoluteLayoutDeclaration = {
  height: number;
  kind: "absolute";
  width: number;
  x: number;
  y: number;
};

type SemanticNodeBase = StableDeclaration & {
  order: number;
  parentId: string | null;
};
type SemanticText = { language?: string; text: StringValueDeclaration };
export type SemanticNodeDeclaration = SemanticNodeBase &
  (
    | ({ level: 1 | 2 | 3 | 4 | 5 | 6; role: "heading" } & SemanticText)
    | ({ role: "paragraph" } & SemanticText)
    | { alt: string; language?: string; role: "image" }
    | ({ interactionId: string; role: "button" } & SemanticText)
    | { ordered: boolean; role: "list" }
    | ({ role: "listItem" } & SemanticText)
    | { label?: string; language?: string; role: "table" }
    | { role: "row" }
    | ({ role: "cell" } & SemanticText)
    | ({ role: "columnHeader" } & SemanticText)
    | ({ role: "rowHeader" } & SemanticText)
  );
export type InteractionDeclaration = StableDeclaration & {
  event: string;
  hitPriority: number;
  kind: "click";
};
type CommonContentOverrideDeclaration = {
  opacity?: NumberValueDeclaration;
  placement?: AbsoluteLayoutDeclaration;
  visible?: BooleanValueDeclaration;
};
export type ContentOverrideDeclaration = CommonContentOverrideDeclaration &
  (
    | {
        backgroundColor?: ColorValueDeclaration;
        border?: BorderDeclaration;
        clip?: BooleanValueDeclaration;
        kind: "frame";
        layout?: { kind: "absolute" };
      }
    | { kind: "text"; style?: TextStyleDeclaration; value?: StringValueDeclaration }
  );
export type SemanticOverrideDeclaration = StableDeclaration & {
  alt?: string | null;
  included?: boolean;
  kind: "semantic-override";
  label?: string | null;
  language?: string | null;
  targetId: string;
  text?: string | null;
};
export type SurfaceStateDeclaration = StableDeclaration & {
  contentOverrides?: Readonly<Record<string, ContentOverrideDeclaration>>;
  enabledInteractionIds: ReadonlyArray<string>;
  semanticOverrides: ReadonlyArray<SemanticOverrideDeclaration>;
};

export type ConcreteSrgbaColorDeclaration = {
  alpha: number;
  blue: number;
  green: number;
  red: number;
};
export type SrgbaColorDeclaration = {
  alpha: NumberValueDeclaration;
  blue: NumberValueDeclaration;
  green: NumberValueDeclaration;
  red: NumberValueDeclaration;
};
export type FontReference = AssetReference | TokenReference<"fontFace">;
export type ColorValueDeclaration = SrgbaColorDeclaration | TokenReference<"color">;
export type LogicalLengthValueDeclaration =
  | NumberValueDeclaration
  | TokenReference<"logicalLength">;
export type BorderDeclaration = {
  color: ColorValueDeclaration;
  radius: LogicalLengthValueDeclaration;
  width: LogicalLengthValueDeclaration;
};
export type TextStyleDeclaration = {
  align?: "start" | "center" | "end" | PropReference<"string">;
  color?: ColorValueDeclaration;
  fallbackFonts?: ReadonlyArray<FontReference>;
  font?: FontReference;
  fontSize?: LogicalLengthValueDeclaration;
  lineHeight?: LogicalLengthValueDeclaration;
  overflow?: "clip" | "ellipsis" | PropReference<"string">;
  weight?: "regular" | "bold" | PropReference<"string">;
};
export type FrameStyleDeclaration = {
  backgroundColor?: ColorValueDeclaration;
  border?: BorderDeclaration;
  clip?: BooleanValueDeclaration;
};
type CommonPrimitiveDeclaration = {
  opacity?: NumberValueDeclaration;
  semanticNodeId?: string;
  visible?: BooleanValueDeclaration;
};

export type FrameDeclaration = StableDeclaration &
  CommonPrimitiveDeclaration & {
    children: ReadonlyArray<ContentNodeDeclaration>;
    kind: "frame";
    layout: AbsoluteLayoutDeclaration;
    namedStyle?: NamedStyleReference;
    style?: FrameStyleDeclaration;
  };
export type SlotPlaceholderDeclaration = StableDeclaration & {
  kind: "slot-placeholder";
  semanticParentId?: string;
  slotId: string;
};
export type TextDeclaration = StableDeclaration &
  CommonPrimitiveDeclaration & {
    kind: "text";
    layout: AbsoluteLayoutDeclaration;
    maxCodePoints: NumberValueDeclaration;
    namedStyle?: NamedStyleReference;
    style?: TextStyleDeclaration;
    value: StringValueDeclaration;
  };
export type SurfaceDeclaration = StableDeclaration & {
  baseSemanticTree: BaseSemanticTreeDeclaration;
  fit: "contain" | "cover" | "stretch";
  initialStateId: string;
  interactions: Readonly<Record<string, InteractionDeclaration>>;
  kind: "surface";
  logicalSize: readonly [NumberValueDeclaration, NumberValueDeclaration];
  physicalSizeMeters: readonly [NumberValueDeclaration, NumberValueDeclaration];
  renderIntent: {
    fallbackPolicy: "reject";
    interaction: "none" | "regions";
    internalAnimation: "none";
    rendererPreference: "baked-web";
    updateModel: "static" | "finite-state";
  };
  root: FrameDeclaration;
  states: Readonly<Record<string, SurfaceStateDeclaration>>;
};
export type ContentNodeDeclaration =
  | FrameDeclaration
  | TextDeclaration
  | SlotPlaceholderDeclaration;
export type StructureRootDeclaration = SurfaceDeclaration | FrameDeclaration;

export type BaseSemanticTreeDeclaration = {
  nodes: Readonly<Record<string, SemanticNodeDeclaration>>;
  rootNodeIds: ReadonlyArray<string>;
};
export type ConcreteColorValueDeclaration = ConcreteSrgbaColorDeclaration | TokenReference<"color">;
export type ConcreteLogicalLengthValueDeclaration = number | TokenReference<"logicalLength">;
export type NamedBorderDeclaration = {
  color: ConcreteColorValueDeclaration;
  radius: ConcreteLogicalLengthValueDeclaration;
  width: ConcreteLogicalLengthValueDeclaration;
};
export type NamedTextStyleDeclaration = {
  align?: "start" | "center" | "end";
  color?: ConcreteColorValueDeclaration;
  fallbackFonts?: ReadonlyArray<FontReference>;
  font?: FontReference;
  fontSize?: ConcreteLogicalLengthValueDeclaration;
  lineHeight?: ConcreteLogicalLengthValueDeclaration;
  overflow?: "clip" | "ellipsis";
  weight?: "regular" | "bold";
};
export type NamedFrameStyleDeclaration = {
  backgroundColor?: ConcreteColorValueDeclaration;
  border?: NamedBorderDeclaration;
  clip?: boolean;
};
export type PartOverrideDeclaration =
  | {
      partId: string;
      placement?: ConcreteAbsoluteLayoutDeclaration;
      style?: NamedFrameStyleDeclaration;
      targetKind: "frame";
    }
  | {
      content?: string;
      partId: string;
      placement?: ConcreteAbsoluteLayoutDeclaration;
      style?: NamedTextStyleDeclaration;
      targetKind: "text";
    };
export type ComponentPackageLock = {
  manifestHash: string;
  origin:
    | {
        entryFile: string;
        files: readonly { path: string; hash: string }[];
        kind: "local";
        sourceHash: string;
      }
    | { kind: "package"; packageKey: string; subpath: string };
} & ({ mode: "structured"; structureHash: string } | { mode: "opaque"; rendererInputHash: string });
export type ComponentInstanceDeclaration = StableDeclaration & {
  componentId: string;
  kind: "component-instance";
  owner: ResourceOwner;
  partOverrides: ReadonlyArray<PartOverrideDeclaration>;
  props: Readonly<Record<string, string | number | boolean>>;
  slots: Readonly<Record<string, ReadonlyArray<string>>>;
  spatialNodeId?: string;
  variants: Readonly<Record<string, string>>;
  version: number;
};
export type DetachDeclaration = StableDeclaration & {
  instanceId: string;
  kind: "detach";
  mode: "structured";
  provenance: { componentId: string; version: number };
};

export type ThemeTokenDeclaration =
  | {
      category: "color";
      value: ConcreteSrgbaColorDeclaration | TokenReference<"color">;
    }
  | { category: "logicalLength"; value: number | TokenReference<"logicalLength"> }
  | { category: "spatialLength"; value: number | TokenReference<"spatialLength"> }
  | { category: "fontFace"; value: AssetReference | TokenReference<"fontFace"> }
  | { category: "duration"; value: number | TokenReference<"duration"> }
  | {
      category: "easing";
      value: "linear" | "cubicIn" | "cubicOut" | "cubicInOut" | TokenReference<"easing">;
    };
export type NamedStyleDeclaration =
  | { kind: "text"; style: NamedTextStyleDeclaration }
  | { kind: "frame"; style: NamedFrameStyleDeclaration };
export type ThemeDeclaration = StableDeclaration & {
  namedStyles: Readonly<Record<string, NamedStyleDeclaration>>;
  tokens: Readonly<Record<string, ThemeTokenDeclaration>>;
};

export type ComponentManifestMembers = {
  actions: Readonly<Record<string, ActionDeclaration>>;
  outputs: Readonly<Record<string, OutputDeclaration>>;
  parts: Readonly<Record<string, PartDeclaration>>;
  props: Readonly<Record<string, PropDeclaration>>;
  slots: Readonly<Record<string, SlotDeclaration>>;
  states: Readonly<Record<string, StateDeclaration>>;
  variants: Readonly<Record<string, VariantDeclaration>>;
};
export type OpaqueSemanticTarget = {
  bindingKey?: string;
  id: string;
  kind: "node" | "timeline" | "variable" | "media";
};
export type OpaqueSurfaceSemanticAdapter = {
  baseSemanticTree: SurfaceDeclaration["baseSemanticTree"];
  bindingKey: string;
  id: string;
  initialStateId: string;
  interactions: SurfaceDeclaration["interactions"];
  states: SurfaceDeclaration["states"];
};
export type OpaqueSemantics = {
  surfaces: ReadonlyArray<OpaqueSurfaceSemanticAdapter>;
  targets: ReadonlyArray<OpaqueSemanticTarget>;
};
export type ComponentManifest = ComponentManifestMembers & {
  componentId: string;
  source?: SourceMetadata;
  version: number;
} & (
    | {
        authoring: { mode: "structured"; structure: string };
        renderers: ReadonlyArray<string>;
      }
    | {
        authoring: { mode: "opaque" };
        renderers: Readonly<Record<string, { bindingKeys: ReadonlyArray<string>; entry: string }>>;
        semantics: OpaqueSemantics;
      }
  );

export type VariantStyleOverride =
  | { style: FrameStyleDeclaration; targetId: string; targetKind: "frame" }
  | { style: TextStyleDeclaration; targetId: string; targetKind: "text" };
type ComponentStructureBase = StableDeclaration & {
  componentId: string;
  partBindings: Readonly<Record<string, string>>;
  timelines: ReadonlyArray<ComponentTimelineDeclaration>;
  variantStyles: Readonly<
    Record<string, Readonly<Record<string, ReadonlyArray<VariantStyleOverride>>>>
  >;
};
export type ComponentTimelineDeclaration = StableDeclaration & {
  durationMilliseconds: number;
  tracks: ReadonlyArray<{
    keyframes: readonly {
      timeMilliseconds: number;
      value: number | readonly [number, number, number] | readonly [number, number, number, number];
      easingToNext?: "linear" | "cubicIn" | "cubicOut" | "cubicInOut";
    }[];
    target: {
      kind: "host";
      property: "opacity" | "transform.position" | "transform.rotation" | "transform.scale";
    };
  }>;
};
export type ComponentStructure = ComponentStructureBase &
  (
    | { baseSemanticTree?: never; root: SurfaceDeclaration }
    | { baseSemanticTree: BaseSemanticTreeDeclaration; root: FrameDeclaration }
  );

export type ComponentActionInvocation = {
  actionId: string;
  arguments: Readonly<Record<string, ActionValue>>;
  componentInstanceId: string;
  kind: "component.action";
};
export type ComponentOutputReference = {
  componentInstanceId: string;
  kind: "component.output";
  outputId: string;
};
export type CueTrigger = { event: string; kind: "event" } | ComponentOutputReference;
export type CueGuard =
  | { guards: ReadonlyArray<CueGuard>; kind: "all" }
  | { guards: ReadonlyArray<CueGuard>; kind: "any" }
  | { guard: CueGuard; kind: "not" }
  | {
      kind: "compare";
      left:
        | { kind: "variable"; variableId: string }
        | { field: string; kind: "eventPayload" }
        | { kind: "surfaceState"; surfaceId: string }
        | { field: "active" | "visible" | "opacity"; kind: "nodeField"; nodeId: string };
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: Scalar;
    };
export type CueNext =
  | { kind: "stay" | "end" }
  | { kind: "step"; stepId: string }
  | { groupId: string; kind: "group" };
export type CueDeclaration = StableDeclaration & {
  actions: ReadonlyArray<ComponentActionInvocation>;
  firePolicy?: { kind: "oncePerStepEntry" } | { cooldownMilliseconds: number; kind: "repeatable" };
  guard?: CueGuard;
  next?: CueNext;
  order?: number;
  priority?: number;
  toGroupId?: string;
  toStepId?: string;
  trigger: CueTrigger;
};
export type FlowStepDeclaration = StableDeclaration & { cues: ReadonlyArray<CueDeclaration> };
export type FlowGroupDeclaration = StableDeclaration & {
  initialStepId: string;
  steps: Readonly<Record<string, FlowStepDeclaration>>;
};
export type VariableDeclaration =
  | (StableDeclaration & { initialValue: null; owner: ResourceOwner; type: "null" })
  | (StableDeclaration & { initialValue: boolean; owner: ResourceOwner; type: "boolean" })
  | (StableDeclaration & { initialValue: number; owner: ResourceOwner; type: "number" })
  | (StableDeclaration & { initialValue: string; owner: ResourceOwner; type: "string" });
export type FlowDeclaration = {
  groups: Readonly<Record<string, FlowGroupDeclaration>>;
  initialGroupId: string;
  variables: Readonly<Record<string, VariableDeclaration>>;
};
export type PresentationDeclaration = StableDeclaration & {
  assets: ReadonlyArray<AssetReference>;
  flow: FlowDeclaration;
  metadata: { title: string };
  operations: ReadonlyArray<DetachDeclaration>;
  scene: {
    components: readonly ComponentInstanceDeclaration[];
    spatial: readonly SpatialDeclaration[];
  };
  stage: StageDeclaration;
  theme?: { themeId: string };
};
