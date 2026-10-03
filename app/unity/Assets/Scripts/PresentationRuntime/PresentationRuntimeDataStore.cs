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
    public sealed class PresentationRuntimeDataStore
    {
        private readonly PresentationDeliveryCatalog delivery = new PresentationDeliveryCatalog();
        private readonly PresentationRuntimeStateStore runtime;

        public PresentationRuntimeDataStore()
        {
            runtime = new PresentationRuntimeStateStore(delivery);
        }

        public DeliveryManifest Delivery { get { return delivery.Delivery; } }
        public ulong LastReliableSequence { get { return runtime.LastReliableSequence; } }
        public ulong LastStateFrameSequence { get { return runtime.LastStateFrameSequence; } }
        public IEnumerable<ProjectedNodeDefinition> Nodes { get { return delivery.Nodes; } }

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
        public bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return runtime.TryGetSurfaceState(id, out value); }
        public bool TryGetVariableState(string id, out VariableState value) { return runtime.TryGetVariableState(id, out value); }
        public bool TryGetModelClipState(string modelNodeId, out ModelClipRuntimeState value) { return runtime.TryGetModelClipState(modelNodeId, out value); }
    }
}
