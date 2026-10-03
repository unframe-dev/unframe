using System;
using System.Collections.Generic;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class PresentationDeliveryCatalog
    {
        private const uint DeliverySchemaVersion = 2;
        private const uint DeliveryContractVersion = 2;
        private const uint RuntimeCatalogContractVersion = 2;

        private readonly Dictionary<string, ProjectedNodeDefinition> nodes = new Dictionary<string, ProjectedNodeDefinition>();
        private readonly Dictionary<string, ProjectedSurfaceDefinition> surfaces = new Dictionary<string, ProjectedSurfaceDefinition>();
        private readonly Dictionary<string, AssetAccessBinding> assets = new Dictionary<string, AssetAccessBinding>();
        private readonly Dictionary<string, ModelResidencyBinding> models = new Dictionary<string, ModelResidencyBinding>();
        private readonly Dictionary<string, ProjectedTimelineDefinition> timelines = new Dictionary<string, ProjectedTimelineDefinition>();
        private readonly Dictionary<string, ProjectedVariableDefinition> variables = new Dictionary<string, ProjectedVariableDefinition>();
        private readonly Dictionary<string, ProjectedModelClipDefinition> modelClips = new Dictionary<string, ProjectedModelClipDefinition>();

        internal DeliveryManifest Delivery { get; private set; }
        internal IEnumerable<ProjectedNodeDefinition> Nodes { get { return nodes.Values; } }

        internal bool TryLoad(DeliveryManifest manifest, out string error)
        {
            DeliveryManifest snapshot = manifest == null ? null : manifest.Clone();
            if (!TryBuildDeliveryIndexes(snapshot, out DeliveryIndexes indexes, out error))
            {
                return false;
            }

            Delivery = snapshot;
            Replace(nodes, indexes.Nodes);
            Replace(surfaces, indexes.Surfaces);
            Replace(assets, indexes.Assets);
            Replace(models, indexes.Models);
            Replace(timelines, indexes.Timelines);
            Replace(variables, indexes.Variables);
            Replace(modelClips, indexes.ModelClips);
            error = null;
            return true;
        }

        internal bool TryGetNode(string id, out ProjectedNodeDefinition value) { return nodes.TryGetValue(id, out value); }
        internal bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { return surfaces.TryGetValue(id, out value); }
        internal bool TryGetAsset(string id, out AssetAccessBinding value) { return assets.TryGetValue(id, out value); }
        internal bool TryGetModel(string assetId, out ModelResidencyBinding value) { return models.TryGetValue(assetId, out value); }
        internal bool TryGetTimeline(string id, out ProjectedTimelineDefinition value) { return timelines.TryGetValue(id, out value); }
        internal bool TryGetVariable(string id, out ProjectedVariableDefinition value) { return variables.TryGetValue(id, out value); }
        internal bool TryGetModelClip(string modelNodeId, string clipId, out ProjectedModelClipDefinition value) { return modelClips.TryGetValue(ModelClipKey(modelNodeId, clipId), out value); }
        internal bool ContainsNode(string id) { return nodes.ContainsKey(id); }
        internal bool ContainsSurface(string id) { return surfaces.ContainsKey(id); }
        internal bool ContainsTimeline(string id) { return timelines.ContainsKey(id); }
        internal bool ContainsVariable(string id) { return variables.ContainsKey(id); }

        internal bool IsStateReachable(string surfaceId, string stateId)
        {
            if (!IsId(surfaceId) || !IsId(stateId) || !surfaces.TryGetValue(surfaceId, out ProjectedSurfaceDefinition surface))
            {
                return false;
            }

            foreach (string reachableStateId in surface.ReachableStateIds)
            {
                if (reachableStateId == stateId)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool TryBuildDeliveryIndexes(DeliveryManifest manifest, out DeliveryIndexes indexes, out string error)
        {
            indexes = null;
            if (manifest == null || manifest.SchemaVersion != DeliverySchemaVersion || manifest.DeliveryContractVersion != DeliveryContractVersion || !IsId(manifest.SessionId) || manifest.Publication == null || manifest.CapabilityProfile == null || manifest.ProjectionProfile == null || manifest.ProjectionInstance == null || manifest.Residency == null || manifest.ProjectionProfile.RuntimeCatalog == null)
            {
                error = "delivery manifest is missing a required v2 field.";
                return false;
            }

            ProjectedRuntimeCatalog catalog = manifest.ProjectionProfile.RuntimeCatalog;
            if (!IsId(manifest.Publication.PresentationId) || manifest.Publication.PublicationEpoch == 0 || !IsContentHash(manifest.Publication.PublicationManifestHash)
                || !IsContentHash(manifest.DefinitionHash) || !IsContentHash(manifest.RenderBundleHash) || !IsContentHash(manifest.AssetSetHash))
            {
                return Fail("delivery publication or content hash is incomplete.", out error);
            }

            CapabilityProfile capability = manifest.CapabilityProfile;
            ContractVersions versions = capability.ContractVersions;
            if (capability.SchemaVersion != DeliverySchemaVersion || !IsId(capability.CapabilityProfileId) || versions == null
                || versions.Delivery != DeliveryContractVersion || versions.Runtime != RuntimeCatalogContractVersion
                || versions.Progression != 1 || versions.Projection != 1)
            {
                return Fail("delivery capability profile is incompatible.", out error);
            }

            ProjectionProfileDescriptor profile = manifest.ProjectionProfile;
            ProjectionProfileKey key = profile.Key;
            if (catalog.CatalogContractVersion != RuntimeCatalogContractVersion || !IsId(profile.ProjectionProfileId)
                || !IsId(manifest.ProjectionInstance.ParticipantId) || manifest.ProjectionInstance.AssignmentEpoch == 0
                || manifest.ProjectionInstance.ProjectionProfileId != profile.ProjectionProfileId
                || key == null || key.Publication == null || !key.Publication.Equals(manifest.Publication)
                || key.ProjectionContractVersion != versions.Projection || key.Role == SessionRole.Unspecified
                || key.CapabilityProfileId != capability.CapabilityProfileId)
            {
                error = "delivery projection profile is incompatible.";
                return false;
            }

            HashSet<RuntimeCapability> requiredCapabilities = new HashSet<RuntimeCapability>();
            foreach (RuntimeCapability required in profile.RequiredRuntimeCapabilities)
            {
                if (required != RuntimeCapability.TimelineRunV2 && required != RuntimeCapability.RuntimeTransportV2 && required != RuntimeCapability.SurfaceTransitionV2 || !requiredCapabilities.Add(required))
                {
                    return Fail("delivery capability is unsupported or duplicated.", out error);
                }
            }

            DeliveryIndexes next = new DeliveryIndexes();
            foreach (ProjectedNodeDefinition node in catalog.Nodes)
            {
                if (!TryAdd(next.Nodes, node == null ? null : node.NodeId, node, "node", out error)) return false;
                if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.None || node.Parent == null || node.Parent.ParentCase == SpatialParent.ParentOneofCase.None)
                {
                    return Fail("delivery node is incomplete.", out error);
                }
            }

            foreach (ProjectedNodeDefinition node in catalog.Nodes)
            {
                if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node
                    && (!IsId(node.Parent.Node.NodeId) || !next.Nodes.ContainsKey(node.Parent.Node.NodeId)))
                {
                    return Fail("delivery node parent is absent.", out error);
                }
            }

            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces)
            {
                if (!TryAdd(next.Surfaces, surface == null ? null : surface.SurfaceId, surface, "surface", out error)) return false;
                if (!IsId(surface.HostNodeId) || !next.Nodes.TryGetValue(surface.HostNodeId, out ProjectedNodeDefinition host)
                    || host.NodeCase != ProjectedNodeDefinition.NodeOneofCase.Surface || host.Surface.SemanticSurfaceId != surface.SurfaceId)
                {
                    return Fail("delivery semantic surface host node is absent or mismatched.", out error);
                }
            }

            foreach (ProjectedNodeDefinition node in catalog.Nodes)
            {
                if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Surface
                    && (!IsId(node.Surface.SemanticSurfaceId) || !next.Surfaces.ContainsKey(node.Surface.SemanticSurfaceId)))
                {
                    return Fail("delivery semantic surface node is unresolved.", out error);
                }
            }

            foreach (AssetAccessBinding asset in manifest.AssetAccess)
            {
                if (!TryAdd(next.Assets, asset == null ? null : asset.AssetId, asset, "asset", out error)) return false;
            }

            if (manifest.Residency.Models == null) return Fail("delivery model residency is required.", out error);
            foreach (ModelResidencyBinding model in manifest.Residency.Models.Models)
            {
                if (!TryAdd(next.Models, model == null ? null : model.AssetId, model, "model", out error)) return false;
                if (!IsId(model.AssetId) || !next.Assets.ContainsKey(model.AssetId))
                {
                    return Fail("delivery model asset is absent.", out error);
                }
            }

            foreach (ProjectedNodeDefinition node in catalog.Nodes)
            {
                if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model
                    && (!IsId(node.Model.ModelAssetId) || !next.Assets.ContainsKey(node.Model.ModelAssetId)
                        || !next.Models.ContainsKey(node.Model.ModelAssetId)))
                {
                    return Fail("delivery model node asset or residency is absent.", out error);
                }
            }

            if (!TryValidateRenderGraph(profile, capability, next.Surfaces, next.Assets, out error)) return false;
            if (!PresentationBakedDeliveryValidation.TryValidate(manifest, out error)) return false;

            foreach (ProjectedTimelineDefinition timeline in catalog.Timelines)
            {
                if (!TryAdd(next.Timelines, timeline == null ? null : timeline.TimelineId, timeline, "timeline", out error)) return false;
                if (!TryValidateTimeline(timeline, next.Nodes, out error)) return false;
            }

            foreach (ProjectedVariableDefinition variable in catalog.Variables)
            {
                if (!TryAdd(next.Variables, variable == null ? null : variable.VariableId, variable, "variable", out error)) return false;
            }

            foreach (ProjectedModelClipDefinition clip in catalog.ModelClips)
            {
                if (clip == null || !IsId(clip.ModelNodeId) || !IsId(clip.ClipId) || next.ModelClips.ContainsKey(ModelClipKey(clip.ModelNodeId, clip.ClipId))) return Fail("delivery model clip id is missing or duplicated.", out error);
                next.ModelClips.Add(ModelClipKey(clip.ModelNodeId, clip.ClipId), clip);
                if (!next.Nodes.ContainsKey(clip.ModelNodeId) || !IsId(clip.ModelAssetId) || !next.Assets.ContainsKey(clip.ModelAssetId)) return Fail("delivery model clip reference is absent.", out error);
            }
            indexes = next;
            error = null;
            return true;
        }

        private static bool TryValidateRenderGraph(ProjectionProfileDescriptor profile, CapabilityProfile capability,
            Dictionary<string, ProjectedSurfaceDefinition> surfaces, Dictionary<string, AssetAccessBinding> assets, out string error)
        {
            Dictionary<string, DeliveredRenderSurface> renderSurfaces = new Dictionary<string, DeliveredRenderSurface>();
            Dictionary<string, ProjectedSemanticSurface> semanticSurfaces = new Dictionary<string, ProjectedSemanticSurface>();
            foreach (ProjectedSemanticSurface semantic in profile.SemanticSurfaces)
            {
                if (!TryAdd(semanticSurfaces, semantic == null ? null : semantic.SemanticSurfaceId, semantic, "semantic surface", out error)) return false;
                if (!surfaces.TryGetValue(semantic.SemanticSurfaceId, out ProjectedSurfaceDefinition catalogSurface))
                    return Fail("delivery semantic surface is absent from the runtime catalog.", out error);

                HashSet<string> states = new HashSet<string>();
                foreach (SurfaceSemanticState state in semantic.States)
                {
                    if (state == null || !IsId(state.StateId) || !states.Add(state.StateId) || !catalogSurface.ReachableStateIds.Contains(state.StateId))
                        return Fail("delivery semantic surface state is invalid.", out error);
                }
                if (states.Count != catalogSurface.ReachableStateIds.Count)
                    return Fail("delivery semantic surface states are incomplete.", out error);
            }

            foreach (DeliveredRenderSurface render in profile.RenderSurfaces)
            {
                if (!TryAdd(renderSurfaces, render == null ? null : render.RenderSurfaceId, render, "render surface", out error)) return false;
                if (!IsId(render.SemanticSurfaceId) || !semanticSurfaces.ContainsKey(render.SemanticSurfaceId))
                    return Fail("delivery render surface references an unknown semantic surface.", out error);
                bool baked = render.RendererKind == RendererKind.BakedWeb;
                if (render.ArtifactContractVersion == 0 || capability.Renderers == null
                    || (baked ? capability.Renderers.BakedWeb == null || !capability.Renderers.BakedWeb.Supported
                        || capability.Renderers.BakedWeb.ContractVersion != render.ArtifactContractVersion
                        : render.RendererKind != RendererKind.NativeUi || capability.Renderers.NativeUi == null
                            || !capability.Renderers.NativeUi.Supported || capability.Renderers.NativeUi.ContractVersion != render.ArtifactContractVersion))
                    return Fail("delivery renderer capability is unsupported.", out error);

                ProjectedSurfaceDefinition catalogSurface = surfaces[render.SemanticSurfaceId];
                Dictionary<string, DeliveredArtifact> artifacts = new Dictionary<string, DeliveredArtifact>();
                foreach (DeliveredArtifact artifact in render.Artifacts)
                {
                    if (artifact == null || (baked ? artifact.ArtifactCase != DeliveredArtifact.ArtifactOneofCase.BakedWeb
                        || artifact.BakedWeb.ContractVersion != render.ArtifactContractVersion
                        : artifact.ArtifactCase != DeliveredArtifact.ArtifactOneofCase.NativeUi || artifact.NativeUi.ContractVersion != render.ArtifactContractVersion))
                        return Fail("delivery artifact kind or version is incompatible.", out error);
                    if (!TryAdd(artifacts, baked ? artifact.BakedWeb.ArtifactId : artifact.NativeUi.ArtifactId, artifact, "artifact", out error)) return false;
                    if (!baked && !TryValidateNativeUiArtifact(artifact.NativeUi, assets, out error)) return false;
                }

                HashSet<string> boundStates = new HashSet<string>();
                foreach (DeliveredStateBinding binding in render.StateBindings)
                {
                    if (binding == null || !IsId(binding.StateId) || !boundStates.Add(binding.StateId)
                        || !catalogSurface.ReachableStateIds.Contains(binding.StateId))
                        return Fail("delivery state binding is invalid or duplicated.", out error);
                    if (binding.BindingCase == DeliveredStateBinding.BindingOneofCase.Artifact
                        && (!IsId(binding.Artifact.ArtifactId) || !artifacts.ContainsKey(binding.Artifact.ArtifactId)))
                        return Fail("delivery state binding references an unknown artifact.", out error);
                    if (binding.BindingCase != DeliveredStateBinding.BindingOneofCase.Artifact
                        && binding.BindingCase != DeliveredStateBinding.BindingOneofCase.Empty)
                        return Fail("delivery state binding is incomplete.", out error);
                }
                if (boundStates.Count != catalogSurface.ReachableStateIds.Count)
                    return Fail("delivery state bindings are incomplete.", out error);
            }

            foreach (ProjectedSemanticSurface semantic in semanticSurfaces.Values)
            {
                if (semantic.RenderSurfaceIds.Count == 0) return Fail("delivery semantic surface has no render surface.", out error);
                HashSet<string> ids = new HashSet<string>();
                foreach (string id in semantic.RenderSurfaceIds)
                {
                    if (!IsId(id) || !ids.Add(id) || !renderSurfaces.TryGetValue(id, out DeliveredRenderSurface render)
                        || render.SemanticSurfaceId != semantic.SemanticSurfaceId)
                        return Fail("delivery semantic surface render reference is invalid.", out error);
                }
            }
            if (semanticSurfaces.Count != surfaces.Count)
                return Fail("delivery semantic surface graph is incomplete.", out error);
            foreach (DeliveredRenderSurface render in renderSurfaces.Values)
            {
                if (!semanticSurfaces[render.SemanticSurfaceId].RenderSurfaceIds.Contains(render.RenderSurfaceId))
                    return Fail("delivery render surface is not listed by its semantic surface.", out error);
            }
            error = null;
            return true;
        }

        private static bool TryValidateNativeUiArtifact(NativeUiArtifact artifact,
            Dictionary<string, AssetAccessBinding> assets, out string error)
        {
            if (artifact.RequiredFeatures.Count != 0)
            {
                return Fail("delivery native UI feature is unsupported by the local renderer.", out error);
            }

            HashSet<string> nodeIds = new HashSet<string>();
            foreach (NativeUiNode node in artifact.Nodes)
            {
                string id = node == null ? null : node.NodeCase == NativeUiNode.NodeOneofCase.Text ? node.Text.NodeId
                    : node.NodeCase == NativeUiNode.NodeOneofCase.Group ? node.Group.NodeId : null;
                if (!IsId(id) || !nodeIds.Add(id)) return Fail("delivery native UI artifact node is invalid.", out error);
                if (node.NodeCase == NativeUiNode.NodeOneofCase.Text)
                {
                    if (node.Text.Value == null || node.Text.Value.SourceCase != NativeTextValue.SourceOneofCase.Literal)
                        return Fail("delivery native UI text source is unsupported by the local renderer.", out error);

                    if (node.Text.Font != null)
                    {
                        if (node.Text.Font.Primary != null && !assets.ContainsKey(node.Text.Font.Primary.AssetId))
                            return Fail("delivery native UI font asset is absent.", out error);
                        foreach (FontFace fallback in node.Text.Font.Fallbacks)
                        {
                            if (fallback == null || !assets.ContainsKey(fallback.AssetId))
                                return Fail("delivery native UI fallback font asset is absent.", out error);
                        }
                    }
                }
            }
            if (!IsId(artifact.RootNodeId) || !nodeIds.Contains(artifact.RootNodeId))
                return Fail("delivery native UI artifact root is absent.", out error);
            error = null;
            return true;
        }

        internal static bool IsContentHash(string value)
        {
            if (value == null || value.Length != 71 || !value.StartsWith("sha256:", StringComparison.Ordinal)) return false;
            for (int index = 7; index < value.Length; index++)
            {
                char digit = value[index];
                if (!(digit >= '0' && digit <= '9' || digit >= 'a' && digit <= 'f')) return false;
            }
            return true;
        }

        private static bool TryAdd<T>(Dictionary<string, T> target, string id, T value, string kind, out string error)
        {
            if (!IsId(id) || value == null || target.ContainsKey(id)) { error = "delivery " + kind + " id is missing or duplicated."; return false; }
            target.Add(id, value); error = null; return true;
        }

        private static bool TryValidateTimeline(ProjectedTimelineDefinition timeline, Dictionary<string, ProjectedNodeDefinition> knownNodes, out string error)
        {
            if (timeline.DurationMs == 0 || timeline.Owner == null || timeline.Owner.ScopeCase == ResourceOwner.ScopeOneofCase.None || timeline.Tracks.Count == 0)
            {
                error = "delivery timeline is incomplete.";
                return false;
            }

            HashSet<string> claimedProperties = new HashSet<string>();
            foreach (ProjectedTimelineTrack track in timeline.Tracks)
            {
                if (track == null || track.Target == null || !IsId(track.Target.NodeId) || !knownNodes.ContainsKey(track.Target.NodeId) || track.Keyframes.Count < 2)
                {
                    error = "delivery timeline track is incomplete or references an unknown node.";
                    return false;
                }

                string claim = track.Target.NodeId + "\n" + (int)track.Target.Property;
                if (!claimedProperties.Add(claim))
                {
                    error = "delivery timeline tracks claim the same node property.";
                    return false;
                }

                if (track.Keyframes[0].TimeMs != 0 || track.Keyframes[track.Keyframes.Count - 1].TimeMs != timeline.DurationMs)
                {
                    error = "delivery timeline track is missing its boundary keyframes.";
                    return false;
                }

                ulong previousTimeMs = 0;
                for (int index = 0; index < track.Keyframes.Count; index++)
                {
                    TimelineKeyframe keyframe = track.Keyframes[index];
                    bool finalKeyframe = index == track.Keyframes.Count - 1;
                    if (keyframe == null || keyframe.TimeMs > timeline.DurationMs
                        || index > 0 && keyframe.TimeMs <= previousTimeMs
                        || !HasExpectedTimelineValue(track.Target.Property, keyframe)
                        || finalKeyframe == keyframe.HasEasingToNext
                        || !finalKeyframe && !IsSupportedEasing(keyframe.EasingToNext))
                    {
                        error = "delivery timeline keyframe is invalid.";
                        return false;
                    }

                    previousTimeMs = keyframe.TimeMs;
                }
            }

            if (PresentationAnimationPresetIds.IsBuiltIn(timeline.TimelineId)
                && !HasPresetOpacityTransition(timeline, PresentationAnimationPresetIds.IsFadeIn(timeline.TimelineId)))
            {
                error = "delivery animation preset must contain its matching opacity transition.";
                return false;
            }

            error = null;
            return true;
        }

        private static bool HasPresetOpacityTransition(ProjectedTimelineDefinition timeline, bool appearing)
        {
            foreach (ProjectedTimelineTrack track in timeline.Tracks)
            {
                if (track.Target.Property != TimelineProperty.Opacity || track.Keyframes.Count < 2)
                {
                    continue;
                }

                TimelineKeyframe first = track.Keyframes[0];
                TimelineKeyframe last = track.Keyframes[track.Keyframes.Count - 1];
                double expectedStart = appearing ? 0d : 1d;
                double expectedEnd = appearing ? 1d : 0d;
                return first.TimeMs == 0
                    && last.TimeMs == timeline.DurationMs
                    && first.ValueCase == TimelineKeyframe.ValueOneofCase.Number
                    && last.ValueCase == TimelineKeyframe.ValueOneofCase.Number
                    && Math.Abs(first.Number.Value - expectedStart) < 0.0001d
                    && Math.Abs(last.Number.Value - expectedEnd) < 0.0001d;
            }

            return false;
        }

        private static bool HasExpectedTimelineValue(TimelineProperty property, TimelineKeyframe keyframe)
        {
            if (property == TimelineProperty.Opacity && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Number)
            {
                return IsCanonicalFinite(keyframe.Number.Value) && keyframe.Number.Value >= 0 && keyframe.Number.Value <= 1;
            }

            if ((property == TimelineProperty.TransformPosition || property == TimelineProperty.TransformScale)
                && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Vector3 && keyframe.Vector3.Value != null)
            {
                Vector3 value = keyframe.Vector3.Value;
                return IsCanonicalFinite(value.X) && IsCanonicalFinite(value.Y) && IsCanonicalFinite(value.Z)
                    && (property == TimelineProperty.TransformPosition
                        ? PresentationUnityCoordinates.IsRenderable(value)
                        : PresentationUnityCoordinates.IsRenderableScale(value))
                    && (property != TimelineProperty.TransformScale || value.X > 0 && value.Y > 0 && value.Z > 0);
            }

            if (property == TimelineProperty.TransformRotation
                && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Quaternion && keyframe.Quaternion.Value != null)
            {
                Quaternion value = keyframe.Quaternion.Value;
                return IsCanonicalUnitQuaternion(value);
            }

            return false;
        }

        internal static bool IsFinite(double value) { return !Double.IsNaN(value) && !Double.IsInfinity(value); }

        internal static bool IsCanonicalFinite(double value) { return IsFinite(value) && (value != 0 || BitConverter.DoubleToInt64Bits(value) == 0); }

        internal static bool IsCanonicalUnitQuaternion(Quaternion value)
        {
            if (value == null || !IsCanonicalFinite(value.X) || !IsCanonicalFinite(value.Y)
                || !IsCanonicalFinite(value.Z) || !IsCanonicalFinite(value.W)) return false;
            double length = Math.Sqrt(value.X * value.X + value.Y * value.Y + value.Z * value.Z + value.W * value.W);
            return Math.Abs(length - 1) <= 1e-9
                && (value.W != 0 ? value.W > 0 : value.X != 0 ? value.X > 0 : value.Y != 0 ? value.Y > 0 : value.Z > 0);
        }

        private static bool IsSupportedEasing(Easing easing) { return easing == Easing.Linear || easing == Easing.CubicIn || easing == Easing.CubicOut || easing == Easing.CubicInOut; }

        internal static bool IsId(string value) { if (String.IsNullOrEmpty(value) || value.Length > 128 || !IsAsciiAlphaNumeric(value[0])) return false; for (int i = 1; i < value.Length; i++) { char c = value[i]; if (!IsAsciiAlphaNumeric(c) && c != '.' && c != '_' && c != ':' && c != '/' && c != '-') return false; } return true; }

        private static bool IsAsciiAlphaNumeric(char value) { return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z' || value >= '0' && value <= '9'; }

        private static bool Fail(string message, out string error) { error = message; return false; }

        private static string ModelClipKey(string modelNodeId, string clipId) { return modelNodeId + "\n" + clipId; }

        private static void Replace<T>(Dictionary<string, T> target, Dictionary<string, T> source) { target.Clear(); foreach (KeyValuePair<string, T> pair in source) target.Add(pair.Key, pair.Value); }

        private sealed class DeliveryIndexes
        {
            public readonly Dictionary<string, ProjectedNodeDefinition> Nodes = new Dictionary<string, ProjectedNodeDefinition>();
            public readonly Dictionary<string, ProjectedSurfaceDefinition> Surfaces = new Dictionary<string, ProjectedSurfaceDefinition>();
            public readonly Dictionary<string, AssetAccessBinding> Assets = new Dictionary<string, AssetAccessBinding>();
            public readonly Dictionary<string, ModelResidencyBinding> Models = new Dictionary<string, ModelResidencyBinding>();
            public readonly Dictionary<string, ProjectedTimelineDefinition> Timelines = new Dictionary<string, ProjectedTimelineDefinition>();
            public readonly Dictionary<string, ProjectedVariableDefinition> Variables = new Dictionary<string, ProjectedVariableDefinition>();
            public readonly Dictionary<string, ProjectedModelClipDefinition> ModelClips = new Dictionary<string, ProjectedModelClipDefinition>();
        }
    }
}
