using System;
using System.Collections.Generic;
using Google.Protobuf;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Read-only indexes over the Delivery projection and the latest projected Runtime state.
    /// It deliberately owns no Unity objects or rendering behaviour.
    /// </summary>
    public sealed class PresentationRuntimeDataStore
    {
        private const uint DeliverySchemaVersion = 2;
        private const uint DeliveryContractVersion = 2;
        private const uint RuntimeCatalogContractVersion = 2;
        private const uint RealtimeSnapshotSchemaVersion = 2;

        private readonly Dictionary<string, ProjectedNodeDefinition> nodes = new Dictionary<string, ProjectedNodeDefinition>();
        private readonly Dictionary<string, ProjectedSurfaceDefinition> surfaces = new Dictionary<string, ProjectedSurfaceDefinition>();
        private readonly Dictionary<string, AssetAccessBinding> assets = new Dictionary<string, AssetAccessBinding>();
        private readonly Dictionary<string, ModelResidencyBinding> models = new Dictionary<string, ModelResidencyBinding>();
        private readonly Dictionary<string, ProjectedTimelineDefinition> timelines = new Dictionary<string, ProjectedTimelineDefinition>();
        private readonly Dictionary<string, ProjectedVariableDefinition> variables = new Dictionary<string, ProjectedVariableDefinition>();
        private readonly Dictionary<string, ProjectedModelClipDefinition> modelClips = new Dictionary<string, ProjectedModelClipDefinition>();
        private readonly Dictionary<string, NodeRuntimeState> nodeStates = new Dictionary<string, NodeRuntimeState>();
        private readonly Dictionary<string, SurfaceRuntimeState> surfaceStates = new Dictionary<string, SurfaceRuntimeState>();
        private readonly Dictionary<string, VariableState> variableStates = new Dictionary<string, VariableState>();
        private readonly Dictionary<string, ModelClipRuntimeState> modelClipStates = new Dictionary<string, ModelClipRuntimeState>();

        public DeliveryManifest Delivery { get; private set; }
        public ulong LastReliableSequence { get; private set; }
        public ulong LastStateFrameSequence { get; private set; }
        public IEnumerable<ProjectedNodeDefinition> Nodes { get { return nodes.Values; } }

        public bool TryReceiveDelivery(byte[] payload, out string error)
        {
            try
            {
                return TryReceiveDelivery(DeliveryManifest.Parser.ParseFrom(payload), out error);
            }
            catch (InvalidProtocolBufferException exception)
            {
                error = "delivery.protobuf.invalid: " + exception.Message;
                return false;
            }
        }

        public bool TryReceiveDelivery(DeliveryManifest manifest, out string error)
        {
            if (!TryBuildDeliveryIndexes(manifest, out DeliveryIndexes indexes, out error))
            {
                return false;
            }

            Delivery = manifest;
            Replace(nodes, indexes.Nodes);
            Replace(surfaces, indexes.Surfaces);
            Replace(assets, indexes.Assets);
            Replace(models, indexes.Models);
            Replace(timelines, indexes.Timelines);
            Replace(variables, indexes.Variables);
            Replace(modelClips, indexes.ModelClips);
            nodeStates.Clear();
            surfaceStates.Clear();
            variableStates.Clear();
            modelClipStates.Clear();
            LastReliableSequence = 0;
            LastStateFrameSequence = 0;
            error = null;
            return true;
        }

        public bool TryReceiveControl(byte[] payload, out string error)
        {
            try
            {
                return TryReceiveControl(ControlServerItem.Parser.ParseFrom(payload), out error);
            }
            catch (InvalidProtocolBufferException exception)
            {
                error = "realtime.control.protobuf.invalid: " + exception.Message;
                return false;
            }
        }

        public bool TryReceiveControl(ControlServerItem item, out string error)
        {
            if (item == null || item.ItemCase == ControlServerItem.ItemOneofCase.None)
            {
                error = "realtime.control.item is required.";
                return false;
            }

            switch (item.ItemCase)
            {
                case ControlServerItem.ItemOneofCase.ConnectionSnapshot:
                    return TryApplySnapshot(item.ConnectionSnapshot, out error);
                case ControlServerItem.ItemOneofCase.ReliableEvent:
                    return TryApplyReliableEvent(item.ReliableEvent, out error);
                default:
                    error = null;
                    return true;
            }
        }

        public bool TryReceiveState(byte[] payload, out string error)
        {
            try
            {
                StateServerItem item = StateServerItem.Parser.ParseFrom(payload);
                if (item.ItemCase != StateServerItem.ItemOneofCase.StateFrame)
                {
                    error = "realtime.state.state_frame is required.";
                    return false;
                }

                return TryApplyStateFrame(item.StateFrame, out error);
            }
            catch (InvalidProtocolBufferException exception)
            {
                error = "realtime.state.protobuf.invalid: " + exception.Message;
                return false;
            }
        }

        public bool TryGetNode(string id, out ProjectedNodeDefinition value) { return nodes.TryGetValue(id, out value); }
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { return surfaces.TryGetValue(id, out value); }
        public bool TryGetAsset(string id, out AssetAccessBinding value) { return assets.TryGetValue(id, out value); }
        public bool TryGetModel(string assetId, out ModelResidencyBinding value) { return models.TryGetValue(assetId, out value); }
        public bool TryGetTimeline(string id, out ProjectedTimelineDefinition value) { return timelines.TryGetValue(id, out value); }
        public bool TryGetVariable(string id, out ProjectedVariableDefinition value) { return variables.TryGetValue(id, out value); }
        public bool TryGetModelClip(string modelNodeId, string clipId, out ProjectedModelClipDefinition value) { return modelClips.TryGetValue(ModelClipKey(modelNodeId, clipId), out value); }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { return nodeStates.TryGetValue(id, out value); }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        public bool TryGetVariableState(string id, out VariableState value) { return variableStates.TryGetValue(id, out value); }
        public bool TryGetModelClipState(string modelNodeId, out ModelClipRuntimeState value) { return modelClipStates.TryGetValue(modelNodeId, out value); }

        private bool TryApplySnapshot(ConnectionSnapshotEnvelope envelope, out string error)
        {
            if (Delivery == null || envelope == null || envelope.SchemaVersion != RealtimeSnapshotSchemaVersion || envelope.Snapshot == null || envelope.Snapshot.RuntimeView == null || !HasMatchingFence(envelope.Fence))
            {
                error = "realtime.snapshot is missing, incompatible, or fenced for another delivery.";
                return false;
            }

            ParticipantRuntimeView view = envelope.Snapshot.RuntimeView;
            if (view.ProjectionProfileId != Delivery.ProjectionProfile.ProjectionProfileId || view.AssignmentEpoch != Delivery.ProjectionInstance.AssignmentEpoch)
            {
                error = "realtime.snapshot projection does not match delivery.";
                return false;
            }

            if (!TryReplaceRuntimeState(view.NodeStates, view.SurfaceStates, view.Variables, view.ModelClipStates, out error))
            {
                return false;
            }

            LastReliableSequence = envelope.ReliableSequence;
            LastStateFrameSequence = 0;
            return true;
        }

        private bool TryApplyReliableEvent(ProjectedReliableEvent reliableEvent, out string error)
        {
            if (Delivery == null)
            {
                error = "realtime.event cannot be applied before a Delivery is loaded.";
                return false;
            }

            if (reliableEvent == null || reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.None)
            {
                error = "realtime.event payload is missing.";
                return false;
            }

            if (!HasMatchingFence(reliableEvent.Fence))
            {
                error = "realtime.event fence does not match the loaded Delivery. Reload Local Presentation and retry.";
                return false;
            }

            if (reliableEvent.Sequence != LastReliableSequence + 1)
            {
                error = "realtime.event sequence is not contiguous; request a snapshot or replay.";
                return false;
            }

            switch (reliableEvent.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.NodeStateCommitted:
                    if (!TrySetNodeState(reliableEvent.NodeStateCommitted.State, out error)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceStateChanged:
                    if (!surfaces.ContainsKey(reliableEvent.SurfaceStateChanged.SurfaceId)) { error = "realtime.event references an unknown surface."; return false; }
                    surfaceStates[reliableEvent.SurfaceStateChanged.SurfaceId] = new SurfaceRuntimeState { SurfaceId = reliableEvent.SurfaceStateChanged.SurfaceId, StateId = reliableEvent.SurfaceStateChanged.StateId };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.VariableChanged:
                    if (!TrySetVariableState(reliableEvent.VariableChanged.State, out error)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.TimelineStarted:
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted:
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCanceled:
                    string timelineId = reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.TimelineStarted
                        ? reliableEvent.TimelineStarted.TimelineId
                        : reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted
                            ? reliableEvent.TimelineCompleted.TimelineId
                            : reliableEvent.TimelineCanceled.TimelineId;
                    if (!timelines.ContainsKey(timelineId)) { error = "realtime.event references an unknown timeline."; return false; }
                    break;
            }

            LastReliableSequence = reliableEvent.Sequence;
            error = null;
            return true;
        }

        private bool TryApplyStateFrame(ElementStateFrame frame, out string error)
        {
            if (Delivery == null || frame == null || frame.Kind == StateFrameKind.Unspecified || !HasMatchingFence(frame.Fence) || frame.BaseReliableSequence > LastReliableSequence)
            {
                error = "realtime.state_frame is missing, incompatible, or depends on unapplied reliable state.";
                return false;
            }

            if (frame.FrameSequence <= LastStateFrameSequence)
            {
                error = null;
                return true;
            }

            foreach (ElementStatePatch patch in frame.Elements)
            {
                if (patch == null || patch.Node == null || !nodeStates.TryGetValue(patch.ElementId, out NodeRuntimeState current))
                {
                    error = "realtime.state_frame references a node without a base state.";
                    return false;
                }

                NodeStatePatch source = patch.Node;
                NodeRuntimeState updated = current.Clone();
                if (source.HasActive) updated.Active = source.Active;
                if (source.HasVisible) updated.Visible = source.Visible;
                if (source.HasOpacity) updated.Opacity = source.Opacity;
                if (source.Transform != null) updated.Transform = source.Transform;
                nodeStates[patch.ElementId] = updated;
            }

            LastStateFrameSequence = frame.FrameSequence;
            error = null;
            return true;
        }

        private bool TryReplaceRuntimeState(IEnumerable<NodeRuntimeState> incomingNodes, IEnumerable<SurfaceRuntimeState> incomingSurfaces, IEnumerable<VariableState> incomingVariables, IEnumerable<ModelClipRuntimeState> incomingModelClips, out string error)
        {
            Dictionary<string, NodeRuntimeState> nextNodes = new Dictionary<string, NodeRuntimeState>();
            Dictionary<string, SurfaceRuntimeState> nextSurfaces = new Dictionary<string, SurfaceRuntimeState>();
            Dictionary<string, VariableState> nextVariables = new Dictionary<string, VariableState>();
            Dictionary<string, ModelClipRuntimeState> nextModelClips = new Dictionary<string, ModelClipRuntimeState>();
            foreach (NodeRuntimeState state in incomingNodes) if (!TryAddState(nextNodes, state == null ? null : state.NodeId, state, nodes, out error)) return false;
            foreach (SurfaceRuntimeState state in incomingSurfaces) if (!TryAddState(nextSurfaces, state == null ? null : state.SurfaceId, state, surfaces, out error)) return false;
            foreach (VariableState state in incomingVariables) if (!TryAddState(nextVariables, state == null ? null : state.VariableId, state, variables, out error)) return false;
            foreach (ModelClipRuntimeState state in incomingModelClips) if (!TryAddState(nextModelClips, state == null ? null : state.ModelNodeId, state, nodes, out error)) return false;
            Replace(nodeStates, nextNodes); Replace(surfaceStates, nextSurfaces); Replace(variableStates, nextVariables); Replace(modelClipStates, nextModelClips);
            error = null;
            return true;
        }

        private bool TrySetNodeState(NodeRuntimeState state, out string error)
        {
            if (state == null || !nodes.ContainsKey(state.NodeId))
            {
                error = "realtime state id is missing or unknown.";
                return false;
            }

            nodeStates[state.NodeId] = state;
            error = null;
            return true;
        }

        private bool TrySetVariableState(VariableState state, out string error)
        {
            if (state == null || !variables.ContainsKey(state.VariableId))
            {
                error = "realtime state id is missing or unknown.";
                return false;
            }

            variableStates[state.VariableId] = state;
            error = null;
            return true;
        }

        private bool HasMatchingFence(RuntimeProjectionFence fence)
        {
            return fence != null && Delivery != null && fence.SessionId == Delivery.SessionId && fence.AssignmentEpoch == Delivery.ProjectionInstance.AssignmentEpoch && fence.ProjectionProfileId == Delivery.ProjectionProfile.ProjectionProfileId && fence.Publication != null && Delivery.Publication != null && fence.Publication.Equals(Delivery.Publication);
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
            if (catalog.CatalogContractVersion != RuntimeCatalogContractVersion || !IsId(manifest.ProjectionProfile.ProjectionProfileId) || manifest.ProjectionInstance.ProjectionProfileId != manifest.ProjectionProfile.ProjectionProfileId || manifest.ProjectionProfile.Key == null || manifest.ProjectionProfile.Key.CapabilityProfileId != manifest.CapabilityProfile.CapabilityProfileId)
            {
                error = "delivery projection profile is incompatible.";
                return false;
            }

            DeliveryIndexes next = new DeliveryIndexes();
            foreach (ProjectedNodeDefinition node in catalog.Nodes)
            {
                if (!TryAdd(next.Nodes, node == null ? null : node.NodeId, node, "node", out error)) return false;
                if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.None || node.Parent == null || node.Parent.ParentCase == SpatialParent.ParentOneofCase.None) return Fail("delivery node is incomplete.", out error);
            }
            foreach (ProjectedNodeDefinition node in catalog.Nodes) if (node.Parent.ParentCase == SpatialParent.ParentOneofCase.Node && !next.Nodes.ContainsKey(node.Parent.Node.NodeId)) return Fail("delivery node parent is absent.", out error);
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces)
            {
                if (!TryAdd(next.Surfaces, surface == null ? null : surface.SurfaceId, surface, "surface", out error)) return false;
                if (!next.Nodes.ContainsKey(surface.HostNodeId)) return Fail("delivery surface host node is absent.", out error);
            }
            foreach (AssetAccessBinding asset in manifest.AssetAccess) if (!TryAdd(next.Assets, asset == null ? null : asset.AssetId, asset, "asset", out error)) return false;
            if (manifest.Residency.Models == null) return Fail("delivery model residency is required.", out error);
            foreach (ModelResidencyBinding model in manifest.Residency.Models.Models)
            {
                if (!TryAdd(next.Models, model == null ? null : model.AssetId, model, "model", out error)) return false;
                if (!next.Assets.ContainsKey(model.AssetId)) return Fail("delivery model asset is absent.", out error);
            }
            foreach (ProjectedTimelineDefinition timeline in catalog.Timelines)
            {
                if (!TryAdd(next.Timelines, timeline == null ? null : timeline.TimelineId, timeline, "timeline", out error)) return false;
                if (!TryValidateTimeline(timeline, next.Nodes, out error)) return false;
            }
            foreach (ProjectedVariableDefinition variable in catalog.Variables) if (!TryAdd(next.Variables, variable == null ? null : variable.VariableId, variable, "variable", out error)) return false;
            foreach (ProjectedModelClipDefinition clip in catalog.ModelClips)
            {
                if (clip == null || !IsId(clip.ModelNodeId) || !IsId(clip.ClipId) || next.ModelClips.ContainsKey(ModelClipKey(clip.ModelNodeId, clip.ClipId))) return Fail("delivery model clip id is missing or duplicated.", out error);
                next.ModelClips.Add(ModelClipKey(clip.ModelNodeId, clip.ClipId), clip);
                if (!next.Nodes.ContainsKey(clip.ModelNodeId) || !next.Assets.ContainsKey(clip.ModelAssetId)) return Fail("delivery model clip reference is absent.", out error);
            }
            indexes = next;
            error = null;
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

            foreach (ProjectedTimelineTrack track in timeline.Tracks)
            {
                if (track == null || track.Target == null || !knownNodes.ContainsKey(track.Target.NodeId) || track.Keyframes.Count == 0)
                {
                    error = "delivery timeline track is incomplete or references an unknown node.";
                    return false;
                }

                ulong previousTimeMs = 0;
                for (int index = 0; index < track.Keyframes.Count; index++)
                {
                    TimelineKeyframe keyframe = track.Keyframes[index];
                    if (keyframe == null || keyframe.TimeMs > timeline.DurationMs || index > 0 && keyframe.TimeMs < previousTimeMs || !HasExpectedTimelineValue(track.Target.Property, keyframe))
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
            return property == TimelineProperty.Opacity && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Number
                || (property == TimelineProperty.TransformPosition || property == TimelineProperty.TransformScale) && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Vector3
                || property == TimelineProperty.TransformRotation && keyframe.ValueCase == TimelineKeyframe.ValueOneofCase.Quaternion;
        }

        private static bool TryAddState<T>(Dictionary<string, T> target, string id, T value, Dictionary<string, ProjectedNodeDefinition> known, out string error) where T : class { return TryAddStateCore(target, id, value, known.ContainsKey(id), out error); }
        private static bool TryAddState<T>(Dictionary<string, T> target, string id, T value, Dictionary<string, ProjectedSurfaceDefinition> known, out string error) where T : class { return TryAddStateCore(target, id, value, known.ContainsKey(id), out error); }
        private static bool TryAddState<T>(Dictionary<string, T> target, string id, T value, Dictionary<string, ProjectedVariableDefinition> known, out string error) where T : class { return TryAddStateCore(target, id, value, known.ContainsKey(id), out error); }
        private static bool TryAddStateCore<T>(Dictionary<string, T> target, string id, T value, bool known, out string error) where T : class { if (!IsId(id) || value == null || !known || target.ContainsKey(id)) { error = "realtime state id is missing, duplicated, or unknown."; return false; } target.Add(id, value); error = null; return true; }
        private static bool IsId(string value) { if (String.IsNullOrEmpty(value) || value.Length > 128 || !IsAsciiAlphaNumeric(value[0])) return false; for (int i = 1; i < value.Length; i++) { char c = value[i]; if (!IsAsciiAlphaNumeric(c) && c != '.' && c != '_' && c != ':' && c != '/' && c != '-') return false; } return true; }
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
