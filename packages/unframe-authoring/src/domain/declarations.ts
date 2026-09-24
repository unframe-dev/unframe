import type { Diagnostic } from "@unframe/unframe-core";

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

type RequiredProp = { required: true; default?: never };
type DefaultProp<T> = { required?: never; default: T };
export type StringPropDeclaration = { kind: "string" } & (RequiredProp | DefaultProp<string>);
export type NumberPropDeclaration = { kind: "number" } & (RequiredProp | DefaultProp<number>);
export type BooleanPropDeclaration = { kind: "boolean" } & (RequiredProp | DefaultProp<boolean>);
export type PropDeclaration =
  | StringPropDeclaration
  | NumberPropDeclaration
  | BooleanPropDeclaration;
export type PropReference<T extends "string" | "number" | "boolean"> = {
  kind: "prop-ref";
  propId: string;
  expectedType: T;
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

export type TokenCategory =
  | "color"
  | "logicalLength"
  | "spatialLength"
  | "fontFace"
  | "duration"
  | "easing";
export type TokenReference<C extends TokenCategory = TokenCategory> = {
  kind: "token-ref";
  category: C;
  tokenId: string;
};
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
  x: NumberValueDeclaration;
  y: NumberValueDeclaration;
  width: NumberValueDeclaration;
  height: NumberValueDeclaration;
};
export type ConcreteAbsoluteLayoutDeclaration = {
  kind: "absolute";
  x: number;
  y: number;
  width: number;
  height: number;
};

type SemanticNodeBase = StableDeclaration & {
  parentId: string | null;
  order: number;
};
type SemanticText = { text: StringValueDeclaration; language?: string };
export type SemanticNodeDeclaration = SemanticNodeBase &
  (
    | ({ role: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 } & SemanticText)
    | ({ role: "paragraph" } & SemanticText)
    | { role: "image"; alt: string; language?: string }
    | ({ role: "button"; interactionId: string } & SemanticText)
    | { role: "list"; ordered: boolean }
    | ({ role: "listItem" } & SemanticText)
    | { role: "table"; label?: string; language?: string }
    | { role: "row" }
    | ({ role: "cell" } & SemanticText)
    | ({ role: "columnHeader" } & SemanticText)
    | ({ role: "rowHeader" } & SemanticText)
  );
export type InteractionDeclaration = StableDeclaration & {
  kind: "click";
  event: string;
  hitPriority: number;
};
type CommonContentOverrideDeclaration = {
  visible?: BooleanValueDeclaration;
  opacity?: NumberValueDeclaration;
  placement?: AbsoluteLayoutDeclaration;
};
export type ContentOverrideDeclaration = CommonContentOverrideDeclaration &
  (
    | {
        kind: "frame";
        layout?: { kind: "absolute" };
        backgroundColor?: ColorValueDeclaration;
        border?: BorderDeclaration;
        clip?: BooleanValueDeclaration;
      }
    | { kind: "text"; value?: StringValueDeclaration; style?: TextStyleDeclaration }
  );
export type SemanticOverrideDeclaration = StableDeclaration & {
  kind: "semantic-override";
  targetId: string;
  included?: boolean;
  text?: string | null;
  language?: string | null;
  alt?: string | null;
  label?: string | null;
};
export type SurfaceStateDeclaration = StableDeclaration & {
  contentOverrides?: Readonly<Record<string, ContentOverrideDeclaration>>;
  semanticOverrides: readonly SemanticOverrideDeclaration[];
  enabledInteractionIds: readonly string[];
};

export type ConcreteSrgbaColorDeclaration = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};
export type SrgbaColorDeclaration = {
  red: NumberValueDeclaration;
  green: NumberValueDeclaration;
  blue: NumberValueDeclaration;
  alpha: NumberValueDeclaration;
};
export type FontReference = AssetReference | TokenReference<"fontFace">;
export type ColorValueDeclaration = SrgbaColorDeclaration | TokenReference<"color">;
export type LogicalLengthValueDeclaration =
  | NumberValueDeclaration
  | TokenReference<"logicalLength">;
export type BorderDeclaration = {
  color: ColorValueDeclaration;
  width: LogicalLengthValueDeclaration;
  radius: LogicalLengthValueDeclaration;
};
export type TextStyleDeclaration = {
  font?: FontReference;
  fallbackFonts?: readonly FontReference[];
  fontSize?: LogicalLengthValueDeclaration;
  lineHeight?: LogicalLengthValueDeclaration;
  color?: ColorValueDeclaration;
  weight?: "regular" | "bold" | PropReference<"string">;
  align?: "start" | "center" | "end" | PropReference<"string">;
  overflow?: "clip" | "ellipsis" | PropReference<"string">;
};
export type FrameStyleDeclaration = {
  backgroundColor?: ColorValueDeclaration;
  border?: BorderDeclaration;
  clip?: BooleanValueDeclaration;
};
type CommonPrimitiveDeclaration = {
  visible?: BooleanValueDeclaration;
  opacity?: NumberValueDeclaration;
  semanticNodeId?: string;
};

export type FrameDeclaration = StableDeclaration &
  CommonPrimitiveDeclaration & {
    kind: "frame";
    layout: AbsoluteLayoutDeclaration;
    children: readonly ContentNodeDeclaration[];
    style?: FrameStyleDeclaration;
    namedStyle?: NamedStyleReference;
  };
export type SlotPlaceholderDeclaration = StableDeclaration & {
  kind: "slot-placeholder";
  slotId: string;
  semanticParentId?: string;
};
export type TextDeclaration = StableDeclaration &
  CommonPrimitiveDeclaration & {
    kind: "text";
    value: StringValueDeclaration;
    layout: AbsoluteLayoutDeclaration;
    maxCodePoints: NumberValueDeclaration;
    style?: TextStyleDeclaration;
    namedStyle?: NamedStyleReference;
  };
export type SurfaceDeclaration = StableDeclaration & {
  kind: "surface";
  physicalSizeMeters: readonly [NumberValueDeclaration, NumberValueDeclaration];
  logicalSize: readonly [NumberValueDeclaration, NumberValueDeclaration];
  fit: "contain" | "cover" | "stretch";
  root: FrameDeclaration;
  baseSemanticTree: BaseSemanticTreeDeclaration;
  interactions: Readonly<Record<string, InteractionDeclaration>>;
  initialStateId: string;
  states: Readonly<Record<string, SurfaceStateDeclaration>>;
  renderIntent: {
    updateModel: "static" | "finite-state";
    interaction: "none" | "regions";
    internalAnimation: "none";
    rendererPreference: "baked-web";
    fallbackPolicy: "reject";
  };
};
export type ContentNodeDeclaration =
  | FrameDeclaration
  | TextDeclaration
  | SlotPlaceholderDeclaration;
export type StructureRootDeclaration = SurfaceDeclaration | FrameDeclaration;

export type BaseSemanticTreeDeclaration = {
  rootNodeIds: readonly string[];
  nodes: Readonly<Record<string, SemanticNodeDeclaration>>;
};
export type ConcreteColorValueDeclaration = ConcreteSrgbaColorDeclaration | TokenReference<"color">;
export type ConcreteLogicalLengthValueDeclaration = number | TokenReference<"logicalLength">;
export type NamedBorderDeclaration = {
  color: ConcreteColorValueDeclaration;
  width: ConcreteLogicalLengthValueDeclaration;
  radius: ConcreteLogicalLengthValueDeclaration;
};
export type NamedTextStyleDeclaration = {
  font?: FontReference;
  fallbackFonts?: readonly FontReference[];
  fontSize?: ConcreteLogicalLengthValueDeclaration;
  lineHeight?: ConcreteLogicalLengthValueDeclaration;
  color?: ConcreteColorValueDeclaration;
  weight?: "regular" | "bold";
  align?: "start" | "center" | "end";
  overflow?: "clip" | "ellipsis";
};
export type NamedFrameStyleDeclaration = {
  backgroundColor?: ConcreteColorValueDeclaration;
  border?: NamedBorderDeclaration;
  clip?: boolean;
};
export type PartOverrideDeclaration =
  | {
      partId: string;
      targetKind: "frame";
      placement?: ConcreteAbsoluteLayoutDeclaration;
      style?: NamedFrameStyleDeclaration;
    }
  | {
      partId: string;
      targetKind: "text";
      content?: string;
      placement?: ConcreteAbsoluteLayoutDeclaration;
      style?: NamedTextStyleDeclaration;
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
  spatialNodeId?: string;
  props: Readonly<Record<string, string | number | boolean>>;
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
  tokens: Readonly<Record<string, ThemeTokenDeclaration>>;
  namedStyles: Readonly<Record<string, NamedStyleDeclaration>>;
};

export type ComponentManifestMembers = {
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

export type VariantStyleOverride =
  | { targetId: string; targetKind: "frame"; style: FrameStyleDeclaration }
  | { targetId: string; targetKind: "text"; style: TextStyleDeclaration };
type ComponentStructureBase = StableDeclaration & {
  componentId: string;
  partBindings: Readonly<Record<string, string>>;
  variantStyles: Readonly<
    Record<string, Readonly<Record<string, readonly VariantStyleOverride[]>>>
  >;
  timelines: readonly StableDeclaration[];
};
export type ComponentStructure = ComponentStructureBase &
  (
    | { root: SurfaceDeclaration; baseSemanticTree?: never }
    | { root: FrameDeclaration; baseSemanticTree: BaseSemanticTreeDeclaration }
  );

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
