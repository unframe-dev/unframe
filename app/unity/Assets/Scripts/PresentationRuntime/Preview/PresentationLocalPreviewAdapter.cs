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
    public sealed class PresentationLocalPreviewInput : IPresentationRenderView
    {
        private readonly LocalPreviewEnvelope envelope;
        private readonly Dictionary<string, ProjectedSurfaceDefinition> surfaces;
        private readonly Dictionary<string, NodeRuntimeState> nodeStates;
        private readonly Dictionary<string, SurfaceRuntimeState> surfaceStates;
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
        }

        public string RequestId { get { return envelope.RequestId; } }
        public string SourceRevision { get { return envelope.HasSourceRevision ? envelope.SourceRevision : null; } }
        public string BuildIdentity { get; }
        public ProjectedRuntimeCatalog Catalog { get { return envelope.Projection.RuntimeCatalog; } }
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces { get { return envelope.Projection.RenderSurfaces; } }
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get { return envelope.Projection.SemanticSurfaces; } }
        public IEnumerable<TextureResidencyBinding> TextureBindings { get { return envelope.Projection.TextureResidency.Textures; } }
        public Pose StageOrigin { get { return new Pose { Position = new Vector3(), Rotation = new Quaternion { W = 1 } }; } }
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns { get { return Array.Empty<RuntimeRunSnapshot>(); } }
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { return surfaces.TryGetValue(id, out value); }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { return nodeStates.TryGetValue(id, out value); }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        public bool TryGetAnchorSample(string nodeId, out ProjectedAnchorBindingSample value) { value = null; return false; }
    }

    public static class PresentationLocalPreviewAdapter
    {
        public static bool TryCreate(LocalPreviewEnvelope source, out PresentationLocalPreviewInput input, out string error)
        {
            input = null;
            error = "preview.envelope-invalid";
            try
            {
                if (source == null || source.SchemaVersion != 1 || !RequestIdValid(source.RequestId)
                    || source.HasSourceRevision && !PresentationDeliveryCatalog.IsContentHash(source.SourceRevision)
                    || source.Projection?.RuntimeCatalog == null || source.InitialState == null
                    || source.Projection.TextureResidency == null
                    || source.Projection.TextureResidency.BudgetTierId != "local-web-preview") return false;
                LocalPreviewEnvelope envelope = source.Clone();
                Struct manifest = JsonParser.Default.Parse<Struct>(envelope.BuildManifest);
                Struct assetSet = JsonParser.Default.Parse<Struct>(envelope.AssetSet);
                string buildId = StringField(manifest, "buildId");
                if (NumberField(manifest, "schemaVersion") != 2 || !PresentationDeliveryCatalog.IsId(buildId)
                    || NumberField(assetSet, "schemaVersion") != 2) return false;
                LocalPreviewProjection projection = envelope.Projection;
                if (projection.LocalOverlays.Count != 0 || projection.RuntimeCatalog.CatalogContractVersion != 2
                    || projection.RuntimeCatalog.ModelClips.Count != 0) return false;
                var capabilities = new HashSet<RuntimeCapability>();
                foreach (RuntimeCapability capability in projection.RequiredRuntimeCapabilities)
                    if ((capability != RuntimeCapability.TimelineRun && capability != RuntimeCapability.SurfaceTransition)
                        || !capabilities.Add(capability)) return false;

                var nodes = new Dictionary<string, ProjectedNodeDefinition>();
                var surfaces = new Dictionary<string, ProjectedSurfaceDefinition>();
                foreach (ProjectedNodeDefinition node in projection.RuntimeCatalog.Nodes)
                {
                    if (!PresentationDeliveryCatalog.IsId(node.NodeId) || nodes.ContainsKey(node.NodeId)
                        || !ValidOwner(node.Owner) || node.Parent == null
                        || node.Parent.ParentCase != SpatialParent.ParentOneofCase.Stage && node.Parent.ParentCase != SpatialParent.ParentOneofCase.Node
                        || node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Container && node.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Surface) return false;
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
                    if (!PresentationDeliveryCatalog.IsContentHash(checksum) || StringField(descriptor, "mediaType") != "image/png"
                        || encoded <= 0 || encoded > 17 * 1024 * 1024 || encoded != Math.Floor(encoded)) return false;
                    assets.Add(asset.AssetId, new AssetAccessBinding
                    {
                        AssetId = asset.AssetId,
                        Checksum = checksum,
                        MediaType = "image/png",
                        EncodedSizeBytes = (ulong)encoded,
                    });
                    references.Add(asset.AssetId, asset.Reference);
                }
                foreach (DeliveredRenderSurface render in projection.RenderSurfaces)
                    if (render.RendererKind != RendererKind.BakedWeb) return false;
                TextureCapability textureCapability = PreviewTextureCapability();
                if (!PresentationDeliveryCatalog.TryValidateRenderGraph(projection.RenderSurfaces, projection.SemanticSurfaces,
                    new RendererCapabilities { BakedWeb = textureCapability }, surfaces, assets, out error)
                    || !PresentationBakedDeliveryValidation.TryValidate(projection.RenderSurfaces, projection.TextureResidency,
                        textureCapability, PreviewTextureLimits(projection.TextureResidency.BudgetTierId), assets.Values, out error)) return false;
                var selectedAssets = new HashSet<string>();
                foreach (TextureResidencyBinding binding in projection.TextureResidency.Textures) selectedAssets.Add(binding.AssetId);
                foreach (DeliveredRenderSurface render in projection.RenderSurfaces)
                    foreach (DeliveredArtifact artifact in render.Artifacts)
                        foreach (BakedWebStateTexture state in artifact.BakedWeb.States) selectedAssets.Add(state.Texture.AssetId);
                if (!selectedAssets.SetEquals(assets.Keys)) return false;

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

        private static TextureLimits PreviewTextureLimits(string tierId)
        {
            return new TextureLimits
            {
                TierId = tierId,
                MaxTextureWidth = 2048,
                MaxTextureHeight = 2048,
                MaxTexturePixels = 2048 * 2048,
                MaxTextureBindings = 1024,
                MaxGpuBytes = PresentationPreviewAdmission.SceneGpuLimitBytes,
                MaxSerialLoadCpuBytes = PresentationPreviewAdmission.LoadCpuLimitBytes,
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
        private static bool ValidState(NodeRuntimeState state)
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
