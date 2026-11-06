using System;
using System.Collections.Generic;
using Google.Protobuf;
using Google.Protobuf.WellKnownTypes;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Preview;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class PresentationLocalPreviewInput : IPresentationNativeRenderView
    {
        private readonly LocalPreviewEnvelope envelope;
        private readonly Dictionary<string, ProjectedSurfaceDefinition> surfaces;
        private Dictionary<string, NodeRuntimeState> nodeStates;
        private Dictionary<string, SurfaceRuntimeState> surfaceStates;
        private Dictionary<string, MediaRuntimeState> mediaStates = new Dictionary<string, MediaRuntimeState>();
        private Dictionary<string, ModelClipRuntimeState> clipStates = new Dictionary<string, ModelClipRuntimeState>();
        private readonly Dictionary<string, VariableState> variableStates = new Dictionary<string, VariableState>();
        private UnityEngine.Vector3 presenterPosition;
        private UnityEngine.Quaternion presenterRotation = UnityEngine.Quaternion.identity;
        private ulong poseSequence = 1;
        public IEnumerable<EffectRunSnapshot> EffectRuns { get; private set; } = Array.Empty<EffectRunSnapshot>();
        internal void ReplaceEffects(IEnumerable<EffectRunSnapshot> runs) { EffectRuns = new List<EffectRunSnapshot>(runs); }
        private List<RuntimeRunSnapshot> activeRuns = new List<RuntimeRunSnapshot>();
        internal readonly Dictionary<string, AssetAccessBinding> Assets;
        internal readonly Dictionary<string, string> References;

        internal PresentationLocalPreviewInput(LocalPreviewEnvelope envelope, string buildIdentity,
            Dictionary<string, ProjectedSurfaceDefinition> surfaces, Dictionary<string, NodeRuntimeState> nodes,
            Dictionary<string, SurfaceRuntimeState> states, Dictionary<string, AssetAccessBinding> assets,
            Dictionary<string, string> references)
        {
            this.envelope = envelope;
            BuildIdentity = buildIdentity;
            this.surfaces = surfaces;
            nodeStates = nodes;
            surfaceStates = states;
            Assets = assets;
            References = references;
            foreach (var state in envelope.InitialState.VariableStates) variableStates.Add(state.VariableId, state);
            foreach (var state in envelope.InitialState.MediaStates) mediaStates.Add(state.SurfaceId, state);
            foreach (var state in envelope.InitialState.ModelClipStates) clipStates.Add(state.ModelNodeId, state);
        }

        public string RequestId { get { return envelope.RequestId; } }
        public string SourceRevision { get { return envelope.HasSourceRevision ? envelope.SourceRevision : null; } }
        public string BuildIdentity { get; }
        public ProjectedRuntimeCatalog Catalog { get { return envelope.Projection.RuntimeCatalog; } }
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces { get { return envelope.Projection.RenderSurfaces; } }
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get { return envelope.Projection.SemanticSurfaces; } }
        public string CurrentGroupId { get; internal set; }
        public TextureResidencyPlan TexturePlan => envelope.Projection.TextureResidency;
        public IEnumerable<TextureResidencyBinding> TextureBindings { get { return envelope.Projection.TextureResidency.Textures; } }
        public IEnumerable<ModelResidencyBinding> ModelBindings { get { return envelope.Projection.ModelResidency?.Models ?? (IEnumerable<ModelResidencyBinding>)System.Array.Empty<ModelResidencyBinding>(); } }
        public Pose StageOrigin { get { return new Pose { Position = new Vector3(), Rotation = new Quaternion { W = 1 } }; } }
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns { get { return activeRuns; } }
        internal void ReplaceMediaPlayback(IEnumerable<MediaRuntimeState> media, IEnumerable<ModelClipRuntimeState> clips)
        {
            mediaStates = new Dictionary<string, MediaRuntimeState>(); clipStates = new Dictionary<string, ModelClipRuntimeState>();
            foreach (var state in media) mediaStates.Add(state.SurfaceId, state);
            foreach (var state in clips) clipStates.Add(state.ModelNodeId, state);
        }
        public bool TryGetMediaState(string id, out MediaRuntimeState value) => mediaStates.TryGetValue(id, out value);
        public bool TryGetModelClipState(string id, out ModelClipRuntimeState value) => clipStates.TryGetValue(id, out value);
        internal void ReplacePlayback(Dictionary<string, NodeRuntimeState> nodes,
            Dictionary<string, SurfaceRuntimeState> states, List<RuntimeRunSnapshot> runs)
        {
            nodeStates = nodes;
            surfaceStates = states;
            activeRuns = runs;
        }
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { return surfaces.TryGetValue(id, out value); }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { return nodeStates.TryGetValue(id, out value); }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        public bool TryGetAsset(string id, out AssetAccessBinding value) => Assets.TryGetValue(id, out value);
        public bool TryGetVariableState(string id, out VariableState value) => variableStates.TryGetValue(id, out value);
        internal void ReplaceVariables(IEnumerable<VariableState> values)
        {
            variableStates.Clear();
            foreach (var value in values) variableStates.Add(value.VariableId, value);
        }
        public NativeUiResidencyPlan NativeUiResidency => envelope.Projection.NativeUiResidency;
        internal void SetPresenterPose(UnityEngine.Vector3 position, UnityEngine.Quaternion rotation)
        { presenterPosition = position; presenterRotation = rotation; poseSequence++; }
        public ulong TrackingGeneration { get; private set; }
        public ulong TrackedPositionContinuity(AnchorTarget target) => 0;
        internal void InvalidateTrackedPoses() { TrackingGeneration++; }

        public bool TryGetFrozenAnchor(string nodeId, out FrozenAnchorDisplayState value)
        {
            value = null;
            return false;
        }

        public bool TryGetTrackedPose(AnchorTarget target, out ProjectedTrackedPoseSample value)
        {
            value = null;
            UnityEngine.Vector3 offset;
            switch (target)
            {
                case AnchorTarget.Body: offset = UnityEngine.Vector3.zero; break;
                case AnchorTarget.Head: offset = new UnityEngine.Vector3(0, .65f, 0); break;
                case AnchorTarget.LeftHand: offset = new UnityEngine.Vector3(-.35f, .25f, -.25f); break;
                case AnchorTarget.RightHand: offset = new UnityEngine.Vector3(.35f, .25f, -.25f); break;
                default: return false;
            }
            UnityEngine.Vector3 position = presenterPosition + presenterRotation * offset;
            value = new ProjectedTrackedPoseSample
            {
                TrackingFrameSequence = poseSequence,
                Position = new Vector3 { X = position.x, Y = position.y, Z = -position.z },
                Rotation = new Quaternion { X = -presenterRotation.x, Y = -presenterRotation.y, Z = presenterRotation.z, W = presenterRotation.w },
            };
            return true;
        }
    }

    public static class PresentationLocalPreviewAdapter
    {
        public static bool TryCreate(LocalPreviewEnvelope source, out PresentationLocalPreviewInput input, out string error)
        {
            input = null;
            error = "preview.envelope-invalid";
            try
            {
                if (source == null || source.SchemaVersion != 2 || !RequestIdValid(source.RequestId)
                    || source.HasSourceRevision && !PresentationDeliveryCatalog.IsContentHash(source.SourceRevision)
                    || source.Projection?.RuntimeCatalog == null || source.InitialState == null
                    || source.Projection.TextureResidency == null
                    || source.Projection.TextureResidency.BudgetTierId != "local-web-preview") return false;
                LocalPreviewEnvelope envelope = source.Clone();
                Struct manifest = JsonParser.Default.Parse<Struct>(envelope.BuildManifest);
                Struct assetSet = JsonParser.Default.Parse<Struct>(envelope.AssetSet);
                string buildId = StringField(manifest, "buildId");
                if (NumberField(manifest, "schemaVersion") != 1 || !PresentationDeliveryCatalog.IsId(buildId)
                    || NumberField(assetSet, "schemaVersion") != 1) return false;
                LocalPreviewProjection projection = envelope.Projection;
                if (projection.RuntimeCatalog.PresenterRecognition != null || projection.LocalOverlays.Count != 0 || projection.RuntimeCatalog.CatalogContractVersion != 3
                    ) return false;
                var capabilities = new HashSet<RuntimeCapability>();
                foreach (RuntimeCapability capability in projection.RequiredRuntimeCapabilities)
                    if ((capability != RuntimeCapability.TimelineRun && capability != RuntimeCapability.SurfaceTransition && capability != RuntimeCapability.ModelClip && capability != RuntimeCapability.VideoPlayback && capability != RuntimeCapability.Tracking && capability != RuntimeCapability.EffectPlayback && capability != RuntimeCapability.TrackedPoseDelivery)
                        || !capabilities.Add(capability)) return false;

                var nodes = new Dictionary<string, ProjectedNodeDefinition>();
                var surfaces = new Dictionary<string, ProjectedSurfaceDefinition>();
                foreach (ProjectedNodeDefinition node in projection.RuntimeCatalog.Nodes)
                {
                    if (!PresentationDeliveryCatalog.IsId(node.NodeId) || nodes.ContainsKey(node.NodeId)
                        || !ValidOwner(node.Owner) || node.Parent == null
                        || node.Parent.ParentCase != SpatialParent.ParentOneofCase.Stage && node.Parent.ParentCase != SpatialParent.ParentOneofCase.Node && node.Parent.ParentCase != SpatialParent.ParentOneofCase.PresenterAnchor
                        || node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Container && node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Surface
                        && node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Model) return false;
                    if (node.Parent.PresenterAnchor != null && (node.Parent.PresenterAnchor.Target < AnchorTarget.Head || node.Parent.PresenterAnchor.Target > AnchorTarget.Body
                        || !node.Parent.PresenterAnchor.FollowPosition && !node.Parent.PresenterAnchor.FollowRotation)) return false;
                    nodes.Add(node.NodeId, node);
                }
                foreach (ProjectedNodeDefinition node in nodes.Values)
                {
                    var visited = new HashSet<string>();
                    ProjectedNodeDefinition current = node;
                    while (current.Parent.ParentCase == SpatialParent.ParentOneofCase.Node)
                    {
                        if (!visited.Add(current.NodeId) || !nodes.TryGetValue(current.Parent.Node.NodeId, out current)) return false;
                    }
                }
                foreach (ProjectedSurfaceDefinition surface in projection.RuntimeCatalog.Surfaces)
                {
                    if (!PresentationDeliveryCatalog.IsId(surface.SurfaceId) || surfaces.ContainsKey(surface.SurfaceId)
                        || !nodes.TryGetValue(surface.HostNodeId, out ProjectedNodeDefinition host)
                        || host.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Surface || host.Surface.SemanticSurfaceId != surface.SurfaceId
                        || !ValidOwner(surface.Owner) || !surface.Owner.Equals(host.Owner)
                        || !ValidSize(surface.LogicalSize) || !ValidSize(surface.PhysicalSizeMeters)
                        || surface.Fit != SurfaceFit.Contain && surface.Fit != SurfaceFit.Cover && surface.Fit != SurfaceFit.Stretch) return false;
                    var states = new HashSet<string>();
                    foreach (string id in surface.ReachableStateIds)
                        if (!PresentationDeliveryCatalog.IsId(id) || !states.Add(id)) return false;
                    if (states.Count == 0) return false;
                    surfaces.Add(surface.SurfaceId, surface);
                }
                foreach (ProjectedNodeDefinition node in nodes.Values)
                    if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Surface && !surfaces.ContainsKey(node.Surface.SemanticSurfaceId)) return false;
                if (!SameIds(projection.VisibleNodeIds, nodes.Keys) || !SameIds(projection.VisibleSurfaceIds, surfaces.Keys)) return false;
                var timelineIds = new HashSet<string>();
                foreach (ProjectedTimelineDefinition timeline in projection.RuntimeCatalog.Timelines)
                    if (!PresentationDeliveryCatalog.IsId(timeline.TimelineId) || !timelineIds.Add(timeline.TimelineId) || !ValidOwner(timeline.Owner)
                        || !PresentationDeliveryCatalog.TryValidateTimeline(timeline, nodes, out error)) return false;
                var variables = new HashSet<string>();
                foreach (ProjectedVariableDefinition variable in projection.RuntimeCatalog.Variables)
                    if (!PresentationDeliveryCatalog.IsId(variable.VariableId) || !variables.Add(variable.VariableId) || !ValidOwner(variable.Owner)) return false;
                if (!SameIds(projection.VisibleVariableIds, variables)) return false;

                var assets = new Dictionary<string, AssetAccessBinding>();
                var references = new Dictionary<string, string>();
                var opaqueReferences = new HashSet<string>(StringComparer.Ordinal);
                Struct descriptors = ObjectField(assetSet, "assets");
                foreach (LocalPreviewAsset asset in envelope.Assets)
                {
                    if (!PresentationDeliveryCatalog.IsId(asset.AssetId) || assets.ContainsKey(asset.AssetId)
                        || String.IsNullOrEmpty(asset.Reference) || asset.Reference.Length > 512 || !opaqueReferences.Add(asset.Reference)) return false;
                    Struct descriptor = ObjectField(descriptors, asset.AssetId);
                    string checksum = StringField(descriptor, "checksum");
                    double encoded = NumberField(descriptor, "encodedSizeBytes");
                    if (!PresentationDeliveryCatalog.IsContentHash(checksum) || StringField(descriptor, "mediaType") != "image/png" && StringField(descriptor, "mediaType") != "model/gltf-binary" && StringField(descriptor, "mediaType") != "video/mp4" && StringField(descriptor, "mediaType") != "font/ttf" && StringField(descriptor, "mediaType") != "font/otf"
                        || encoded <= 0 || encoded > 64 * 1024 * 1024 || encoded != Math.Floor(encoded)) return false;
                    assets.Add(asset.AssetId, new AssetAccessBinding
                    {
                        AssetId = asset.AssetId,
                        Checksum = checksum,
                        MediaType = StringField(descriptor, "mediaType"),
                        EncodedSizeBytes = (ulong)encoded,
                    });
                    references.Add(asset.AssetId, asset.Reference);
                }
                foreach (DeliveredRenderSurface render in projection.RenderSurfaces)
                    if (render.RendererKind != RendererKind.BakedWeb && render.RendererKind != RendererKind.Video && render.RendererKind != RendererKind.NativeUi) return false;
                TextureCapability textureCapability = PreviewTextureCapability();
                if (!PresentationDeliveryCatalog.TryValidateRenderGraph(projection.RenderSurfaces, projection.SemanticSurfaces,
                    new RendererCapabilities
                    {
                        BakedWeb = textureCapability,
                        NativeUi = new NativeUiCapability { Supported = true, ContractVersion = 1, Features = { NativeUiFeature.Clip } },
                        Video = new VideoCapability
                        {
                            Supported = true,
                            ContractVersion = 1,
                            Features = { VideoFeature.H264, VideoFeature.Audio }
                        }
                    }, surfaces, assets, out error)
                    || !PresentationBakedDeliveryValidation.TryValidate(projection.RenderSurfaces, projection.TextureResidency,
                        textureCapability, PreviewTextureLimits(), assets.Values, out error)
                    || !PresentationBakedDeliveryValidation.TryValidateOwnership(projection.RuntimeCatalog, projection.RenderSurfaces, projection.TextureResidency, out error)) return false;
                var variableDefinitions = new Dictionary<string, ProjectedVariableDefinition>();
                foreach (var variable in projection.RuntimeCatalog.Variables) variableDefinitions.Add(variable.VariableId, variable);
                foreach (var render in projection.RenderSurfaces)
                    foreach (var artifact in render.Artifacts)
                        if (artifact.NativeUi != null && !PresentationRichDeliveryValidation.TryValidateNativeUiArtifact(artifact.NativeUi, assets, variableDefinitions, out error)) return false;
                var selectedAssets = new HashSet<string>();
                var fontAssets = new HashSet<string>();
                foreach (var render in projection.RenderSurfaces)
                    foreach (var artifact in render.Artifacts)
                        if (artifact.NativeUi != null)
                            foreach (var node in artifact.NativeUi.Nodes)
                                if (node.Text != null) fontAssets.Add(node.Text.Font.Primary.AssetId);
                if (fontAssets.Count > 0)
                {
                    var plan = projection.NativeUiResidency;
                    if (plan == null || plan.BudgetTierId != "local-web-preview" || fontAssets.Count > 32
                        || plan.FontAssetCount != (ulong)fontAssets.Count || plan.FontAssetIds.Count != fontAssets.Count
                        || !fontAssets.SetEquals(plan.FontAssetIds) || plan.Glyphs.Count > 65536) return false;
                    var checksums = new HashSet<string>();
                    foreach (string id in fontAssets)
                    {
                        if (!assets.TryGetValue(id, out var font) || font.MediaType != "font/ttf" && font.MediaType != "font/otf") return false;
                        checksums.Add(font.Checksum);
                    }
                    var glyphs = new HashSet<string>();
                    foreach (var glyph in plan.Glyphs)
                        if (!checksums.Contains(glyph.FontChecksum) || glyph.UnicodeScalar > 0x10ffff
                            || glyph.UnicodeScalar >= 0xd800 && glyph.UnicodeScalar <= 0xdfff
                            || !glyphs.Add(glyph.FontChecksum + ":" + glyph.UnicodeScalar)) return false;
                }
                foreach (string id in fontAssets) selectedAssets.Add(id);
                foreach (TextureResidencyBinding binding in projection.TextureResidency.Textures)
                {
                    var access = assets[binding.AssetId];
                    if (access.MediaType != "image/png" || binding.PeakLoadCpuBytes != access.EncodedSizeBytes + 2 * binding.DecodedGpuBytes)
                    {
                        error = "preview.texture-metadata-invalid";
                        return false;
                    }
                    selectedAssets.Add(binding.AssetId);
                }
                foreach (DeliveredRenderSurface render in projection.RenderSurfaces)
                    foreach (DeliveredArtifact artifact in render.Artifacts)
                        if (artifact.BakedWeb != null) foreach (BakedWebStateTexture state in artifact.BakedWeb.States) selectedAssets.Add(state.Texture.AssetId);
                        else if (artifact.Video != null) selectedAssets.Add(artifact.Video.VideoAssetId);
                foreach (ProjectedNodeDefinition node in nodes.Values)
                    if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model)
                    {
                        if (!assets.TryGetValue(node.Model.ModelAssetId, out AssetAccessBinding modelAsset) || modelAsset.MediaType != "model/gltf-binary") return false;
                        selectedAssets.Add(node.Model.ModelAssetId);
                    }
                if (!selectedAssets.SetEquals(assets.Keys)) return false;
                var modelIds = new HashSet<string>(); foreach (var node in nodes.Values) if (node.Model != null) modelIds.Add(node.Model.ModelAssetId);
                var boundModels = new HashSet<string>();
                if (projection.ModelResidency != null)
                {
                    if (projection.ModelResidency.BudgetTierId != "local-web-preview") return false;
                    foreach (var binding in projection.ModelResidency.Models)
                    {
                        if (!boundModels.Add(binding.AssetId) || !assets.TryGetValue(binding.AssetId, out var access)
                            || binding.Checksum != access.Checksum || binding.EncodedSizeBytes != access.EncodedSizeBytes || access.MediaType != "model/gltf-binary") return false;
                    }
                }
                if (!modelIds.SetEquals(boundModels)) return false;
                var videoIds = new HashSet<string>(); foreach (var render in projection.RenderSurfaces) foreach (var artifact in render.Artifacts) if (artifact.Video != null) videoIds.Add(artifact.Video.VideoAssetId);
                var boundVideos = new HashSet<string>();
                if (projection.VideoResidency != null)
                {
                    if (projection.VideoResidency.BudgetTierId != "local-web-preview") return false;
                    foreach (var binding in projection.VideoResidency.Videos)
                    {
                        if (!boundVideos.Add(binding.AssetId) || !assets.TryGetValue(binding.AssetId, out var access)
                            || binding.Checksum != access.Checksum || binding.EncodedSizeBytes != access.EncodedSizeBytes || access.MediaType != "video/mp4") return false;
                    }
                }
                if (!videoIds.SetEquals(boundVideos)) return false;
                if (!PresentationMediaPlaybackValidation.TryValidate(projection.RuntimeCatalog, envelope.InitialState.MediaStates,
                    envelope.InitialState.ModelClipStates, System.Array.Empty<RuntimeRunSnapshot>(), 0, out error)) return false;

                error = "preview.initial-state-invalid";
                var initialNodes = new Dictionary<string, NodeRuntimeState>();
                var initialSurfaces = new Dictionary<string, SurfaceRuntimeState>();
                string initialGroup = null;
                foreach (NodeRuntimeState state in envelope.InitialState.NodeStates)
                {
                    if (!nodes.TryGetValue(state.NodeId, out ProjectedNodeDefinition node) || initialNodes.ContainsKey(state.NodeId)
                        || !ValidState(state) || !SelectGroup(node.Owner, ref initialGroup)) return false;
                    initialNodes.Add(state.NodeId, state);
                }
                foreach (SurfaceRuntimeState state in envelope.InitialState.SurfaceStates)
                {
                    if (!surfaces.TryGetValue(state.SurfaceId, out ProjectedSurfaceDefinition surface) || initialSurfaces.ContainsKey(state.SurfaceId)
                        || !surface.ReachableStateIds.Contains(state.StateId) || state.TransitionRunId != null
                        || !SelectGroup(surface.Owner, ref initialGroup)) return false;
                    initialSurfaces.Add(state.SurfaceId, state);
                }
                foreach (ProjectedNodeDefinition node in nodes.Values)
                {
                    if (Owned(node.Owner, initialGroup) != initialNodes.ContainsKey(node.NodeId)) return false;
                    if (initialNodes.ContainsKey(node.NodeId) && node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node
                        && !initialNodes.ContainsKey(node.Parent.Node.NodeId)) return false;
                }
                foreach (ProjectedSurfaceDefinition surface in surfaces.Values)
                    if (Owned(surface.Owner, initialGroup) != initialSurfaces.ContainsKey(surface.SurfaceId)) return false;
                if (!ValidVariables(projection.RuntimeCatalog, envelope.InitialState.VariableStates, initialGroup)) return false;
                input = new PresentationLocalPreviewInput(envelope, buildId, surfaces, initialNodes, initialSurfaces, assets, references);
                error = null;
                return true;
            }
            catch (Exception exception) when (exception is InvalidProtocolBufferException || exception is InvalidJsonException || exception is ArgumentException
                || exception is InvalidOperationException || exception is KeyNotFoundException)
            {
                error = "preview.envelope-invalid";
                return false;
            }
        }

        internal static bool ValidVariables(ProjectedRuntimeCatalog catalog, IEnumerable<VariableState> values, string group)
        {
            var definitions = new Dictionary<string, ProjectedVariableDefinition>();
            foreach (var definition in catalog.Variables) if (Owned(definition.Owner, group)) definitions.Add(definition.VariableId, definition);
            foreach (var state in values)
            {
                if (!definitions.TryGetValue(state.VariableId, out var definition) || state.Value == null) return false;
                if (definition.Type == ScalarType.Number && (state.Value.ValueCase != ScalarValue.ValueOneofCase.NumberValue || Double.IsNaN(state.Value.NumberValue) || Double.IsInfinity(state.Value.NumberValue))
                    || definition.Type == ScalarType.String && state.Value.ValueCase != ScalarValue.ValueOneofCase.StringValue
                    || definition.Type == ScalarType.Boolean && state.Value.ValueCase != ScalarValue.ValueOneofCase.BooleanValue) return false;
                definitions.Remove(state.VariableId);
            }
            return definitions.Count == 0;
        }

        public static bool RequestIdValid(string value)
        {
            if (value == null || value.Length != 32) return false;
            foreach (char c in value) if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false;
            return true;
        }

        private static TextureCapability PreviewTextureCapability()
        {
            return new TextureCapability
            {
                Supported = true,
                ContractVersion = 1,
                Features = { BakedWebFeature.Png, BakedWebFeature.Srgb, BakedWebFeature.AlphaOpaque, BakedWebFeature.AlphaStraight },
            };
        }

        internal static TextureLimits PreviewTextureLimits()
        {
            return new TextureLimits
            {
                TierId = "local-web-preview",
                MaxTextureWidth = 2048,
                MaxTextureHeight = 2048,
                MaxTexturePixels = 2048 * 2048,
                MaxTextureBindings = 1024,
                MaxGpuBytes = ulong.MaxValue,
                MaxSerialLoadCpuBytes = ulong.MaxValue,
            };
        }

        private static bool ValidOwner(ResourceOwner owner)
        {
            return owner != null && (owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && PresentationDeliveryCatalog.IsId(owner.Group.GroupId));
        }
        private static bool Owned(ResourceOwner owner, string group)
        {
            return owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && owner.Group.GroupId == group;
        }
        private static bool SelectGroup(ResourceOwner owner, ref string group)
        {
            if (owner.ScopeCase != ResourceOwner.ScopeOneofCase.Group) return true;
            if (group != null && group != owner.Group.GroupId) return false;
            group = owner.Group.GroupId;
            return true;
        }
        internal static bool ValidState(NodeRuntimeState state)
        {
            Unframe.Presentation.Transform t = state.Transform;
            return t != null && PresentationDeliveryCatalog.IsCanonicalFinite(state.Opacity) && state.Opacity >= 0 && state.Opacity <= 1
                && PresentationCoordinateValidation.IsRenderable(t.Position) && Canonical(t.Position)
                && PresentationCoordinateValidation.IsRenderableScale(t.Scale) && Canonical(t.Scale)
                && PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(t.Rotation);
        }
        private static bool Canonical(Vector3 value)
        {
            return PresentationDeliveryCatalog.IsCanonicalFinite(value.X) && PresentationDeliveryCatalog.IsCanonicalFinite(value.Y)
                && PresentationDeliveryCatalog.IsCanonicalFinite(value.Z);
        }
        private static bool ValidSize(Vector2 value)
        {
            return value != null && PresentationDeliveryCatalog.IsCanonicalFinite(value.X) && PresentationDeliveryCatalog.IsCanonicalFinite(value.Y)
                && value.X > 0 && value.Y > 0 && (float)value.X > 0 && (float)value.Y > 0
                && value.X <= float.MaxValue && value.Y <= float.MaxValue;
        }
        private static bool SameIds(IEnumerable<string> ids, IEnumerable<string> expected)
        {
            var seen = new HashSet<string>();
            foreach (string id in ids) if (!seen.Add(id)) return false;
            return seen.SetEquals(expected);
        }
        private static string StringField(Struct value, string name)
        {
            Value field = value.Fields[name];
            if (field.KindCase != Value.KindOneofCase.StringValue) throw new ArgumentException("Expected a string.");
            return field.StringValue;
        }
        private static double NumberField(Struct value, string name)
        {
            Value field = value.Fields[name];
            if (field.KindCase != Value.KindOneofCase.NumberValue || !PresentationDeliveryCatalog.IsCanonicalFinite(field.NumberValue)) throw new ArgumentException("Expected a finite number.");
            return field.NumberValue;
        }
        private static Struct ObjectField(Struct value, string name)
        {
            Value field = value.Fields[name];
            if (field.KindCase != Value.KindOneofCase.StructValue) throw new ArgumentException("Expected an object.");
            return field.StructValue;
        }
    }
}
