using System;
using System.Collections.Generic;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Entry point combining the validated Delivery catalog with the latest projected Runtime state.
    /// It owns no Unity objects or rendering behaviour.
    /// </summary>
    public sealed class PresentationRuntimeDataStore : IPresentationRenderView
    {
        private readonly PresentationDeliveryCatalog delivery = new PresentationDeliveryCatalog();
        private readonly PresentationRuntimeStateStore runtime;

        public PresentationRuntimeDataStore()
        {
            runtime = new PresentationRuntimeStateStore(delivery);
        }

        public ProjectedRuntimeCatalog Catalog { get { return Delivery?.ProjectionProfile?.RuntimeCatalog; } }
        public IEnumerable<DeliveredRenderSurface> RenderSurfaces { get { return Delivery?.ProjectionProfile?.RenderSurfaces ?? (IEnumerable<DeliveredRenderSurface>)Array.Empty<DeliveredRenderSurface>(); } }
        public IEnumerable<ProjectedSemanticSurface> SemanticSurfaces { get { return Delivery?.ProjectionProfile?.SemanticSurfaces ?? (IEnumerable<ProjectedSemanticSurface>)Array.Empty<ProjectedSemanticSurface>(); } }
        public Pose StageOrigin { get { return runtime.PresentationOrigin?.Pose; } }
        public DeliveryManifest Delivery { get { return delivery.Delivery; } }
        public ulong LastReliableSequence { get { return runtime.LastReliableSequence; } }
        public ulong LastStateFrameSequence { get { return runtime.LastStateFrameSequence; } }
        public PresentationOrigin PresentationOrigin { get { return runtime.PresentationOrigin; } }
        public IEnumerable<ProjectedParticipantPresence> Participants { get { return runtime.Participants; } }
        public RuntimeClockSnapshot RuntimeClock { get { return runtime.RuntimeClock; } }
        public ProgressionRuntimeState Progression { get { return runtime.Progression; } }
        public IEnumerable<RuntimeRunSnapshot> ActiveRuns { get { return runtime.ActiveRuns; } }
        public IEnumerable<ProjectedNodeDefinition> Nodes { get { return delivery.Nodes; } }

        public bool TryValidateRuntimeOwnership(out string error)
        {
            error = "realtime snapshot runtime ownership is incomplete.";
            ProgressionRuntimeState progression = runtime.Progression;
            if (Delivery == null || progression == null) return false;
            ProjectedRuntimeCatalog catalog = Delivery.ProjectionProfile.RuntimeCatalog;
            foreach (ProjectedNodeDefinition node in catalog.Nodes)
                if (!TryIsOwned(node.Owner, progression.CurrentGroupId, out bool owned)
                    || owned != runtime.TryGetNodeState(node.NodeId, out NodeRuntimeState state)
                    || owned && state.Transform == null) return false;
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces)
                if (!TryIsOwned(surface.Owner, progression.CurrentGroupId, out bool owned) || owned != runtime.TryGetSurfaceState(surface.SurfaceId, out _)) return false;
            foreach (ProjectedVariableDefinition variable in catalog.Variables)
                if (!TryIsOwned(variable.Owner, progression.CurrentGroupId, out bool owned)
                    || owned != runtime.TryGetVariableState(variable.VariableId, out VariableState state)
                    || owned && !IsValidScalar(variable.Type, state.Value)) return false;
            error = null;
            return true;
        }

        private static bool IsValidScalar(ScalarType type, ScalarValue value)
        {
            if (value == null) return false;
            switch (type)
            {
                case ScalarType.String: return value.ValueCase == ScalarValue.ValueOneofCase.StringValue;
                case ScalarType.Number:
                    return value.ValueCase == ScalarValue.ValueOneofCase.NumberValue
                        && PresentationDeliveryCatalog.IsCanonicalFinite(value.NumberValue);
                case ScalarType.Boolean: return value.ValueCase == ScalarValue.ValueOneofCase.BooleanValue;
                case ScalarType.Null: return value.ValueCase == ScalarValue.ValueOneofCase.NullValue;
                default: return false;
            }
        }

        private static bool TryIsOwned(ResourceOwner owner, string groupId, out bool owned)
        {
            owned = owner != null && (owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && owner.Group.GroupId == groupId);
            return owner != null && (owner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && !string.IsNullOrEmpty(owner.Group.GroupId));
        }

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
            if (!delivery.TryLoad(manifest, out error))
            {
                return false;
            }

            runtime.Reset();
            return true;
        }

        public bool TryReceiveControl(byte[] payload, out string error) { return runtime.TryReceiveControl(payload, out error); }
        public bool TryReceiveControl(ControlServerItem item, out string error) { return runtime.TryReceiveControl(item, out error); }
        public bool TryReceiveNetworkControl(ControlServerItem item, out string error)
        {
            ProjectedReliableEvent reliableEvent = item?.ReliableEvent;
            ResourceOwner eventOwner = null;
            bool hasOwnedResourceEvent = false;
            if (reliableEvent?.NodeStateCommitted != null)
            {
                string nodeId = reliableEvent.NodeStateCommitted.State?.NodeId;
                if (!PresentationDeliveryCatalog.IsId(nodeId) || !delivery.TryGetNode(nodeId, out ProjectedNodeDefinition node))
                { error = "realtime control references an unknown node."; return false; }
                eventOwner = node.Owner;
                hasOwnedResourceEvent = true;
            }
            else if (reliableEvent?.SurfaceStateChanged != null)
            {
                string surfaceId = reliableEvent.SurfaceStateChanged.SurfaceId;
                if (!PresentationDeliveryCatalog.IsId(surfaceId) || !delivery.TryGetSurface(surfaceId, out ProjectedSurfaceDefinition surface))
                { error = "realtime control references an unknown surface."; return false; }
                eventOwner = surface.Owner;
                hasOwnedResourceEvent = true;
            }
            else if (reliableEvent?.VariableChanged != null)
            {
                string variableId = reliableEvent.VariableChanged.State?.VariableId;
                if (!PresentationDeliveryCatalog.IsId(variableId) || !delivery.TryGetVariable(variableId, out ProjectedVariableDefinition variable))
                { error = "realtime control references an unknown variable."; return false; }
                eventOwner = variable.Owner;
                hasOwnedResourceEvent = true;
            }
            if (hasOwnedResourceEvent && (!TryIsOwned(eventOwner, runtime.Progression?.CurrentGroupId, out bool owned) || !owned))
            { error = "realtime control references an inactive group resource."; return false; }
            error = "realtime control contains an invalid scalar value.";
            IEnumerable<VariableState> states = null;
            if (item?.ConnectionSnapshot?.Snapshot?.RuntimeView != null)
                states = item.ConnectionSnapshot.Snapshot.RuntimeView.Variables;
            else if (item?.ReliableEvent?.VariableChanged != null)
                states = new[] { item.ReliableEvent.VariableChanged.State };
            else if (item?.ReliableEvent?.GroupEntered?.Initialization != null)
                states = item.ReliableEvent.GroupEntered.Initialization.Variables;
            if (states != null)
                foreach (VariableState state in states)
                    if (state == null || !delivery.TryGetVariable(state.VariableId, out ProjectedVariableDefinition definition)
                        || !IsValidScalar(definition.Type, state.Value)) return false;
            return runtime.TryReceiveControl(item, out error);
        }
        internal void ResetStateStream() { runtime.ResetStateStream(); }

        public bool TryValidateNetworkStateFrame(ElementStateFrame frame, out string error) { return runtime.TryValidateNetworkStateFrame(frame, out error); }
        public bool TryReceiveState(byte[] payload, out string error) { return runtime.TryReceiveState(payload, out error); }
        public bool TryReceiveState(StateServerItem item, out string error) { return runtime.TryReceiveState(item, out error); }

        public bool TryGetNode(string id, out ProjectedNodeDefinition value) { return delivery.TryGetNode(id, out value); }
        public bool TryGetSurface(string id, out ProjectedSurfaceDefinition value) { return delivery.TryGetSurface(id, out value); }
        public bool TryGetAsset(string id, out AssetAccessBinding value) { return delivery.TryGetAsset(id, out value); }
        public bool TryGetModel(string assetId, out ModelResidencyBinding value) { return delivery.TryGetModel(assetId, out value); }
        public bool TryGetTimeline(string id, out ProjectedTimelineDefinition value) { return delivery.TryGetTimeline(id, out value); }
        public bool TryGetVariable(string id, out ProjectedVariableDefinition value) { return delivery.TryGetVariable(id, out value); }
        public bool TryGetModelClip(string modelNodeId, string clipId, out ProjectedModelClipDefinition value) { return delivery.TryGetModelClip(modelNodeId, clipId, out value); }
        public bool TryGetNodeState(string id, out NodeRuntimeState value) { return runtime.TryGetNodeState(id, out value); }
        public bool TryGetAnchorSample(string nodeId, out ProjectedAnchorBindingSample value) { return runtime.TryGetAnchorSample(nodeId, out value); }
        internal void InvalidateAnchorSamples() { runtime.InvalidateAnchorSamples(); }
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return runtime.TryGetSurfaceState(id, out value); }
        public bool TryGetVariableState(string id, out VariableState value) { return runtime.TryGetVariableState(id, out value); }
        public bool TryGetModelClipState(string modelNodeId, out ModelClipRuntimeState value) { return runtime.TryGetModelClipState(modelNodeId, out value); }
        /// <summary>Returns a copy of the last accepted snapshot cut, without later events or state frames.</summary>
        public bool TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot) { return runtime.TryGetLastConnectionSnapshot(out snapshot); }
    }
}
