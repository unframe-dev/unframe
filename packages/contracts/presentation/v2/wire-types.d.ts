// Generated from packages/contracts/proto; run pnpm generate:wire-types.

export interface ArtifactStateBindingWire {
  artifactId?: string;
}

export interface AssetAccessBindingWire {
  assetId?: string;
  checksum?: string;
  mediaType?: string;
  encodedSizeBytes?: string;
  url?: string;
  expiresAtUnixMs?: string;
}

export interface BakedWebArtifactWire {
  artifactId?: string;
  contractVersion?: number;
  requiredFeatures?: number[];
  states?: BakedWebStateTextureWire[];
}

export interface BakedWebStateTextureWire {
  stateId?: string;
  texture?: TextureArtifactWire;
}

export interface BooleanVariableTextWire {
  variableId?: string;
  trueLabel?: string;
  falseLabel?: string;
}

export interface CapabilityLimitsWire {
  texture?: TextureLimitsWire;
  nativeUi?: NativeUiLimitsWire;
  video?: VideoLimitsWire;
  model?: ModelLimitsWire;
}

export interface CapabilityProfileWire {
  schemaVersion?: number;
  capabilityProfileId?: string;
  contractVersions?: ContractVersionsWire;
  renderers?: RendererCapabilitiesWire;
  model?: ModelCapabilityWire;
  limits?: CapabilityLimitsWire;
  localOverlaySupported?: boolean;
}

export interface CodePointRangeWire {
  first?: number;
  last?: number;
}

export interface ContractVersionsWire {
  delivery?: number;
  runtime?: number;
  progression?: number;
  projection?: number;
}

export interface DeliveredArtifactWireFields {}
export type DeliveredArtifactWire_artifact =
  | { bakedWeb: BakedWebArtifactWire; nativeUi?: never; video?: never }
  | { nativeUi: NativeUiArtifactWire; bakedWeb?: never; video?: never }
  | { video: VideoArtifactWire; bakedWeb?: never; nativeUi?: never };
export type DeliveredArtifactWire = DeliveredArtifactWireFields & DeliveredArtifactWire_artifact;

export interface DeliveredRenderSurfaceWire {
  renderSurfaceId?: string;
  semanticSurfaceId?: string;
  logicalBounds?: LogicalBoundsWire;
  layer?: number;
  rendererKind?: number;
  artifactContractVersion?: number;
  stateBindings?: DeliveredStateBindingWire[];
  artifacts?: DeliveredArtifactWire[];
}

export interface DeliveredStateBindingWireFields {
  stateId?: string;
}
export type DeliveredStateBindingWire_binding =
  | { empty: EmptyStateBindingWire; artifact?: never }
  | { artifact: ArtifactStateBindingWire; empty?: never };
export type DeliveredStateBindingWire = DeliveredStateBindingWireFields &
  DeliveredStateBindingWire_binding;

export interface DeliveryManifestWire {
  schemaVersion?: number;
  deliveryContractVersion?: number;
  sessionId?: string;
  publication?: PublicationFenceWire;
  definitionHash?: string;
  renderBundleHash?: string;
  assetSetHash?: string;
  capabilityProfile?: CapabilityProfileWire;
  projectionProfile?: ProjectionProfileDescriptorWire;
  projectionInstance?: ProjectionInstanceWire;
  assetAccess?: AssetAccessBindingWire[];
  residency?: ResidencyPlanWire;
}

export interface EmptyStateBindingWire {}

export interface FontFaceWire {
  assetId?: string;
  supportedCodePointRanges?: CodePointRangeWire[];
}

export interface GlyphResidencyKeyWire {
  fontChecksum?: string;
  unicodeScalar?: number;
}

export interface InteractiveRegionWire {
  interactionId?: string;
  semanticNodeId?: string;
  normalizedBounds?: LogicalBoundsWire;
  priority?: number;
}

export interface LiteralTextWire {
  value?: string;
}

export interface LocalOverlayDefinitionWire {
  overlayId?: string;
  selfAnchor?: number;
  transform?: TransformWire;
  renderSurfaceIds?: string[];
}

export interface LogicalBoundsWire {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ModelCapabilityWire {
  supported?: boolean;
  contractVersion?: number;
  formats?: number[];
  features?: number[];
}

export interface ModelLimitsWire {
  tierId?: string;
  maxAssets?: string;
  maxInstances?: string;
  maxEncodedBytes?: string;
  maxNodes?: string;
  maxPrimitives?: string;
  maxVertices?: string;
  maxTriangles?: string;
  maxBonesPerSkin?: string;
  maxMorphTargetsPerPrimitive?: string;
  maxAnimationClipsPerAsset?: string;
}

export interface ModelResidencyBindingWire {
  assetId?: string;
  checksum?: string;
  encodedSizeBytes?: string;
  format?: number;
  requiredFeatures?: number[];
  nodeCount?: string;
  primitiveCount?: string;
  vertexCount?: string;
  triangleCount?: string;
  maximumBonesPerSkin?: string;
  maximumMorphTargetsPerPrimitive?: string;
  animationClipCount?: string;
}

export interface ModelResidencyPlanWire {
  budgetTierId?: string;
  models?: ModelResidencyBindingWire[];
  totalEncodedBytes?: string;
  totalVertices?: string;
  totalTriangles?: string;
  modelInstanceCount?: string;
  totalNodes?: string;
  totalPrimitives?: string;
}

export interface NativeTextValueWireFields {}
export type NativeTextValueWire_source =
  | {
      literal: LiteralTextWire;
      stringVariable?: never;
      booleanVariable?: never;
      numberVariable?: never;
      stepTimer?: never;
    }
  | {
      stringVariable: StringVariableTextWire;
      literal?: never;
      booleanVariable?: never;
      numberVariable?: never;
      stepTimer?: never;
    }
  | {
      booleanVariable: BooleanVariableTextWire;
      literal?: never;
      stringVariable?: never;
      numberVariable?: never;
      stepTimer?: never;
    }
  | {
      numberVariable: NumberVariableTextWire;
      literal?: never;
      stringVariable?: never;
      booleanVariable?: never;
      stepTimer?: never;
    }
  | {
      stepTimer: StepTimerTextWire;
      literal?: never;
      stringVariable?: never;
      booleanVariable?: never;
      numberVariable?: never;
    };
export type NativeTextValueWire = NativeTextValueWireFields & NativeTextValueWire_source;

export interface NativeUiArtifactWire {
  artifactId?: string;
  contractVersion?: number;
  requiredFeatures?: number[];
  rootNodeId?: string;
  nodes?: NativeUiNodeWire[];
}

export interface NativeUiCapabilityWire {
  supported?: boolean;
  contractVersion?: number;
  features?: number[];
}

export interface NativeUiGroupWire {
  nodeId?: string;
  bounds?: LogicalBoundsWire;
  clip?: boolean;
  childNodeIds?: string[];
}

export interface NativeUiLimitsWire {
  tierId?: string;
  maxNodesPerArtifact?: string;
  maxTreeDepth?: string;
  maxTextNodesPerArtifact?: string;
  maxCodePointsPerText?: string;
  maxGlyphs?: string;
  maxFontAssets?: string;
}

export interface NativeUiNodeWireFields {}
export type NativeUiNodeWire_node =
  | { group: NativeUiGroupWire; text?: never }
  | { text: NativeUiTextWire; group?: never };
export type NativeUiNodeWire = NativeUiNodeWireFields & NativeUiNodeWire_node;

export interface NativeUiResidencyPlanWire {
  budgetTierId?: string;
  fontAssetIds?: string[];
  maximumNodesPerArtifact?: string;
  maximumTreeDepth?: string;
  maximumTextNodesPerArtifact?: string;
  glyphs?: GlyphResidencyKeyWire[];
  maximumCodePointsPerText?: string;
  fontAssetCount?: string;
}

export interface NativeUiTextWire {
  nodeId?: string;
  bounds?: LogicalBoundsWire;
  semanticNodeId?: string;
  value?: NativeTextValueWire;
  font?: ResolvedFontWire;
  color?: unframe_delivery_v2_SrgbaColorWire;
  fontSize?: number;
  lineHeight?: number;
  align?: number;
  overflow?: number;
  maxCodePoints?: string;
}

export interface NumberVariableTextWire {
  variableId?: string;
  fractionDigits?: number;
}

export interface PixelSizeWire {
  width?: string;
  height?: string;
}

export interface ProjectedSemanticNodeWireFields {
  semanticNodeId?: string;
  order?: number;
  role?: number;
  interactionEnabled?: boolean;
}
export type ProjectedSemanticNodeWire__parentNodeId =
  | { parentNodeId: string }
  | { parentNodeId?: never };
export type ProjectedSemanticNodeWire__text = { text: string } | { text?: never };
export type ProjectedSemanticNodeWire__language = { language: string } | { language?: never };
export type ProjectedSemanticNodeWire__alt = { alt: string } | { alt?: never };
export type ProjectedSemanticNodeWire__label = { label: string } | { label?: never };
export type ProjectedSemanticNodeWire__headingLevel =
  | { headingLevel: number }
  | { headingLevel?: never };
export type ProjectedSemanticNodeWire__ordered = { ordered: boolean } | { ordered?: never };
export type ProjectedSemanticNodeWire__interactionId =
  | { interactionId: string }
  | { interactionId?: never };
export type ProjectedSemanticNodeWire = ProjectedSemanticNodeWireFields &
  ProjectedSemanticNodeWire__parentNodeId &
  ProjectedSemanticNodeWire__text &
  ProjectedSemanticNodeWire__language &
  ProjectedSemanticNodeWire__alt &
  ProjectedSemanticNodeWire__label &
  ProjectedSemanticNodeWire__headingLevel &
  ProjectedSemanticNodeWire__ordered &
  ProjectedSemanticNodeWire__interactionId;

export interface ProjectedSemanticSurfaceWire {
  semanticSurfaceId?: string;
  renderSurfaceIds?: string[];
  states?: SurfaceSemanticStateWire[];
}

export interface ProjectedSemanticTreeWire {
  rootNodeIds?: string[];
  nodes?: ProjectedSemanticNodeWire[];
}

export interface ProjectionProfileDescriptorWire {
  projectionProfileId?: string;
  key?: ProjectionProfileKeyWire;
  visibleNodeIds?: string[];
  visibleSurfaceIds?: string[];
  visibleVariableIds?: string[];
  renderSurfaces?: DeliveredRenderSurfaceWire[];
  semanticSurfaces?: ProjectedSemanticSurfaceWire[];
  localOverlays?: LocalOverlayDefinitionWire[];
  requiredRuntimeCapabilities?: number[];
  runtimeCatalog?: ProjectedRuntimeCatalogWire;
}

export interface ProjectionProfileKeyWire {
  publication?: PublicationFenceWire;
  projectionContractVersion?: number;
  role?: number;
  capabilityProfileId?: string;
}

export interface RendererCapabilitiesWire {
  bakedWeb?: TextureCapabilityWire;
  nativeUi?: NativeUiCapabilityWire;
  video?: VideoCapabilityWire;
}

export interface ResidencyPlanWire {
  textures?: TextureResidencyPlanWire;
  models?: ModelResidencyPlanWire;
  nativeUi?: NativeUiResidencyPlanWire;
  video?: VideoResidencyPlanWire;
  totalSelectedEncodedBytes?: string;
}

export interface ResolvedFontWire {
  primary?: FontFaceWire;
  fallbacks?: FontFaceWire[];
}

export interface unframe_delivery_v2_SrgbaColorWire {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

export interface StepTimerTextWire {
  groupId?: string;
  stepId?: string;
  cueId?: string;
  durationMs?: string;
  whenStepInactive?: number;
  format?: number;
}

export interface StringVariableTextWire {
  variableId?: string;
  allowedCodePointRanges?: CodePointRangeWire[];
}

export interface SurfaceSemanticStateWire {
  stateId?: string;
  semanticTree?: ProjectedSemanticTreeWire;
  interactiveRegions?: InteractiveRegionWire[];
}

export interface TextureArtifactWire {
  assetId?: string;
  checksum?: string;
  encodedSizeBytes?: string;
  pixelSize?: PixelSizeWire;
  alphaMode?: number;
  mipCount?: number;
  decodedGpuBytes?: string;
}

export interface TextureCapabilityWire {
  supported?: boolean;
  contractVersion?: number;
  features?: number[];
}

export interface TextureLimitsWire {
  tierId?: string;
  maxTextureWidth?: string;
  maxTextureHeight?: string;
  maxTexturePixels?: string;
  maxTextureBindings?: string;
  maxGpuBytes?: string;
  maxSerialLoadCpuBytes?: string;
  maxEncodedCacheBytes?: string;
  encodedCacheReserveBytes?: string;
}

export interface TextureResidencyBindingWire {
  assetId?: string;
  checksum?: string;
  pixelSize?: PixelSizeWire;
  decodedGpuBytes?: string;
  peakLoadCpuBytes?: string;
}

export interface TextureResidencyPlanWire {
  budgetTierId?: string;
  textures?: TextureResidencyBindingWire[];
  totalDecodedGpuBytes?: string;
  maximumPeakLoadCpuBytes?: string;
}

export interface VideoArtifactWire {
  artifactId?: string;
  contractVersion?: number;
  requiredFeatures?: number[];
  videoAssetId?: string;
  checksum?: string;
  pixelSize?: PixelSizeWire;
  durationMs?: string;
  loop?: boolean;
  hasAudio?: boolean;
  encodedSizeBytes?: string;
  codec?: number;
  hasAlpha?: boolean;
}

export interface VideoCapabilityWire {
  supported?: boolean;
  contractVersion?: number;
  features?: number[];
}

export interface VideoLimitsWire {
  tierId?: string;
  maxWidth?: string;
  maxHeight?: string;
  maxPixels?: string;
  maxConcurrentDecoders?: string;
  maxEncodedBytes?: string;
  maxDecodedFrameBytes?: string;
}

export interface VideoResidencyBindingWire {
  assetId?: string;
  checksum?: string;
  encodedSizeBytes?: string;
  decodedFrameBytes?: string;
}

export interface VideoResidencyPlanWire {
  budgetTierId?: string;
  videos?: VideoResidencyBindingWire[];
  totalEncodedBytes?: string;
  maximumConcurrentDecoders?: string;
  maximumDecodedFrameBytes?: string;
}

export interface BoxGeometryWire {
  size?: Vector3Wire;
}

export interface ContainerNodeWire {}

export interface DirectionalLightWire {
  color?: SrgbColorWire;
  intensityLux?: number;
  castsShadows?: boolean;
}

export interface GroupResourceOwnerWire {
  groupId?: string;
}

export interface GroupRunOwnerWire {
  groupId?: string;
  groupEntryEpoch?: string;
}

export interface LightNodeWireFields {}
export type LightNodeWire_light =
  | { directional: DirectionalLightWire; point?: never; spot?: never }
  | { point: PointLightWire; directional?: never; spot?: never }
  | { spot: SpotLightWire; directional?: never; point?: never };
export type LightNodeWire = LightNodeWireFields & LightNodeWire_light;

export interface ModelNodeWire {
  modelAssetId?: string;
}

export interface NodeParentWire {
  nodeId?: string;
}

export interface NullScalarWire {}

export interface NumberKeyframeValueWire {
  value?: number;
}

export interface PointLightWire {
  color?: SrgbColorWire;
  intensityCandela?: number;
  rangeMeters?: number;
  castsShadows?: boolean;
}

export interface PoseWire {
  position?: Vector3Wire;
  rotation?: QuaternionWire;
}

export interface PresentationResourceOwnerWire {}

export interface PresentationRunOwnerWire {}

export interface PresenterAnchorParentWire {
  target?: number;
  followPosition?: boolean;
  followRotation?: boolean;
}

export interface ProjectedModelClipDefinitionWire {
  modelNodeId?: string;
  modelAssetId?: string;
  clipId?: string;
  sourceAnimationIndex?: number;
  durationMs?: string;
  owner?: ResourceOwnerWire;
}

export interface ProjectedNodeDefinitionWireFields {
  nodeId?: string;
  parent?: SpatialParentWire;
  order?: number;
  owner?: ResourceOwnerWire;
}
export type ProjectedNodeDefinitionWire_node =
  | { container: ContainerNodeWire; surface?: never; model?: never; shape?: never; light?: never }
  | { surface: SurfaceNodeWire; container?: never; model?: never; shape?: never; light?: never }
  | { model: ModelNodeWire; container?: never; surface?: never; shape?: never; light?: never }
  | { shape: ShapeNodeWire; container?: never; surface?: never; model?: never; light?: never }
  | { light: LightNodeWire; container?: never; surface?: never; model?: never; shape?: never };
export type ProjectedNodeDefinitionWire = ProjectedNodeDefinitionWireFields &
  ProjectedNodeDefinitionWire_node;

export interface ProjectedRuntimeCatalogWire {
  catalogContractVersion?: number;
  nodes?: ProjectedNodeDefinitionWire[];
  surfaces?: ProjectedSurfaceDefinitionWire[];
  variables?: ProjectedVariableDefinitionWire[];
  timelines?: ProjectedTimelineDefinitionWire[];
  modelClips?: ProjectedModelClipDefinitionWire[];
}

export interface ProjectedSurfaceDefinitionWire {
  surfaceId?: string;
  hostNodeId?: string;
  reachableStateIds?: string[];
  hasVideo?: boolean;
  physicalSizeMeters?: Vector2Wire;
  logicalSize?: Vector2Wire;
  fit?: number;
  owner?: ResourceOwnerWire;
}

export interface ProjectedTimelineDefinitionWire {
  timelineId?: string;
  durationMs?: string;
  tracks?: ProjectedTimelineTrackWire[];
  owner?: ResourceOwnerWire;
}

export interface ProjectedTimelineTrackWire {
  target?: TimelineTrackTargetWire;
  keyframes?: TimelineKeyframeWire[];
}

export interface ProjectedVariableDefinitionWire {
  variableId?: string;
  type?: number;
  owner?: ResourceOwnerWire;
}

export interface ProjectionInstanceWire {
  projectionProfileId?: string;
  participantId?: string;
  assignmentEpoch?: string;
}

export interface PublicationFenceWire {
  presentationId?: string;
  publicationEpoch?: string;
  publicationManifestHash?: string;
}

export interface QuaternionWire {
  x?: number;
  y?: number;
  z?: number;
  w?: number;
}

export interface QuaternionKeyframeValueWire {
  value?: QuaternionWire;
}

export interface ResourceOwnerWireFields {}
export type ResourceOwnerWire_scope =
  | { presentation: PresentationResourceOwnerWire; group?: never }
  | { group: GroupResourceOwnerWire; presentation?: never };
export type ResourceOwnerWire = ResourceOwnerWireFields & ResourceOwnerWire_scope;

export interface RuntimeProjectionFenceWire {
  sessionId?: string;
  publication?: PublicationFenceWire;
  assignmentEpoch?: string;
  projectionProfileId?: string;
  presentationOriginVersion?: string;
}

export interface RuntimeRunCauseWire {
  cueId?: string;
  causeEventId?: string;
  groupId?: string;
  groupEntryEpoch?: string;
  stepId?: string;
  stepEntryEpoch?: string;
}

export interface RuntimeRunIdWire {
  assignmentEpoch?: string;
  runSequence?: string;
}

export interface RuntimeRunOwnerWireFields {}
export type RuntimeRunOwnerWire_scope =
  | { presentation: PresentationRunOwnerWire; group?: never }
  | { group: GroupRunOwnerWire; presentation?: never };
export type RuntimeRunOwnerWire = RuntimeRunOwnerWireFields & RuntimeRunOwnerWire_scope;

export interface ScalarValueWireFields {}
export type ScalarValueWire_value =
  | { stringValue: string; numberValue?: never; booleanValue?: never; nullValue?: never }
  | { numberValue: number; stringValue?: never; booleanValue?: never; nullValue?: never }
  | { booleanValue: boolean; stringValue?: never; numberValue?: never; nullValue?: never }
  | { nullValue: NullScalarWire; stringValue?: never; numberValue?: never; booleanValue?: never };
export type ScalarValueWire = ScalarValueWireFields & ScalarValueWire_value;

export interface ShapeNodeWireFields {
  material?: UnlitShapeMaterialWire;
}
export type ShapeNodeWire_geometry =
  | { box: BoxGeometryWire; sphere?: never }
  | { sphere: SphereGeometryWire; box?: never };
export type ShapeNodeWire = ShapeNodeWireFields & ShapeNodeWire_geometry;

export interface SpatialParentWireFields {}
export type SpatialParentWire_parent =
  | { stage: StageParentWire; node?: never; presenterAnchor?: never }
  | { node: NodeParentWire; stage?: never; presenterAnchor?: never }
  | { presenterAnchor: PresenterAnchorParentWire; stage?: never; node?: never };
export type SpatialParentWire = SpatialParentWireFields & SpatialParentWire_parent;

export interface SphereGeometryWire {
  radius?: number;
}

export interface SpotLightWire {
  color?: SrgbColorWire;
  intensityCandela?: number;
  rangeMeters?: number;
  outerAngleDegrees?: number;
  innerAngleDegrees?: number;
  castsShadows?: boolean;
}

export interface unframe_presentation_v2_SrgbaColorWire {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

export interface SrgbColorWire {
  red?: number;
  green?: number;
  blue?: number;
}

export interface StageParentWire {}

export interface SurfaceNodeWire {
  semanticSurfaceId?: string;
}

export interface TimelineKeyframeWireFields {
  timeMs?: string;
}
export type TimelineKeyframeWire_value =
  | { number: NumberKeyframeValueWire; vector3?: never; quaternion?: never }
  | { vector3: Vector3KeyframeValueWire; number?: never; quaternion?: never }
  | { quaternion: QuaternionKeyframeValueWire; number?: never; vector3?: never };
export type TimelineKeyframeWire__easingToNext =
  | { easingToNext: number }
  | { easingToNext?: never };
export type TimelineKeyframeWire = TimelineKeyframeWireFields &
  TimelineKeyframeWire_value &
  TimelineKeyframeWire__easingToNext;

export interface TimelineTrackTargetWire {
  nodeId?: string;
  property?: number;
}

export interface TransformWire {
  position?: Vector3Wire;
  rotation?: QuaternionWire;
  scale?: Vector3Wire;
}

export interface UnlitShapeMaterialWire {
  color?: unframe_presentation_v2_SrgbaColorWire;
  doubleSided?: boolean;
  castsShadows?: boolean;
  receivesShadows?: boolean;
}

export interface Vector2Wire {
  x?: number;
  y?: number;
}

export interface Vector3Wire {
  x?: number;
  y?: number;
  z?: number;
}

export interface Vector3KeyframeValueWire {
  value?: Vector3Wire;
}

export interface AnchorBindingUnavailableWire {}

export interface ArmedTimerWire {
  cueId?: string;
  deadlineRuntimeTimeMs?: string;
  fired?: boolean;
}

export interface BlendHeldPoseWire {
  from?: ClipHeldPoseWire;
  to?: ClipHeldPoseWire;
  toWeight?: number;
}

export interface CanonicalRuntimeSnapshotWire {
  schemaVersion?: number;
  reliableSequence?: string;
  lastIngressSequence?: string;
  lastAllocatedRunSequence?: string;
  clock?: RuntimeClockSnapshotWire;
  progression?: ProgressionRuntimeStateWire;
  stepExecution?: StepExecutionSnapshotWire;
  surfaceStates?: SurfaceRuntimeStateWire[];
  nodeStates?: NodeRuntimeStateWire[];
  mediaStates?: MediaRuntimeStateWire[];
  variables?: VariableStateWire[];
  activeRuns?: RuntimeRunSnapshotWire[];
  presentationOrigin?: PresentationOriginWire;
  recentEventIds?: string[];
  modelClipStates?: ModelClipRuntimeStateWire[];
}

export interface ClipHeldPoseWire {
  clipId?: string;
  positionMs?: number;
}

export interface ClipPlaybackWire {
  clipId?: string;
  playback?: PlaybackClockWire;
  speed?: number;
  loop?: boolean;
}

export interface CommandAcceptedWireFields {
  canonicalEventId?: string;
  reliableSequence?: string;
}
export type CommandAcceptedWire_cueEvaluation =
  | { cueNotSelected: CueNotSelectedWire; cueCommitted?: never; cueBatchRejected?: never }
  | { cueCommitted: CueCommittedWire; cueNotSelected?: never; cueBatchRejected?: never }
  | { cueBatchRejected: CueBatchRejectedWire; cueNotSelected?: never; cueCommitted?: never }
  | { cueNotSelected?: never; cueCommitted?: never; cueBatchRejected?: never };
export type CommandAcceptedWire = CommandAcceptedWireFields & CommandAcceptedWire_cueEvaluation;

export interface CommandNoOpWire {
  reason?: number;
}

export interface CommandOutcomeWireFields {
  clientEventId?: string;
}
export type CommandOutcomeWire_result =
  | { accepted: CommandAcceptedWire; rejected?: never; noOp?: never }
  | { rejected: CommandRejectedWire; accepted?: never; noOp?: never }
  | { noOp: CommandNoOpWire; accepted?: never; rejected?: never };
export type CommandOutcomeWire = CommandOutcomeWireFields & CommandOutcomeWire_result;

export interface CommandRejectedWire {
  reason?: number;
}

export interface ConnectionSnapshotEnvelopeWire {
  schemaVersion?: number;
  connectionId?: string;
  fence?: RuntimeProjectionFenceWire;
  projectionInstance?: ProjectionInstanceWire;
  presenceAtCut?: ProjectedPresenceStateWire;
  reliableSequence?: string;
  snapshot?: ProjectedRuntimeSnapshotWire;
}

export interface ControlClientItemWireFields {}
export type ControlClientItemWire_item =
  | {
      handshake: ControlHandshakeWire;
      replayRequest?: never;
      stateReady?: never;
      logicalInput?: never;
      surfaceInteraction?: never;
      runtimeControl?: never;
    }
  | {
      replayRequest: ReplayRequestWire;
      handshake?: never;
      stateReady?: never;
      logicalInput?: never;
      surfaceInteraction?: never;
      runtimeControl?: never;
    }
  | {
      stateReady: StateReadyWire;
      handshake?: never;
      replayRequest?: never;
      logicalInput?: never;
      surfaceInteraction?: never;
      runtimeControl?: never;
    }
  | {
      logicalInput: LogicalInputCommandWire;
      handshake?: never;
      replayRequest?: never;
      stateReady?: never;
      surfaceInteraction?: never;
      runtimeControl?: never;
    }
  | {
      surfaceInteraction: SurfaceInteractionCommandWire;
      handshake?: never;
      replayRequest?: never;
      stateReady?: never;
      logicalInput?: never;
      runtimeControl?: never;
    }
  | {
      runtimeControl: RuntimeControlCommandWire;
      handshake?: never;
      replayRequest?: never;
      stateReady?: never;
      logicalInput?: never;
      surfaceInteraction?: never;
    };
export type ControlClientItemWire = ControlClientItemWireFields & ControlClientItemWire_item;

export interface ControlConnectedWire {
  protocolVersion?: string;
  progressionContractVersion?: number;
  requiredCapabilities?: number[];
  connectionId?: string;
  projectionInstance?: ProjectionInstanceWire;
  limits?: RuntimeProtocolLimitsWire;
}

export interface ControlHandshakeWireFields {
  protocolVersion?: string;
  progressionContractVersion?: number;
  supportedCapabilities?: number[];
}
export type ControlHandshakeWire__resume = { resume: ResumeCursorWire } | { resume?: never };
export type ControlHandshakeWire = ControlHandshakeWireFields & ControlHandshakeWire__resume;

export interface ControlServerItemWireFields {}
export type ControlServerItemWire_item =
  | {
      connected: ControlConnectedWire;
      connectionSnapshot?: never;
      reliableEvent?: never;
      projectionAdvance?: never;
      commandOutcome?: never;
      stateConnectionNonce?: never;
      resyncRequired?: never;
    }
  | {
      connectionSnapshot: ConnectionSnapshotEnvelopeWire;
      connected?: never;
      reliableEvent?: never;
      projectionAdvance?: never;
      commandOutcome?: never;
      stateConnectionNonce?: never;
      resyncRequired?: never;
    }
  | {
      reliableEvent: ProjectedReliableEventWire;
      connected?: never;
      connectionSnapshot?: never;
      projectionAdvance?: never;
      commandOutcome?: never;
      stateConnectionNonce?: never;
      resyncRequired?: never;
    }
  | {
      projectionAdvance: ProjectionAdvanceWire;
      connected?: never;
      connectionSnapshot?: never;
      reliableEvent?: never;
      commandOutcome?: never;
      stateConnectionNonce?: never;
      resyncRequired?: never;
    }
  | {
      commandOutcome: CommandOutcomeWire;
      connected?: never;
      connectionSnapshot?: never;
      reliableEvent?: never;
      projectionAdvance?: never;
      stateConnectionNonce?: never;
      resyncRequired?: never;
    }
  | {
      stateConnectionNonce: StateConnectionNonceWire;
      connected?: never;
      connectionSnapshot?: never;
      reliableEvent?: never;
      projectionAdvance?: never;
      commandOutcome?: never;
      resyncRequired?: never;
    }
  | {
      resyncRequired: ResyncRequiredWire;
      connected?: never;
      connectionSnapshot?: never;
      reliableEvent?: never;
      projectionAdvance?: never;
      commandOutcome?: never;
      stateConnectionNonce?: never;
    };
export type ControlServerItemWire = ControlServerItemWireFields & ControlServerItemWire_item;

export interface CueAcceptedWire {
  groupId?: string;
  stepId?: string;
  cueId?: string;
}

export interface CueBatchRejectedWire {
  cueId?: string;
  reason?: number;
}

export interface CueCommittedWire {
  cueId?: string;
}

export interface CueCooldownWire {
  cueId?: string;
  nextEligibleRuntimeTimeMs?: string;
}

export interface CueNotSelectedWire {}

export interface DefaultModelPoseWire {}

export interface DurableCheckpointEnvelopeWire {
  schemaVersion?: number;
  checkpointSequence?: string;
  sessionId?: string;
  runtimeId?: string;
  runtimeKind?: number;
  assignmentEpoch?: string;
  publication?: PublicationFenceWire;
  definitionHash?: string;
  renderBundleHash?: string;
  reliableSequence?: string;
  canonicalSnapshotHash?: string;
  canonicalSnapshotPayload?: Uint8Array;
}

export interface ElementStateFrameWire {
  fence?: RuntimeProjectionFenceWire;
  frameSequence?: string;
  producedAtRuntimeTimeMs?: string;
  oldestChangeAtRuntimeMonotonicMs?: string;
  baseReliableSequence?: string;
  kind?: number;
  elements?: ElementStatePatchWire[];
  anchorBindings?: ProjectedAnchorBindingPatchWire[];
  producedAtRuntimeMonotonicMs?: string;
}

export interface ElementStatePatchWire {
  elementId?: string;
  node?: NodeStatePatchWire;
}

export interface EndPresentationWire {}

export interface GroupEnteredWire {
  groupId?: string;
  groupEntryEpoch?: string;
  initialization?: GroupRuntimeInitializationWire;
}

export interface GroupExitedWire {
  groupId?: string;
  groupEntryEpoch?: string;
}

export interface GroupRuntimeInitializationWire {
  nodeStates?: NodeRuntimeStateWire[];
  surfaceStates?: SurfaceRuntimeStateWire[];
  mediaStates?: MediaRuntimeStateWire[];
  variables?: VariableStateWire[];
  modelClipStates?: ModelClipRuntimeStateWire[];
}

export interface LogicalInputAcceptedWire {
  logicalEventName?: string;
}

export interface LogicalInputCommandWireFields {
  clientEventId?: string;
  logicalEventName?: string;
  presentationOriginVersion?: string;
}
export type LogicalInputCommandWire__capturedAtClientMonotonicMs =
  | { capturedAtClientMonotonicMs: string }
  | { capturedAtClientMonotonicMs?: never };
export type LogicalInputCommandWire = LogicalInputCommandWireFields &
  LogicalInputCommandWire__capturedAtClientMonotonicMs;

export interface MediaActiveWire {
  runId?: RuntimeRunIdWire;
  playback?: PlaybackClockWire;
}

export interface MediaCanceledWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  reason?: number;
}

export interface MediaCompletedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  heldPositionMs?: number;
}

export interface MediaPausedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  positionMs?: number;
  run?: RuntimeRunSnapshotWire;
}

export interface MediaResumedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  playback?: PlayingClockWire;
  run?: RuntimeRunSnapshotWire;
}

export interface MediaRunSnapshotWire {
  surfaceId?: string;
  playback?: PlaybackClockWire;
}

export interface MediaRuntimeStateWireFields {
  surfaceId?: string;
}
export type MediaRuntimeStateWire_state =
  | { stopped: MediaStoppedStateWire; active?: never }
  | { active: MediaActiveWire; stopped?: never };
export type MediaRuntimeStateWire = MediaRuntimeStateWireFields & MediaRuntimeStateWire_state;

export interface MediaSeekedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  playback?: PlaybackClockWire;
  run?: RuntimeRunSnapshotWire;
}

export interface MediaStartedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  playback?: PlaybackClockWire;
  run?: RuntimeRunSnapshotWire;
}

export interface MediaStoppedWire {
  runId?: RuntimeRunIdWire;
  surfaceId?: string;
  heldPositionMs?: number;
}

export interface MediaStoppedStateWire {
  heldPositionMs?: number;
}

export interface ModelClipActiveWire {
  runId?: RuntimeRunIdWire;
}

export interface ModelClipCanceledWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  reason?: number;
}

export interface ModelClipCompletedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  heldPose?: ClipHeldPoseWire;
}

export interface ModelClipCrossfadeWire {
  from?: ClipPlaybackWire;
  to?: ClipPlaybackWire;
  transitionClock?: PlaybackClockWire;
  durationMs?: string;
  easing?: number;
  fromIsHeld?: boolean;
}

export interface ModelClipCrossfadeCompletedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  playback?: ClipPlaybackWire;
  run?: RuntimeRunSnapshotWire;
}

export interface ModelClipCrossfadeStartedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  crossfade?: ModelClipCrossfadeWire;
  run?: RuntimeRunSnapshotWire;
}

export interface ModelClipPausedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  run?: RuntimeRunSnapshotWire;
}

export interface ModelClipResumedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  run?: RuntimeRunSnapshotWire;
}

export interface ModelClipRunSnapshotWireFields {
  modelNodeId?: string;
}
export type ModelClipRunSnapshotWire_phase =
  | { single: ClipPlaybackWire; crossfade?: never }
  | { crossfade: ModelClipCrossfadeWire; single?: never };
export type ModelClipRunSnapshotWire = ModelClipRunSnapshotWireFields &
  ModelClipRunSnapshotWire_phase;

export interface ModelClipRuntimeStateWireFields {
  modelNodeId?: string;
}
export type ModelClipRuntimeStateWire_state =
  | { defaultPose: DefaultModelPoseWire; heldClip?: never; heldBlend?: never; active?: never }
  | { heldClip: ClipHeldPoseWire; defaultPose?: never; heldBlend?: never; active?: never }
  | { heldBlend: BlendHeldPoseWire; defaultPose?: never; heldClip?: never; active?: never }
  | { active: ModelClipActiveWire; defaultPose?: never; heldClip?: never; heldBlend?: never };
export type ModelClipRuntimeStateWire = ModelClipRuntimeStateWireFields &
  ModelClipRuntimeStateWire_state;

export interface ModelClipStartedWire {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
  playback?: ClipPlaybackWire;
  run?: RuntimeRunSnapshotWire;
}

export interface ModelClipStoppedWireFields {
  runId?: RuntimeRunIdWire;
  modelNodeId?: string;
}
export type ModelClipStoppedWire_heldPose =
  | { clip: ClipHeldPoseWire; blend?: never }
  | { blend: BlendHeldPoseWire; clip?: never };
export type ModelClipStoppedWire = ModelClipStoppedWireFields & ModelClipStoppedWire_heldPose;

export interface NextGroupWire {
  groupId?: string;
}

export interface NextStepWire {
  stepId?: string;
}

export interface NodeRuntimeStateWire {
  nodeId?: string;
  active?: boolean;
  visible?: boolean;
  opacity?: number;
  transform?: TransformWire;
}

export interface NodeStateCommittedWire {
  state?: NodeRuntimeStateWire;
}

export interface NodeStatePatchWireFields {}
export type NodeStatePatchWire__active = { active: boolean } | { active?: never };
export type NodeStatePatchWire__visible = { visible: boolean } | { visible?: never };
export type NodeStatePatchWire__opacity = { opacity: number } | { opacity?: never };
export type NodeStatePatchWire__transform = { transform: TransformWire } | { transform?: never };
export type NodeStatePatchWire = NodeStatePatchWireFields &
  NodeStatePatchWire__active &
  NodeStatePatchWire__visible &
  NodeStatePatchWire__opacity &
  NodeStatePatchWire__transform;

export interface ParticipantPresenceChangedWire {
  participantId?: string;
  role?: number;
  connected?: boolean;
}

export interface ParticipantRuntimeViewWire {
  projectionProfileId?: string;
  assignmentEpoch?: string;
  baseReliableSequence?: string;
  progression?: ProgressionRuntimeStateWire;
  nodeStates?: NodeRuntimeStateWire[];
  surfaceStates?: SurfaceRuntimeStateWire[];
  mediaStates?: MediaRuntimeStateWire[];
  variables?: VariableStateWire[];
  activeRuns?: RuntimeRunSnapshotWire[];
  clock?: RuntimeClockSnapshotWire;
  presentationOrigin?: PresentationOriginWire;
  enabledLogicalInputs?: string[];
  modelClipStates?: ModelClipRuntimeStateWire[];
}

export interface PausedWire {
  reason?: number;
}

export interface PausedClockWire {
  positionMs?: number;
}

export interface PlaybackClockWireFields {}
export type PlaybackClockWire_clock =
  | { playing: PlayingClockWire; paused?: never }
  | { paused: PausedClockWire; playing?: never };
export type PlaybackClockWire = PlaybackClockWireFields & PlaybackClockWire_clock;

export interface PlayingClockWire {
  positionAtReferenceMs?: number;
  referenceRuntimeTimeMs?: string;
}

export interface PresentationEndedWire {
  reason?: number;
}

export interface PresentationOriginWire {
  version?: string;
  pose?: PoseWire;
}

export interface PresentationOriginChangedWire {
  origin?: PresentationOriginWire;
}

export interface ProgressionNextWireFields {}
export type ProgressionNextWire_destination =
  | { step: NextStepWire; group?: never; end?: never; stay?: never }
  | { group: NextGroupWire; step?: never; end?: never; stay?: never }
  | { end: EndPresentationWire; step?: never; group?: never; stay?: never }
  | { stay: StayOnStepWire; step?: never; group?: never; end?: never };
export type ProgressionNextWire = ProgressionNextWireFields & ProgressionNextWire_destination;

export interface ProgressionRuntimeStateWireFields {
  currentGroupId?: string;
  groupEntryEpoch?: string;
  currentStepId?: string;
  stepEntryEpoch?: string;
  stepEnteredAtRuntimeTimeMs?: string;
}
export type ProgressionRuntimeStateWire_phase =
  | { stable: StableProgressionWire; transitioning?: never }
  | { transitioning: TransitioningProgressionWire; stable?: never };
export type ProgressionRuntimeStateWire = ProgressionRuntimeStateWireFields &
  ProgressionRuntimeStateWire_phase;

export interface ProjectedAnchorBindingPatchWireFields {
  nodeId?: string;
}
export type ProjectedAnchorBindingPatchWire_state =
  | { unavailable: AnchorBindingUnavailableWire; sample?: never }
  | { sample: ProjectedAnchorBindingSampleWire; unavailable?: never };
export type ProjectedAnchorBindingPatchWire = ProjectedAnchorBindingPatchWireFields &
  ProjectedAnchorBindingPatchWire_state;

export interface ProjectedAnchorBindingSampleWireFields {
  trackingFrameSequence?: string;
  observedAtRuntimeMonotonicMs?: string;
}
export type ProjectedAnchorBindingSampleWire__position =
  | { position: Vector3Wire }
  | { position?: never };
export type ProjectedAnchorBindingSampleWire__rotation =
  | { rotation: QuaternionWire }
  | { rotation?: never };
export type ProjectedAnchorBindingSampleWire = ProjectedAnchorBindingSampleWireFields &
  ProjectedAnchorBindingSampleWire__position &
  ProjectedAnchorBindingSampleWire__rotation;

export interface ProjectedParticipantPresenceWire {
  participantId?: string;
  role?: number;
  connected?: boolean;
}

export interface ProjectedPresenceStateWire {
  participants?: ProjectedParticipantPresenceWire[];
}

export interface ProjectedReliableEventWireFields {
  sequence?: string;
  eventId?: string;
  occurredAtRuntimeTimeMs?: string;
  fence?: RuntimeProjectionFenceWire;
}
export type ProjectedReliableEventWire__causeEventId =
  | { causeEventId: string }
  | { causeEventId?: never };
export type ProjectedReliableEventWire_payload =
  | {
      runtimeStatusChanged: RuntimeStatusChangedWire;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      presentationOriginChanged: PresentationOriginChangedWire;
      runtimeStatusChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      groupEntered: GroupEnteredWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      groupExited: GroupExitedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      stepEntered: StepEnteredWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      cueAccepted: CueAcceptedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      presentationEnded: PresentationEndedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      logicalInputAccepted: LogicalInputAcceptedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      surfaceInteractionAccepted: SurfaceInteractionAcceptedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      surfaceStateChanged: SurfaceStateChangedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      surfaceTransitionStarted: SurfaceTransitionStartedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      surfaceTransitionCompleted: SurfaceTransitionCompletedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      nodeStateCommitted: NodeStateCommittedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      variableChanged: VariableChangedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      timelineStarted: TimelineStartedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      timelineCompleted: TimelineCompletedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      timelineCanceled: TimelineCanceledWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaStarted: MediaStartedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaPaused: MediaPausedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaResumed: MediaResumedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaSeeked: MediaSeekedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaCompleted: MediaCompletedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaCanceled: MediaCanceledWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      mediaStopped: MediaStoppedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipStarted: ModelClipStartedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipPaused: ModelClipPausedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipResumed: ModelClipResumedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipStopped: ModelClipStoppedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipCompleted: ModelClipCompletedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipCrossfadeStarted: ModelClipCrossfadeStartedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipCrossfadeCompleted: ModelClipCrossfadeCompletedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCanceled?: never;
      participantPresenceChanged?: never;
    }
  | {
      modelClipCanceled: ModelClipCanceledWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      participantPresenceChanged?: never;
    }
  | {
      participantPresenceChanged: ParticipantPresenceChangedWire;
      runtimeStatusChanged?: never;
      presentationOriginChanged?: never;
      groupEntered?: never;
      groupExited?: never;
      stepEntered?: never;
      cueAccepted?: never;
      presentationEnded?: never;
      logicalInputAccepted?: never;
      surfaceInteractionAccepted?: never;
      surfaceStateChanged?: never;
      surfaceTransitionStarted?: never;
      surfaceTransitionCompleted?: never;
      nodeStateCommitted?: never;
      variableChanged?: never;
      timelineStarted?: never;
      timelineCompleted?: never;
      timelineCanceled?: never;
      mediaStarted?: never;
      mediaPaused?: never;
      mediaResumed?: never;
      mediaSeeked?: never;
      mediaCompleted?: never;
      mediaCanceled?: never;
      mediaStopped?: never;
      modelClipStarted?: never;
      modelClipPaused?: never;
      modelClipResumed?: never;
      modelClipStopped?: never;
      modelClipCompleted?: never;
      modelClipCrossfadeStarted?: never;
      modelClipCrossfadeCompleted?: never;
      modelClipCanceled?: never;
    };
export type ProjectedReliableEventWire = ProjectedReliableEventWireFields &
  ProjectedReliableEventWire__causeEventId &
  ProjectedReliableEventWire_payload;

export interface ProjectedRuntimeSnapshotWire {
  projectionProfileId?: string;
  assignmentEpoch?: string;
  reliableSequence?: string;
  runtimeView?: ParticipantRuntimeViewWire;
}

export interface ProjectionAdvanceWire {
  fence?: RuntimeProjectionFenceWire;
  fromExclusive?: string;
  throughSequence?: string;
}

export interface ReplayRequestWire {
  afterSequence?: string;
}

export interface ResumeCursorWire {
  priorConnectionId?: string;
  appliedReliableSequence?: string;
  fence?: RuntimeProjectionFenceWire;
}

export interface ResyncRequiredWire {
  reason?: number;
  newestReliableSequence?: string;
}

export interface RunningWire {}

export interface RuntimeClockSnapshotWireFields {
  runtimeTimeMs?: string;
}
export type RuntimeClockSnapshotWire_status =
  | { running: RunningWire; paused?: never; terminating?: never }
  | { paused: PausedWire; running?: never; terminating?: never }
  | { terminating: TerminatingWire; running?: never; paused?: never };
export type RuntimeClockSnapshotWire = RuntimeClockSnapshotWireFields &
  RuntimeClockSnapshotWire_status;

export interface RuntimeControlCommandWire {
  clientEventId?: string;
  kind?: number;
  presentationOriginVersion?: string;
}

export interface RuntimeProtocolLimitsWire {
  maximumIdUtf8Bytes?: number;
  maximumControlItemBytes?: number;
  maximumStateItemBytes?: number;
  reliableEventRetentionCount?: number;
  reliableEventRetentionBytes?: string;
  reliableEventRetentionMs?: string;
  maximumReplayItems?: number;
  maximumReplayBytes?: string;
  idempotencyRetentionCount?: number;
  idempotencyRetentionMs?: string;
  snapshotCatchUpMaxAttempts?: number;
  snapshotCatchUpTotalBudgetMs?: string;
  runtimeMicrostepLimit?: number;
  maximumTrackingSamplesPerFrame?: number;
  maximumTrackingFramesPerSecond?: number;
  anchorSampleMaxAgeMs?: string;
  catchUpQueueMaximumItems?: number;
  catchUpQueueMaximumBytes?: string;
  stateDependencyBufferMaximumValues?: number;
  stateDependencyBufferMaximumMs?: string;
}

export interface RuntimeRunSnapshotWireFields {
  runId?: RuntimeRunIdWire;
  owner?: RuntimeRunOwnerWire;
  cause?: RuntimeRunCauseWire;
  completion?: number;
  startedAtRuntimeTimeMs?: string;
}
export type RuntimeRunSnapshotWire_run =
  | {
      surfaceTransition: SurfaceTransitionRunSnapshotWire;
      timeline?: never;
      media?: never;
      modelClip?: never;
    }
  | {
      timeline: TimelineRunSnapshotWire;
      surfaceTransition?: never;
      media?: never;
      modelClip?: never;
    }
  | { media: MediaRunSnapshotWire; surfaceTransition?: never; timeline?: never; modelClip?: never }
  | {
      modelClip: ModelClipRunSnapshotWire;
      surfaceTransition?: never;
      timeline?: never;
      media?: never;
    };
export type RuntimeRunSnapshotWire = RuntimeRunSnapshotWireFields & RuntimeRunSnapshotWire_run;

export interface RuntimeStatusChangedWireFields {}
export type RuntimeStatusChangedWire_status =
  | { running: RunningWire; paused?: never; terminating?: never }
  | { paused: PausedWire; running?: never; terminating?: never }
  | { terminating: TerminatingWire; running?: never; paused?: never };
export type RuntimeStatusChangedWire = RuntimeStatusChangedWireFields &
  RuntimeStatusChangedWire_status;

export interface StableProgressionWire {}

export interface StateClientItemWireFields {}
export type StateClientItemWire_item =
  | { handshake: StateHandshakeWire; trackingFrame?: never }
  | { trackingFrame: TrackingFrameWire; handshake?: never };
export type StateClientItemWire = StateClientItemWireFields & StateClientItemWire_item;

export interface StateConnectedWire {
  connectionId?: string;
  nextStateFrameSequence?: string;
}

export interface StateConnectionNonceWire {
  nonce?: Uint8Array;
  expiresInMs?: number;
}

export interface StateHandshakeWire {
  protocolVersion?: string;
  progressionContractVersion?: number;
  supportedCapabilities?: number[];
  connectionId?: string;
  stateConnectionNonce?: Uint8Array;
}

export interface StateReadyWire {
  appliedReliableSequence?: string;
  presentationOriginVersion?: string;
}

export interface StateServerItemWireFields {}
export type StateServerItemWire_item =
  | { connected: StateConnectedWire; stateFrame?: never }
  | { stateFrame: ElementStateFrameWire; connected?: never };
export type StateServerItemWire = StateServerItemWireFields & StateServerItemWire_item;

export interface StayOnStepWire {}

export interface StepEnteredWire {
  groupId?: string;
  groupEntryEpoch?: string;
  stepId?: string;
  stepEntryEpoch?: string;
  enteredAtRuntimeTimeMs?: string;
}

export interface StepExecutionSnapshotWire {
  stepEntryEpoch?: string;
  consumedCueIds?: string[];
  cooldowns?: CueCooldownWire[];
  timers?: ArmedTimerWire[];
}

export interface SurfaceInteractionAcceptedWire {
  surfaceId?: string;
  interactionId?: string;
}

export interface SurfaceInteractionCommandWireFields {
  clientEventId?: string;
  surfaceId?: string;
  interactionId?: string;
  presentationOriginVersion?: string;
}
export type SurfaceInteractionCommandWire__capturedAtClientMonotonicMs =
  | { capturedAtClientMonotonicMs: string }
  | { capturedAtClientMonotonicMs?: never };
export type SurfaceInteractionCommandWire = SurfaceInteractionCommandWireFields &
  SurfaceInteractionCommandWire__capturedAtClientMonotonicMs;

export interface SurfaceRuntimeStateWireFields {
  surfaceId?: string;
  stateId?: string;
}
export type SurfaceRuntimeStateWire__transitionRunId =
  | { transitionRunId: RuntimeRunIdWire }
  | { transitionRunId?: never };
export type SurfaceRuntimeStateWire = SurfaceRuntimeStateWireFields &
  SurfaceRuntimeStateWire__transitionRunId;

export interface SurfaceStateChangedWire {
  surfaceId?: string;
  fromStateId?: string;
  stateId?: string;
}

export interface SurfaceTransitionCompletedWire {
  surfaceId?: string;
  runId?: RuntimeRunIdWire;
  stateId?: string;
}

export interface SurfaceTransitionRunSnapshotWire {
  surfaceId?: string;
  fromStateId?: string;
  toStateId?: string;
  durationMs?: string;
  easing?: number;
}

export interface SurfaceTransitionStartedWire {
  surfaceId?: string;
  runId?: RuntimeRunIdWire;
  fromStateId?: string;
  stateId?: string;
  startedAtRuntimeTimeMs?: string;
  durationMs?: string;
  easing?: number;
  run?: RuntimeRunSnapshotWire;
}

export interface TerminatingWire {
  reason?: number;
}

export interface TimelineCanceledWire {
  runId?: RuntimeRunIdWire;
  timelineId?: string;
  reason?: number;
}

export interface TimelineCompletedWire {
  runId?: RuntimeRunIdWire;
  timelineId?: string;
}

export interface TimelineRunSnapshotWire {
  timelineId?: string;
}

export interface TimelineStartedWire {
  runId?: RuntimeRunIdWire;
  timelineId?: string;
  owner?: RuntimeRunOwnerWire;
  cause?: RuntimeRunCauseWire;
  completion?: number;
  startedAtRuntimeTimeMs?: string;
}

export interface TrackedPoseSampleWire {
  target?: number;
  questLocalPose?: PoseWire;
  positionAvailable?: boolean;
  rotationAvailable?: boolean;
}

export interface TrackingFrameWire {
  frameSequence?: string;
  capturedAtClientMonotonicMs?: string;
  samples?: TrackedPoseSampleWire[];
  presentationFromQuestLocal?: PoseWire;
}

export interface TransitioningProgressionWire {
  blockingRunIds?: RuntimeRunIdWire[];
  pendingNext?: ProgressionNextWire;
}

export interface VariableChangedWire {
  state?: VariableStateWire;
}

export interface VariableStateWire {
  variableId?: string;
  value?: ScalarValueWire;
}
