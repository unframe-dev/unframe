using System;
using System.Collections.Generic;
using Google.Protobuf;
using Unframe.Delivery.V2;
using Unframe.Presentation.V2;
using Unframe.Realtime.V2;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class PresentationRuntimeStateStore
    {
        private const uint RealtimeSnapshotSchemaVersion = 2;

        private readonly PresentationDeliveryCatalog delivery;
        private readonly Dictionary<string, NodeRuntimeState> nodeStates = new Dictionary<string, NodeRuntimeState>();
        private readonly Dictionary<string, SurfaceRuntimeState> surfaceStates = new Dictionary<string, SurfaceRuntimeState>();
        private readonly Dictionary<string, VariableState> variableStates = new Dictionary<string, VariableState>();
        private readonly Dictionary<string, ModelClipRuntimeState> modelClipStates = new Dictionary<string, ModelClipRuntimeState>();
        private bool hasSnapshot;
        private ulong presentationOriginVersion;
        private ConnectionSnapshotEnvelope lastConnectionSnapshot;

        internal PresentationRuntimeStateStore(PresentationDeliveryCatalog delivery)
        {
            this.delivery = delivery;
        }

        internal ulong LastReliableSequence { get; private set; }
        internal ulong LastStateFrameSequence { get; private set; }

        internal void Reset()
        {
            nodeStates.Clear();
            surfaceStates.Clear();
            variableStates.Clear();
            modelClipStates.Clear();
            LastReliableSequence = 0;
            LastStateFrameSequence = 0;
            hasSnapshot = false;
            presentationOriginVersion = 0;
            lastConnectionSnapshot = null;
        }

        internal bool TryReceiveControl(byte[] payload, out string error)
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

        internal bool TryReceiveControl(ControlServerItem item, out string error)
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
                case ControlServerItem.ItemOneofCase.ProjectionAdvance:
                    return TryApplyProjectionAdvance(item.ProjectionAdvance, out error);
                case ControlServerItem.ItemOneofCase.ResyncRequired:
                    error = "realtime.control requires a new Delivery and connection snapshot.";
                    return false;
                default:
                    error = null;
                    return true;
            }
        }

        internal bool TryReceiveState(byte[] payload, out string error)
        {
            try
            {
                return TryReceiveState(StateServerItem.Parser.ParseFrom(payload), out error);
            }
            catch (InvalidProtocolBufferException exception)
            {
                error = "realtime.state.protobuf.invalid: " + exception.Message;
                return false;
            }
        }

        internal bool TryReceiveState(StateServerItem item, out string error)
        {
            if (item == null || item.ItemCase != StateServerItem.ItemOneofCase.StateFrame)
            {
                error = "realtime.state.state_frame is required.";
                return false;
            }

            return TryApplyStateFrame(item.StateFrame, out error);
        }

        internal bool TryGetNodeState(string id, out NodeRuntimeState value) { return nodeStates.TryGetValue(id, out value); }
        internal bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        internal bool TryGetVariableState(string id, out VariableState value) { return variableStates.TryGetValue(id, out value); }
        internal bool TryGetModelClipState(string modelNodeId, out ModelClipRuntimeState value) { return modelClipStates.TryGetValue(modelNodeId, out value); }
        internal bool TryGetLastConnectionSnapshot(out ConnectionSnapshotEnvelope snapshot)
        {
            snapshot = lastConnectionSnapshot == null ? null : lastConnectionSnapshot.Clone();
            return snapshot != null;
        }

        private bool TryApplySnapshot(ConnectionSnapshotEnvelope envelope, out string error)
        {
            if (delivery.Delivery == null || envelope == null || envelope.SchemaVersion != RealtimeSnapshotSchemaVersion
                || envelope.ProjectionInstance == null || !envelope.ProjectionInstance.Equals(delivery.Delivery.ProjectionInstance)
                || envelope.Snapshot == null || envelope.Snapshot.RuntimeView == null || !HasMatchingDeliveryFence(envelope.Fence))
            {
                error = "realtime.snapshot is missing, incompatible, or fenced for another delivery.";
                return false;
            }

            ParticipantRuntimeView view = envelope.Snapshot.RuntimeView;
            if (envelope.Snapshot.ProjectionProfileId != delivery.Delivery.ProjectionProfile.ProjectionProfileId
                || envelope.Snapshot.AssignmentEpoch != delivery.Delivery.ProjectionInstance.AssignmentEpoch
                || envelope.Snapshot.ReliableSequence != envelope.ReliableSequence
                || view.ProjectionProfileId != delivery.Delivery.ProjectionProfile.ProjectionProfileId
                || view.AssignmentEpoch != delivery.Delivery.ProjectionInstance.AssignmentEpoch
                || view.BaseReliableSequence != envelope.ReliableSequence
                || (view.PresentationOrigin == null ? 0 : view.PresentationOrigin.Version) != envelope.Fence.PresentationOriginVersion)
            {
                error = "realtime.snapshot projection does not match delivery.";
                return false;
            }

            if (!TryValidateSnapshotView(view, out error)
                || !TryReplaceRuntimeState(view.NodeStates, view.SurfaceStates, view.Variables, view.ModelClipStates, out error))
            {
                return false;
            }

            LastReliableSequence = envelope.ReliableSequence;
            LastStateFrameSequence = 0;
            presentationOriginVersion = envelope.Fence.PresentationOriginVersion;
            hasSnapshot = true;
            lastConnectionSnapshot = envelope.Clone();
            return true;
        }

        private bool TryApplyProjectionAdvance(ProjectionAdvance advance, out string error)
        {
            if (delivery.Delivery == null || advance == null || !HasMatchingFence(advance.Fence)
                || advance.FromExclusive != LastReliableSequence || advance.ThroughSequence <= advance.FromExclusive)
            {
                error = "realtime.projection_advance is missing, fenced for another delivery, or not contiguous.";
                return false;
            }

            LastReliableSequence = advance.ThroughSequence;
            error = null;
            return true;
        }

        private bool TryApplyReliableEvent(ProjectedReliableEvent reliableEvent, out string error)
        {
            if (delivery.Delivery == null)
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
                    if (!delivery.IsStateReachable(reliableEvent.SurfaceStateChanged.SurfaceId, reliableEvent.SurfaceStateChanged.StateId)) { error = "realtime.event references an unknown surface state."; return false; }
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
                    if (!PresentationDeliveryCatalog.IsId(timelineId) || !delivery.ContainsTimeline(timelineId)) { error = "realtime.event references an unknown timeline."; return false; }
                    break;
                default:
                    error = "realtime.event payload is unsupported; request a new snapshot.";
                    return false;
            }

            LastReliableSequence = reliableEvent.Sequence;
            error = null;
            return true;
        }

        private bool TryApplyStateFrame(ElementStateFrame frame, out string error)
        {
            if (delivery.Delivery == null || frame == null || frame.Kind == StateFrameKind.Unspecified || !HasMatchingFence(frame.Fence)
                || frame.BaseReliableSequence != LastReliableSequence || frame.FrameSequence == 0
                || frame.Kind != StateFrameKind.Keyframe && frame.Kind != StateFrameKind.Delta)
            {
                error = "realtime.state_frame is missing, incompatible, or depends on unapplied reliable state.";
                return false;
            }

            if (frame.FrameSequence <= LastStateFrameSequence)
            {
                error = null;
                return true;
            }

            if (LastStateFrameSequence == 0 && frame.Kind != StateFrameKind.Keyframe)
            {
                error = "realtime.state_frame must begin with a keyframe.";
                return false;
            }

            if (frame.Kind == StateFrameKind.Delta && frame.FrameSequence != LastStateFrameSequence + 1)
            {
                error = "realtime.state_frame delta sequence is not contiguous; request a new keyframe.";
                return false;
            }

            Dictionary<string, NodeRuntimeState> updates = new Dictionary<string, NodeRuntimeState>();
            foreach (ElementStatePatch patch in frame.Elements)
            {
                if (patch == null || patch.Node == null || !PresentationDeliveryCatalog.IsId(patch.ElementId) || !nodeStates.TryGetValue(patch.ElementId, out NodeRuntimeState current) || updates.ContainsKey(patch.ElementId))
                {
                    error = "realtime.state_frame references an unknown node, a node without a base state, or a duplicate patch.";
                    return false;
                }

                NodeStatePatch source = patch.Node;
                if (!IsValidStatePatch(source))
                {
                    error = "realtime.state_frame contains an empty or invalid node state patch.";
                    return false;
                }

                NodeRuntimeState updated = current.Clone();
                if (source.HasActive) updated.Active = source.Active;
                if (source.HasVisible) updated.Visible = source.Visible;
                if (source.HasOpacity) updated.Opacity = source.Opacity;
                if (source.Transform != null) updated.Transform = source.Transform.Clone();
                updates.Add(patch.ElementId, updated);
            }

            foreach (KeyValuePair<string, NodeRuntimeState> update in updates)
            {
                nodeStates[update.Key] = update.Value;
            }

            LastStateFrameSequence = frame.FrameSequence;
            error = null;
            return true;
        }

        private static bool IsValidStatePatch(NodeStatePatch patch)
        {
            if (patch == null || !patch.HasActive && !patch.HasVisible && !patch.HasOpacity && patch.Transform == null)
            {
                return false;
            }

            if (patch.HasOpacity && (!PresentationDeliveryCatalog.IsFinite(patch.Opacity) || patch.Opacity < 0 || patch.Opacity > 1))
            {
                return false;
            }

            if (patch.Transform == null)
            {
                return true;
            }

            return IsValidTransform(patch.Transform);
        }

        private static bool IsValidNodeRuntimeState(NodeRuntimeState state)
        {
            return state != null && PresentationDeliveryCatalog.IsId(state.NodeId)
                && PresentationDeliveryCatalog.IsFinite(state.Opacity) && state.Opacity >= 0 && state.Opacity <= 1
                && (state.Transform == null || IsValidTransform(state.Transform));
        }

        private static bool IsValidTransform(Unframe.Presentation.V2.Transform transform)
        {
            if (transform.Position == null || transform.Rotation == null || transform.Scale == null)
            {
                return false;
            }

            Unframe.Presentation.V2.Vector3 position = transform.Position;
            Unframe.Presentation.V2.Quaternion rotation = transform.Rotation;
            Unframe.Presentation.V2.Vector3 scale = transform.Scale;
            return PresentationDeliveryCatalog.IsFinite(position.X) && PresentationDeliveryCatalog.IsFinite(position.Y) && PresentationDeliveryCatalog.IsFinite(position.Z)
                && PresentationDeliveryCatalog.IsFinite(scale.X) && PresentationDeliveryCatalog.IsFinite(scale.Y) && PresentationDeliveryCatalog.IsFinite(scale.Z) && scale.X > 0 && scale.Y > 0 && scale.Z > 0
                && PresentationDeliveryCatalog.IsFinite(rotation.X) && PresentationDeliveryCatalog.IsFinite(rotation.Y) && PresentationDeliveryCatalog.IsFinite(rotation.Z) && PresentationDeliveryCatalog.IsFinite(rotation.W)
                && (rotation.X != 0 || rotation.Y != 0 || rotation.Z != 0 || rotation.W != 0);
        }

        private bool TryValidateSnapshotView(ParticipantRuntimeView view, out string error)
        {
            if (view.Clock == null || view.Clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.None
                || view.Progression == null || (view.Progression.PhaseCase == ProgressionRuntimeState.PhaseOneofCase.None
                    || !PresentationDeliveryCatalog.IsId(view.Progression.CurrentGroupId)
                    || !PresentationDeliveryCatalog.IsId(view.Progression.CurrentStepId)
                    || view.Progression.GroupEntryEpoch == 0 || view.Progression.StepEntryEpoch == 0))
            {
                error = "realtime snapshot clock or progression is incomplete.";
                return false;
            }

            HashSet<string> runIds = new HashSet<string>();
            Dictionary<string, RuntimeRunSnapshot> surfaceRuns = new Dictionary<string, RuntimeRunSnapshot>();
            Dictionary<string, RuntimeRunSnapshot> mediaRuns = new Dictionary<string, RuntimeRunSnapshot>();
            Dictionary<string, RuntimeRunSnapshot> modelRuns = new Dictionary<string, RuntimeRunSnapshot>();
            HashSet<string> blockingRuns = new HashSet<string>();
            foreach (RuntimeRunSnapshot run in view.ActiveRuns)
            {
                if (run == null || !IsValidRunId(run.RunId) || run.Owner == null
                    || run.Owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.None || run.Cause == null
                    || run.Completion != RunCompletion.Blocking && run.Completion != RunCompletion.NonBlocking
                    || run.RunCase == RuntimeRunSnapshot.RunOneofCase.None
                    || run.StartedAtRuntimeTimeMs > view.Clock.RuntimeTimeMs)
                {
                    error = "realtime snapshot contains an incomplete or unknown Run.";
                    return false;
                }

                switch (run.RunCase)
                {
                    case RuntimeRunSnapshot.RunOneofCase.SurfaceTransition:
                        if (!delivery.IsStateReachable(run.SurfaceTransition.SurfaceId, run.SurfaceTransition.FromStateId)
                            || !delivery.IsStateReachable(run.SurfaceTransition.SurfaceId, run.SurfaceTransition.ToStateId)
                            || !surfaceRuns.TryAdd(run.SurfaceTransition.SurfaceId, run))
                            return FailSnapshotReference(out error);
                        break;
                    case RuntimeRunSnapshot.RunOneofCase.Timeline:
                        if (!delivery.ContainsTimeline(run.Timeline.TimelineId)) return FailSnapshotReference(out error);
                        break;
                    case RuntimeRunSnapshot.RunOneofCase.Media:
                        if (!delivery.ContainsSurface(run.Media.SurfaceId)
                            || !IsValidPlaybackClock(run.Media.Playback, view.Clock.RuntimeTimeMs)
                            || !mediaRuns.TryAdd(run.Media.SurfaceId, run)) return FailSnapshotReference(out error);
                        break;
                    case RuntimeRunSnapshot.RunOneofCase.ModelClip:
                        if (!IsModelNode(run.ModelClip.ModelNodeId)
                            || run.ModelClip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.None
                            || !IsValidModelClipRun(run.ModelClip, view.Clock.RuntimeTimeMs)
                            || !modelRuns.TryAdd(run.ModelClip.ModelNodeId, run)) return FailSnapshotReference(out error);
                        break;
                    default:
                        error = "realtime snapshot Run variant is unsupported.";
                        return false;
                }

                if (!runIds.Add(RunKey(run.RunId)))
                {
                    error = "realtime snapshot contains duplicate Run IDs.";
                    return false;
                }
                if (run.Completion == RunCompletion.Blocking) blockingRuns.Add(RunKey(run.RunId));
            }

            foreach (SurfaceRuntimeState state in view.SurfaceStates)
            {
                if (state == null) return FailSnapshotReference(out error);
                bool hasRun = surfaceRuns.TryGetValue(state.SurfaceId, out RuntimeRunSnapshot run);
                if (hasRun != (state.TransitionRunId != null)
                    || hasRun && (!run.RunId.Equals(state.TransitionRunId)
                        || run.SurfaceTransition.ToStateId != state.StateId)) return FailSnapshotReference(out error);
                if (hasRun) surfaceRuns.Remove(state.SurfaceId);
            }
            if (surfaceRuns.Count != 0) return FailSnapshotReference(out error);

            HashSet<string> seenMedia = new HashSet<string>();
            foreach (MediaRuntimeState state in view.MediaStates)
            {
                if (state == null) return FailSnapshotReference(out error);
                if (!delivery.ContainsSurface(state.SurfaceId) || !seenMedia.Add(state.SurfaceId)
                    || state.StateCase == MediaRuntimeState.StateOneofCase.None
                    || state.StateCase == MediaRuntimeState.StateOneofCase.Stopped
                        && (!PresentationDeliveryCatalog.IsFinite(state.Stopped.HeldPositionMs) || state.Stopped.HeldPositionMs < 0))
                    return FailSnapshotReference(out error);
                bool hasRun = mediaRuns.TryGetValue(state.SurfaceId, out RuntimeRunSnapshot run);
                if (hasRun && (state.StateCase != MediaRuntimeState.StateOneofCase.Active
                        || !run.RunId.Equals(state.Active.RunId)
                        || state.Active.Playback == null || !state.Active.Playback.Equals(run.Media.Playback))
                    || !hasRun && state.StateCase == MediaRuntimeState.StateOneofCase.Active)
                    return FailSnapshotReference(out error);
                mediaRuns.Remove(state.SurfaceId);
            }
            if (mediaRuns.Count != 0) return FailSnapshotReference(out error);

            HashSet<string> seenModels = new HashSet<string>();
            foreach (ModelClipRuntimeState state in view.ModelClipStates)
            {
                if (state == null || !IsModelNode(state.ModelNodeId) || !seenModels.Add(state.ModelNodeId)
                    || state.StateCase == ModelClipRuntimeState.StateOneofCase.None)
                    return FailSnapshotReference(out error);
                bool hasRun = modelRuns.TryGetValue(state.ModelNodeId, out RuntimeRunSnapshot run);
                if (hasRun && (state.StateCase != ModelClipRuntimeState.StateOneofCase.Active || !run.RunId.Equals(state.Active.RunId))
                    || !hasRun && state.StateCase == ModelClipRuntimeState.StateOneofCase.Active)
                    return FailSnapshotReference(out error);
                modelRuns.Remove(state.ModelNodeId);
            }
            if (modelRuns.Count != 0) return FailSnapshotReference(out error);

            if (view.Progression.PhaseCase == ProgressionRuntimeState.PhaseOneofCase.Transitioning)
            {
                foreach (RuntimeRunId runId in view.Progression.Transitioning.BlockingRunIds)
                {
                    if (!IsValidRunId(runId) || !blockingRuns.Remove(RunKey(runId)))
                        return FailSnapshotReference(out error);
                }
            }
            if (blockingRuns.Count != 0) return FailSnapshotReference(out error);

            error = null;
            return true;
        }

        private bool IsModelNode(string id)
        {
            return delivery.TryGetNode(id, out ProjectedNodeDefinition node)
                && node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model;
        }

        private bool IsValidModelClipRun(ModelClipRunSnapshot run, ulong runtimeTimeMs)
        {
            if (run.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single)
                return IsValidClipPlayback(run.ModelNodeId, run.Single, runtimeTimeMs);
            if (run.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Crossfade || run.Crossfade == null
                || run.Crossfade.DurationMs == 0 || run.Crossfade.Easing == Easing.Unspecified
                || !Enum.IsDefined(typeof(Easing), run.Crossfade.Easing)
                || !IsValidClipPlayback(run.ModelNodeId, run.Crossfade.From, runtimeTimeMs, true)
                || !IsValidClipPlayback(run.ModelNodeId, run.Crossfade.To, runtimeTimeMs, true)
                || !IsValidPlaybackClock(run.Crossfade.TransitionClock, runtimeTimeMs)) return false;
            double elapsed = PlaybackPosition(run.Crossfade.TransitionClock, runtimeTimeMs, 1);
            return PresentationDeliveryCatalog.IsFinite(elapsed) && elapsed < run.Crossfade.DurationMs
                && (!run.Crossfade.FromIsHeld || run.Crossfade.From.Playback.ClockCase == PlaybackClock.ClockOneofCase.Paused);
        }

        private bool IsValidClipPlayback(string modelNodeId, ClipPlayback playback, ulong runtimeTimeMs, bool retainTerminalPose = false)
        {
            if (playback == null || !delivery.TryGetModelClip(modelNodeId, playback.ClipId, out ProjectedModelClipDefinition clip)
                || !PresentationDeliveryCatalog.IsFinite(playback.Speed) || playback.Speed <= 0
                || !IsValidPlaybackClock(playback.Playback, runtimeTimeMs))
                return false;
            double position = PlaybackPosition(playback.Playback, runtimeTimeMs, playback.Speed);
            return PresentationDeliveryCatalog.IsFinite(position) && (retainTerminalPose || playback.Loop || position < clip.DurationMs);
        }

        private static double PlaybackPosition(PlaybackClock playback, ulong runtimeTimeMs, double speed)
        {
            return playback.ClockCase == PlaybackClock.ClockOneofCase.Paused
                ? playback.Paused.PositionMs
                : playback.Playing.PositionAtReferenceMs + (runtimeTimeMs - playback.Playing.ReferenceRuntimeTimeMs) * speed;
        }

        private static bool IsValidPlaybackClock(PlaybackClock playback, ulong runtimeTimeMs)
        {
            return playback != null && (playback.ClockCase == PlaybackClock.ClockOneofCase.Paused
                    && PresentationDeliveryCatalog.IsFinite(playback.Paused.PositionMs)
                    && playback.Paused.PositionMs >= 0
                || playback.ClockCase == PlaybackClock.ClockOneofCase.Playing
                    && PresentationDeliveryCatalog.IsFinite(playback.Playing.PositionAtReferenceMs)
                    && playback.Playing.PositionAtReferenceMs >= 0
                    && playback.Playing.ReferenceRuntimeTimeMs <= runtimeTimeMs);
        }

        private bool IsValidRunId(RuntimeRunId runId)
        {
            return runId != null && runId.AssignmentEpoch == delivery.Delivery.ProjectionInstance.AssignmentEpoch
                && runId.RunSequence != 0;
        }

        private static string RunKey(RuntimeRunId runId)
        {
            return runId.AssignmentEpoch + ":" + runId.RunSequence;
        }

        private static bool FailSnapshotReference(out string error)
        {
            error = "realtime snapshot contains an unknown or inconsistent resource or Run reference.";
            return false;
        }

        private bool TryReplaceRuntimeState(IEnumerable<NodeRuntimeState> incomingNodes, IEnumerable<SurfaceRuntimeState> incomingSurfaces, IEnumerable<VariableState> incomingVariables, IEnumerable<ModelClipRuntimeState> incomingModelClips, out string error)
        {
            Dictionary<string, NodeRuntimeState> nextNodes = new Dictionary<string, NodeRuntimeState>();
            Dictionary<string, SurfaceRuntimeState> nextSurfaces = new Dictionary<string, SurfaceRuntimeState>();
            Dictionary<string, VariableState> nextVariables = new Dictionary<string, VariableState>();
            Dictionary<string, ModelClipRuntimeState> nextModelClips = new Dictionary<string, ModelClipRuntimeState>();
            foreach (NodeRuntimeState state in incomingNodes)
            {
                if (!IsValidNodeRuntimeState(state))
                {
                    error = "realtime snapshot contains an invalid node state.";
                    return false;
                }

                if (!TryAddState(nextNodes, state.NodeId, state.Clone(), delivery.ContainsNode(state.NodeId), out error)) return false;
            }

            foreach (SurfaceRuntimeState state in incomingSurfaces)
            {
                if (state == null || !delivery.IsStateReachable(state.SurfaceId, state.StateId))
                {
                    error = "realtime snapshot references an unknown surface state.";
                    return false;
                }

                if (!TryAddState(nextSurfaces, state == null ? null : state.SurfaceId, state == null ? null : state.Clone(), delivery.ContainsSurface(state == null ? null : state.SurfaceId), out error)) return false;
            }

            foreach (VariableState state in incomingVariables)
            {
                if (!TryAddState(nextVariables, state == null ? null : state.VariableId, state == null ? null : state.Clone(), delivery.ContainsVariable(state == null ? null : state.VariableId), out error)) return false;
            }

            foreach (ModelClipRuntimeState state in incomingModelClips)
            {
                if (!TryAddState(nextModelClips, state == null ? null : state.ModelNodeId, state == null ? null : state.Clone(), delivery.ContainsNode(state == null ? null : state.ModelNodeId), out error)) return false;
            }

            Replace(nodeStates, nextNodes);
            Replace(surfaceStates, nextSurfaces);
            Replace(variableStates, nextVariables);
            Replace(modelClipStates, nextModelClips);
            error = null;
            return true;
        }

        private bool TrySetNodeState(NodeRuntimeState state, out string error)
        {
            if (!IsValidNodeRuntimeState(state))
            {
                error = "realtime node state is invalid.";
                return false;
            }

            if (!delivery.ContainsNode(state.NodeId))
            {
                error = "realtime state id is missing or unknown.";
                return false;
            }

            nodeStates[state.NodeId] = state.Clone();
            error = null;
            return true;
        }

        private bool TrySetVariableState(VariableState state, out string error)
        {
            if (state == null || !PresentationDeliveryCatalog.IsId(state.VariableId) || !delivery.ContainsVariable(state.VariableId))
            {
                error = "realtime state id is missing or unknown.";
                return false;
            }

            variableStates[state.VariableId] = state.Clone();
            error = null;
            return true;
        }

        private bool HasMatchingFence(RuntimeProjectionFence fence)
        {
            return hasSnapshot && HasMatchingDeliveryFence(fence) && fence.PresentationOriginVersion == presentationOriginVersion;
        }

        private bool HasMatchingDeliveryFence(RuntimeProjectionFence fence)
        {
            return fence != null && delivery.Delivery != null && fence.SessionId == delivery.Delivery.SessionId && fence.AssignmentEpoch == delivery.Delivery.ProjectionInstance.AssignmentEpoch && fence.ProjectionProfileId == delivery.Delivery.ProjectionProfile.ProjectionProfileId && fence.Publication != null && delivery.Delivery.Publication != null && fence.Publication.Equals(delivery.Delivery.Publication);
        }

        private static bool TryAddState<T>(Dictionary<string, T> target, string id, T value, bool known, out string error) where T : class
        {
            if (!PresentationDeliveryCatalog.IsId(id) || value == null || !known || target.ContainsKey(id))
            {
                error = "realtime state id is missing, duplicated, or unknown.";
                return false;
            }

            target.Add(id, value);
            error = null;
            return true;
        }

        private static void Replace<T>(Dictionary<string, T> target, Dictionary<string, T> source)
        {
            target.Clear();
            foreach (KeyValuePair<string, T> pair in source)
            {
                target.Add(pair.Key, pair.Value);
            }
        }
    }
}
