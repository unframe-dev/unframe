using System;
using System.Collections.Generic;
using System.Diagnostics;
using Google.Protobuf;
using Unframe.Delivery;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    internal sealed class PresentationRuntimeStateStore
    {
        private const uint RealtimeSnapshotSchemaVersion = 3;

        private readonly PresentationDeliveryCatalog delivery;
        private readonly Dictionary<string, NodeRuntimeState> nodeStates = new Dictionary<string, NodeRuntimeState>();
        private readonly Dictionary<string, SurfaceRuntimeState> surfaceStates = new Dictionary<string, SurfaceRuntimeState>();
        private readonly Dictionary<string, VariableState> variableStates = new Dictionary<string, VariableState>();
        private readonly Dictionary<string, MediaRuntimeState> mediaStates = new Dictionary<string, MediaRuntimeState>();
        private readonly Dictionary<string, ModelClipRuntimeState> modelClipStates = new Dictionary<string, ModelClipRuntimeState>();
        private readonly Dictionary<string, AnchorSampleState> anchorSamples = new Dictionary<string, AnchorSampleState>();
        private readonly Dictionary<string, FrozenAnchorDisplayState> frozenAnchors = new Dictionary<string, FrozenAnchorDisplayState>();
        private sealed class AnchorSampleState
        {
            internal ProjectedAnchorBindingSample Sample;
            internal ulong AgeAtReceiptMs;
            internal long ReceivedAtTicks;
        }
        private bool hasSnapshot;
        private ulong presentationOriginVersion;
        private PresentationOrigin presentationOrigin;
        private readonly Dictionary<string, ProjectedParticipantPresence> participants = new Dictionary<string, ProjectedParticipantPresence>();
        private ConnectionSnapshotEnvelope lastConnectionSnapshot;
        private RuntimeProjectionFence reliableFence;
        private ulong minimumReliableSequence;
        private RuntimeClockSnapshot clock;
        private ProgressionRuntimeState progression;
        private readonly Dictionary<string, RuntimeRunSnapshot> activeRuns = new Dictionary<string, RuntimeRunSnapshot>();

        internal PresentationRuntimeStateStore(PresentationDeliveryCatalog delivery)
        {
            this.delivery = delivery;
        }

        internal ulong LastReliableSequence { get; private set; }
        internal ulong LastStateFrameSequence { get; private set; }
        internal PresentationOrigin PresentationOrigin { get { return presentationOrigin?.Clone(); } }
        internal IEnumerable<ProjectedParticipantPresence> Participants
        {
            get { List<ProjectedParticipantPresence> result = new List<ProjectedParticipantPresence>(); foreach (ProjectedParticipantPresence participant in participants.Values) result.Add(participant.Clone()); return result; }
        }
        internal RuntimeClockSnapshot RuntimeClock { get { return clock?.Clone(); } }
        internal ProgressionRuntimeState Progression { get { return progression?.Clone(); } }
        internal IEnumerable<RuntimeRunSnapshot> ActiveRuns
        {
            get { List<RuntimeRunSnapshot> result = new List<RuntimeRunSnapshot>(); foreach (RuntimeRunSnapshot run in activeRuns.Values) result.Add(run.Clone()); return result; }
        }

        private string latestCommandEventId;
        internal string LastCommandOutcomeCode { get; private set; }

        internal void TrackCommand(string clientEventId)
        {
            if (string.IsNullOrWhiteSpace(clientEventId)) throw new ArgumentException("A command event identifier is required.");
            latestCommandEventId = clientEventId;
            LastCommandOutcomeCode = null;
        }

        internal void ClearCommandOutcome(string expectedClientEventId = null)
        {
            if (expectedClientEventId != null && expectedClientEventId != latestCommandEventId) return;
            latestCommandEventId = null;
            LastCommandOutcomeCode = null;
        }

        private bool TryApplyCommandOutcome(CommandOutcome outcome, out string error)
        {
            error = null;
            if (outcome == null || string.IsNullOrWhiteSpace(outcome.ClientEventId) || outcome.ResultCase == CommandOutcome.ResultOneofCase.None)
            {
                error = "realtime.command_outcome is incomplete.";
                return false;
            }
            if (outcome.ClientEventId != latestCommandEventId) return true;
            switch (outcome.ResultCase)
            {
                case CommandOutcome.ResultOneofCase.Accepted: LastCommandOutcomeCode = "accepted"; break;
                case CommandOutcome.ResultOneofCase.Rejected:
                    LastCommandOutcomeCode = "rejected:" + (Enum.IsDefined(typeof(CommandRejectionReason), outcome.Rejected.Reason) ? outcome.Rejected.Reason.ToString() : "Unspecified");
                    break;
                case CommandOutcome.ResultOneofCase.NoOp:
                    LastCommandOutcomeCode = "no-op:" + (Enum.IsDefined(typeof(CommandNoOpReason), outcome.NoOp.Reason) ? outcome.NoOp.Reason.ToString() : "Unspecified");
                    break;
            }
            return true;
        }

        internal void ResetStateStream()
        {
            ClearCommandOutcome();
            LastStateFrameSequence = 0;
            anchorSamples.Clear();
        }

        internal void Reset()
        {
            if (lastConnectionSnapshot != null)
            {
                reliableFence = lastConnectionSnapshot.Fence.Clone();
                minimumReliableSequence = LastReliableSequence;
            }
            ClearCommandOutcome();
            nodeStates.Clear();
            surfaceStates.Clear();
            variableStates.Clear();
            modelClipStates.Clear();
            mediaStates.Clear();
            anchorSamples.Clear();
            LastReliableSequence = 0;
            LastStateFrameSequence = 0;
            frozenAnchors.Clear();
            hasSnapshot = false;
            presentationOriginVersion = 0;
            presentationOrigin = null;
            participants.Clear();
            lastConnectionSnapshot = null;
            clock = null;
            progression = null;
            activeRuns.Clear();
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
                case ControlServerItem.ItemOneofCase.CommandOutcome:
                    return TryApplyCommandOutcome(item.CommandOutcome, out error);
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
        internal bool TryGetAnchorSample(string id, out ProjectedAnchorBindingSample value)
        {
            value = null;
            if (frozenAnchors.TryGetValue(id, out FrozenAnchorDisplayState frozen))
            {
                value = new ProjectedAnchorBindingSample { Position = frozen.Position?.Clone(), Rotation = frozen.Rotation?.Clone() };
                return true;
            }
            if (!anchorSamples.TryGetValue(id, out AnchorSampleState state)) return false;
            double elapsedMs = (Stopwatch.GetTimestamp() - state.ReceivedAtTicks) * 1000d / Stopwatch.Frequency;
            if (elapsedMs < 0 || state.AgeAtReceiptMs + elapsedMs > 500d) return false;
            value = state.Sample.Clone();
            return true;
        }
        internal void InvalidateAnchorSamples() { anchorSamples.Clear(); }
        internal bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        internal bool TryGetVariableState(string id, out VariableState value) { return variableStates.TryGetValue(id, out value); }
        internal bool TryGetMediaState(string id, out MediaRuntimeState value) { return mediaStates.TryGetValue(id, out value); }
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

            if (hasSnapshot && envelope.ReliableSequence < LastReliableSequence
                || reliableFence != null && reliableFence.SessionId == envelope.Fence.SessionId
                && reliableFence.AssignmentEpoch == envelope.Fence.AssignmentEpoch
                && reliableFence.ProjectionProfileId == envelope.Fence.ProjectionProfileId
                && Equals(reliableFence.Publication, envelope.Fence.Publication)
                && envelope.ReliableSequence < minimumReliableSequence)
            {
                error = "realtime.snapshot sequence regressed within the same assignment.";
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

            Dictionary<string, ProjectedParticipantPresence> presence = new Dictionary<string, ProjectedParticipantPresence>();
            if (envelope.PresenceAtCut != null)
                foreach (ProjectedParticipantPresence participant in envelope.PresenceAtCut.Participants)
                    if (!ValidPresence(participant.ParticipantId, participant.Role) || !presence.TryAdd(participant.ParticipantId, participant.Clone()))
                    { error = "realtime snapshot presence is invalid."; return false; }
            if (view.PresentationOrigin != null && !ValidOrigin(view.PresentationOrigin))
            { error = "realtime snapshot presentation origin is invalid."; return false; }

            if (!TryValidateSnapshotView(view, out error)
                || !TryValidateFrozenAnchors(view, out error)
                || !TryReplaceRuntimeState(view.NodeStates, view.SurfaceStates, view.Variables, view.ModelClipStates, out error))
            {
                return false;
            }

            LastReliableSequence = envelope.ReliableSequence;
            LastStateFrameSequence = 0;
            anchorSamples.Clear();
            ReplaceFrozenAnchors(view);
            presentationOriginVersion = envelope.Fence.PresentationOriginVersion;
            presentationOrigin = view.PresentationOrigin?.Clone();
            Replace(participants, presence);
            ClearCommandOutcome();
            hasSnapshot = true;
            lastConnectionSnapshot = envelope.Clone();
            mediaStates.Clear(); foreach (var media in view.MediaStates) mediaStates.Add(media.SurfaceId, media.Clone());
            clock = view.Clock.Clone();
            progression = view.Progression.Clone();
            activeRuns.Clear();
            foreach (RuntimeRunSnapshot run in view.ActiveRuns) activeRuns.Add(RunKey(run.RunId), run.Clone());
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

            if (LastReliableSequence == ulong.MaxValue || reliableEvent.Sequence != LastReliableSequence + 1)
            {
                error = "realtime.event sequence is not contiguous; request a snapshot or replay.";
                return false;
            }
            if (!hasSnapshot || reliableEvent.OccurredAtRuntimeTimeMs < clock.RuntimeTimeMs)
            {
                error = "realtime.event requires a snapshot and a monotonic runtime timestamp.";
                return false;
            }

            switch (reliableEvent.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.RuntimeViewReplaced:
                    ParticipantRuntimeView replacement = reliableEvent.RuntimeViewReplaced.RuntimeView;
                    if (replacement == null || replacement.BaseReliableSequence != reliableEvent.Sequence
                        || replacement.ProjectionProfileId != delivery.Delivery.ProjectionProfile.ProjectionProfileId
                        || replacement.AssignmentEpoch != delivery.Delivery.ProjectionInstance.AssignmentEpoch
                        || replacement.Clock?.RuntimeTimeMs != reliableEvent.OccurredAtRuntimeTimeMs
                        || !Equals(replacement.PresentationOrigin, presentationOrigin)
                        || !TryValidateSnapshotView(replacement, out error)
                        || !HasCompleteOwnership(replacement)
                        || !TryValidateFrozenAnchors(replacement, out error)
                        || !TryReplaceRuntimeState(replacement.NodeStates, replacement.SurfaceStates, replacement.Variables, replacement.ModelClipStates, out error))
                    { error = "realtime.event replacement view is invalid."; return false; }
                    mediaStates.Clear();
                    foreach (var media in replacement.MediaStates) mediaStates.Add(media.SurfaceId, media.Clone());
                    activeRuns.Clear();
                    foreach (var run in replacement.ActiveRuns) activeRuns.Add(RunKey(run.RunId), run.Clone());
                    clock = replacement.Clock.Clone();
                    progression = replacement.Progression.Clone();
                    anchorSamples.Clear();
                    ReplaceFrozenAnchors(replacement);
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.RuntimeStatusChanged:
                    RuntimeStatusChanged status = reliableEvent.RuntimeStatusChanged;
                    if (status.StatusCase == RuntimeStatusChanged.StatusOneofCase.None
                        || status.StatusCase == RuntimeStatusChanged.StatusOneofCase.Paused && (status.Paused.Reason == PauseReason.Unspecified || !Enum.IsDefined(typeof(PauseReason), status.Paused.Reason))
                        || status.StatusCase == RuntimeStatusChanged.StatusOneofCase.Terminating && (status.Terminating.Reason == TerminationReason.Unspecified || !Enum.IsDefined(typeof(TerminationReason), status.Terminating.Reason)))
                    { error = "realtime.event runtime status is invalid."; return false; }
                    if (status.StatusCase == RuntimeStatusChanged.StatusOneofCase.Running) clock.Running = status.Running.Clone();
                    else if (status.StatusCase == RuntimeStatusChanged.StatusOneofCase.Paused) clock.Paused = status.Paused.Clone();
                    else clock.Terminating = status.Terminating.Clone();
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.PresentationOriginChanged:
                    PresentationOrigin nextOrigin = reliableEvent.PresentationOriginChanged.Origin;
                    if (!ValidOrigin(nextOrigin) || nextOrigin.Version != presentationOriginVersion + 1)
                    { error = "realtime.event presentation origin is invalid."; return false; }
                    presentationOrigin = nextOrigin.Clone();
                    presentationOriginVersion = nextOrigin.Version;
                    anchorSamples.Clear();
                    frozenAnchors.Clear();
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ParticipantPresenceChanged:
                    ParticipantPresenceChanged presenceChange = reliableEvent.ParticipantPresenceChanged;
                    if (!ValidPresence(presenceChange.ParticipantId, presenceChange.Role))
                    { error = "realtime.event participant presence is invalid."; return false; }
                    participants[presenceChange.ParticipantId] = new ProjectedParticipantPresence { ParticipantId = presenceChange.ParticipantId, Role = presenceChange.Role, Connected = presenceChange.Connected };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.GroupExited:
                    GroupExited exited = reliableEvent.GroupExited;
                    if (exited.GroupId != progression.CurrentGroupId || exited.GroupEntryEpoch != progression.GroupEntryEpoch)
                    { error = "realtime.event group exit is invalid."; return false; }
                    RemoveGroupState(exited.GroupId);
                    progression.CurrentGroupId = "";
                    progression.CurrentStepId = "";
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.GroupEntered:
                    GroupEntered entered = reliableEvent.GroupEntered;
                    if (!PresentationDeliveryCatalog.IsId(entered.GroupId) || entered.GroupEntryEpoch != progression.GroupEntryEpoch + 1
                        || entered.Initialization == null || !TryApplyGroupInitialization(entered.Initialization, entered.GroupId, out error))
                    { error = "realtime.event group initialization is invalid."; return false; }
                    progression.CurrentGroupId = entered.GroupId;
                    progression.GroupEntryEpoch = entered.GroupEntryEpoch;
                    progression.CurrentStepId = "";
                    progression.Stable = new StableProgression();
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.CueAccepted:
                    if (reliableEvent.CueAccepted.GroupId != progression.CurrentGroupId || reliableEvent.CueAccepted.StepId != progression.CurrentStepId
                        || !PresentationDeliveryCatalog.IsId(reliableEvent.CueAccepted.CueId))
                    { error = "realtime.event cue is invalid."; return false; }
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.GestureInputAccepted:
                    if (reliableEvent.GestureInputAccepted.Gesture < GestureKind.SwipeLeft || reliableEvent.GestureInputAccepted.Gesture > GestureKind.CloseHands)
                    { error = "realtime.event gesture is invalid."; return false; }
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ZoneInputAccepted:
                    if (!PresentationDeliveryCatalog.IsId(reliableEvent.ZoneInputAccepted.ZoneId)
                        || reliableEvent.ZoneInputAccepted.Edge != ZoneEdge.Enter && reliableEvent.ZoneInputAccepted.Edge != ZoneEdge.Exit)
                    { error = "realtime.event zone is invalid."; return false; }
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.LogicalInputAccepted:
                    if (!PresentationDeliveryCatalog.IsId(reliableEvent.LogicalInputAccepted.LogicalEventName))
                    { error = "realtime.event input is invalid."; return false; }
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceInteractionAccepted:
                    if (!delivery.ContainsSurface(reliableEvent.SurfaceInteractionAccepted.SurfaceId)
                        || !PresentationDeliveryCatalog.IsId(reliableEvent.SurfaceInteractionAccepted.InteractionId))
                    { error = "realtime.event surface interaction is invalid."; return false; }
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.PresentationEnded:
                    TerminationReason endReason = reliableEvent.PresentationEnded.Reason;
                    if (endReason == TerminationReason.Unspecified || !Enum.IsDefined(typeof(TerminationReason), endReason))
                    { error = "realtime.event termination is invalid."; return false; }
                    clock.Terminating = new Terminating { Reason = endReason };
                    activeRuns.Clear();
                    foreach (SurfaceRuntimeState surface in surfaceStates.Values) surface.TransitionRunId = null;
                    foreach (string target in new List<string>(modelClipStates.Keys)) modelClipStates[target] = new ModelClipRuntimeState { ModelNodeId = target, DefaultPose = new DefaultModelPose() };
                    foreach (string target in new List<string>(mediaStates.Keys)) mediaStates[target] = new MediaRuntimeState { SurfaceId = target, Stopped = new MediaStoppedState() };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.StepEntered:
                    StepEntered step = reliableEvent.StepEntered;
                    if (step.GroupId != progression.CurrentGroupId || step.GroupEntryEpoch != progression.GroupEntryEpoch
                        || !PresentationDeliveryCatalog.IsId(step.StepId) || step.StepEntryEpoch != progression.StepEntryEpoch + 1
                        || step.EnteredAtRuntimeTimeMs != reliableEvent.OccurredAtRuntimeTimeMs)
                    { error = "realtime.event progression step is invalid."; return false; }
                    progression.CurrentStepId = step.StepId;
                    progression.StepEntryEpoch = step.StepEntryEpoch;
                    progression.StepEnteredAtRuntimeTimeMs = step.EnteredAtRuntimeTimeMs;
                    progression.Stable = new StableProgression();
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.NodeStateCommitted:
                    if (!TrySetNodeState(reliableEvent.NodeStateCommitted.State, out error)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceStateChanged:
                    if (!delivery.IsStateReachable(reliableEvent.SurfaceStateChanged.SurfaceId, reliableEvent.SurfaceStateChanged.StateId)) { error = "realtime.event references an unknown surface state."; return false; }
                    surfaceStates[reliableEvent.SurfaceStateChanged.SurfaceId] = new SurfaceRuntimeState { SurfaceId = reliableEvent.SurfaceStateChanged.SurfaceId, StateId = reliableEvent.SurfaceStateChanged.StateId };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceTransitionStarted:
                    SurfaceTransitionStarted transition = reliableEvent.SurfaceTransitionStarted;
                    RuntimeRunSnapshot transitionRun = transition.Run;
                    if (!IsValidRunId(transition.RunId) || transitionRun == null || !transition.RunId.Equals(transitionRun.RunId)
                        || activeRuns.ContainsKey(RunKey(transition.RunId)) || !ValidRunOwner(transitionRun.Owner) || transitionRun.Cause == null
                        || !PresentationDeliveryCatalog.IsId(transitionRun.Cause.CueId) || !PresentationDeliveryCatalog.IsId(transitionRun.Cause.CauseEventId)
                        || transitionRun.Completion != RunCompletion.Blocking && transitionRun.Completion != RunCompletion.NonBlocking
                        || transitionRun.RunCase != RuntimeRunSnapshot.RunOneofCase.SurfaceTransition
                        || transition.StartedAtRuntimeTimeMs != reliableEvent.OccurredAtRuntimeTimeMs || transitionRun.StartedAtRuntimeTimeMs != transition.StartedAtRuntimeTimeMs
                        || !delivery.IsStateReachable(transition.SurfaceId, transition.FromStateId) || !delivery.IsStateReachable(transition.SurfaceId, transition.StateId)
                        || !surfaceStates.TryGetValue(transition.SurfaceId, out SurfaceRuntimeState previousSurface) || previousSurface.StateId != transition.FromStateId || previousSurface.TransitionRunId != null
                        || transition.DurationMs == 0 || transition.Easing == Easing.Unspecified || !Enum.IsDefined(typeof(Easing), transition.Easing)
                        || transitionRun.SurfaceTransition.SurfaceId != transition.SurfaceId || transitionRun.SurfaceTransition.FromStateId != transition.FromStateId
                        || transitionRun.SurfaceTransition.ToStateId != transition.StateId || transitionRun.SurfaceTransition.DurationMs != transition.DurationMs || transitionRun.SurfaceTransition.Easing != transition.Easing)
                    { error = "realtime.event SurfaceTransition Run is invalid."; return false; }
                    activeRuns.Add(RunKey(transition.RunId), transitionRun.Clone());
                    surfaceStates[transition.SurfaceId] = new SurfaceRuntimeState { SurfaceId = transition.SurfaceId, StateId = transition.StateId, TransitionRunId = transition.RunId.Clone() };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.SurfaceTransitionCompleted:
                    SurfaceTransitionCompleted completed = reliableEvent.SurfaceTransitionCompleted;
                    if (!IsValidRunId(completed.RunId) || !activeRuns.TryGetValue(RunKey(completed.RunId), out RuntimeRunSnapshot completedRun)
                        || completedRun.RunCase != RuntimeRunSnapshot.RunOneofCase.SurfaceTransition || completedRun.SurfaceTransition.SurfaceId != completed.SurfaceId
                        || completedRun.SurfaceTransition.ToStateId != completed.StateId || !surfaceStates.TryGetValue(completed.SurfaceId, out SurfaceRuntimeState transitioningSurface)
                        || !completed.RunId.Equals(transitioningSurface.TransitionRunId))
                    { error = "realtime.event references an unknown SurfaceTransition Run."; return false; }
                    activeRuns.Remove(RunKey(completed.RunId));
                    surfaceStates[completed.SurfaceId] = new SurfaceRuntimeState { SurfaceId = completed.SurfaceId, StateId = completed.StateId };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.VariableChanged:
                    if (!TrySetVariableState(reliableEvent.VariableChanged.State, out error)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.TimelineStarted:
                    TimelineStarted started = reliableEvent.TimelineStarted;
                    if (!IsValidRunId(started.RunId) || activeRuns.ContainsKey(RunKey(started.RunId)) || !delivery.ContainsTimeline(started.TimelineId)
                        || !ValidRunOwner(started.Owner) || started.Cause == null || !PresentationDeliveryCatalog.IsId(started.Cause.CueId)
                        || !PresentationDeliveryCatalog.IsId(started.Cause.CauseEventId) || started.StartedAtRuntimeTimeMs != reliableEvent.OccurredAtRuntimeTimeMs
                        || started.Completion != RunCompletion.Blocking && started.Completion != RunCompletion.NonBlocking)
                    { error = "realtime.event timeline Run is invalid."; return false; }
                    activeRuns.Add(RunKey(started.RunId), new RuntimeRunSnapshot
                    {
                        RunId = started.RunId.Clone(),
                        Owner = started.Owner.Clone(),
                        Cause = started.Cause.Clone(),
                        Completion = started.Completion,
                        StartedAtRuntimeTimeMs = started.StartedAtRuntimeTimeMs,
                        Timeline = new TimelineRunSnapshot { TimelineId = started.TimelineId }
                    });
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted:
                case ProjectedReliableEvent.PayloadOneofCase.TimelineCanceled:
                    string timelineId = reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted
                            ? reliableEvent.TimelineCompleted.TimelineId
                            : reliableEvent.TimelineCanceled.TimelineId;
                    RuntimeRunId endedId = reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.TimelineCompleted
                        ? reliableEvent.TimelineCompleted.RunId : reliableEvent.TimelineCanceled.RunId;
                    if (!IsValidRunId(endedId) || !activeRuns.TryGetValue(RunKey(endedId), out RuntimeRunSnapshot ended)
                        || ended.RunCase != RuntimeRunSnapshot.RunOneofCase.Timeline || ended.Timeline.TimelineId != timelineId
                        || reliableEvent.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.TimelineCanceled
                            && (reliableEvent.TimelineCanceled.Reason == TimelineCancelReason.Unspecified || !Enum.IsDefined(typeof(TimelineCancelReason), reliableEvent.TimelineCanceled.Reason)))
                    { error = "realtime.event references an unknown timeline Run."; return false; }
                    activeRuns.Remove(RunKey(endedId));
                    break;
                default:
                    if (!TryApplyPlaybackEvent(reliableEvent, out error)) return false;
                    break;
            }

            LastReliableSequence = reliableEvent.Sequence;
            clock.RuntimeTimeMs = reliableEvent.OccurredAtRuntimeTimeMs;
            error = null;
            return true;
        }

        private RuntimeRunSnapshot PlaybackRun(string target, bool model)
        {
            foreach (RuntimeRunSnapshot run in activeRuns.Values)
                if (model ? run.ModelClip?.ModelNodeId == target : run.Media?.SurfaceId == target) return run;
            return null;
        }

        private bool ValidHeldClip(string node, ClipHeldPose pose)
        {
            return pose != null && delivery.TryGetModelClip(node, pose.ClipId, out ProjectedModelClipDefinition clip)
                && PresentationDeliveryCatalog.IsFinite(pose.PositionMs) && pose.PositionMs >= 0 && pose.PositionMs <= clip.DurationMs;
        }

        private bool ValidHeldBlend(string node, BlendHeldPose pose)
        {
            return pose != null && ValidHeldClip(node, pose.From) && ValidHeldClip(node, pose.To)
                && PresentationDeliveryCatalog.IsFinite(pose.ToWeight) && pose.ToWeight >= 0 && pose.ToWeight <= 1;
        }

        private bool ValidPlaybackRun(RuntimeRunSnapshot run, RuntimeRunId id, string target, bool model, ulong time, bool retainTerminalPose = false)
        {
            if (run == null || !IsValidRunId(id) || !id.Equals(run.RunId) || !ValidRunOwner(run.Owner)
                || run.Cause == null || !PresentationDeliveryCatalog.IsId(run.Cause.CueId) || !PresentationDeliveryCatalog.IsId(run.Cause.CauseEventId)
                || run.StartedAtRuntimeTimeMs > time || run.Completion != RunCompletion.Blocking && run.Completion != RunCompletion.NonBlocking) return false;
            ResourceOwner resourceOwner = model ? (delivery.TryGetNode(target, out ProjectedNodeDefinition node) ? node.Owner : null)
                : (delivery.TryGetSurface(target, out ProjectedSurfaceDefinition mediaSurface) ? mediaSurface.Owner : null);
            if (resourceOwner == null || resourceOwner.ScopeCase == ResourceOwner.ScopeOneofCase.None
                || resourceOwner.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation && run.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Presentation
                || resourceOwner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && (run.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Group || run.Owner.Group.GroupId != resourceOwner.Group.GroupId)) return false;
            if (model && run.Completion == RunCompletion.Blocking && (run.ModelClip?.Single?.Loop == true || run.ModelClip?.Crossfade?.To?.Loop == true)) return false;
            if (model) return IsModelNode(target) && nodeStates.ContainsKey(target) && run.ModelClip?.ModelNodeId == target
                && (IsValidModelClipRun(run.ModelClip, time) || retainTerminalPose && run.ModelClip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single && IsValidClipPlayback(target, run.ModelClip.Single, time, true));
            return surfaceStates.ContainsKey(target) && delivery.TryGetSurface(target, out ProjectedSurfaceDefinition surface)
                && surface.HasVideo && run.Media?.SurfaceId == target && run.Completion == RunCompletion.NonBlocking
                && IsValidPlaybackClock(run.Media.Playback, time);
        }

        private static bool SameRunMetadata(RuntimeRunSnapshot a, RuntimeRunSnapshot b)
        {
            return a.RunId.Equals(b.RunId) && a.Owner.Equals(b.Owner) && a.Cause.Equals(b.Cause)
                && a.StartedAtRuntimeTimeMs == b.StartedAtRuntimeTimeMs && a.Completion == b.Completion;
        }

        private bool TryApplyPlaybackEvent(ProjectedReliableEvent item, out string error)
        {
            error = "realtime.event contains an invalid playback state or Run reference.";
            string target = null; RuntimeRunId id = null; RuntimeRunSnapshot run = null;
            bool model = false, start = false, update = false;
            switch (item.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.MediaStarted:
                    target = item.MediaStarted.SurfaceId; id = item.MediaStarted.RunId; run = item.MediaStarted.Run; start = true;
                    if (run?.Media?.Playback?.ClockCase != PlaybackClock.ClockOneofCase.Playing || !run.Media.Playback.Equals(item.MediaStarted.Playback)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaPaused:
                    target = item.MediaPaused.SurfaceId; id = item.MediaPaused.RunId; run = item.MediaPaused.Run; update = true;
                    if (run?.Media?.Playback?.ClockCase != PlaybackClock.ClockOneofCase.Paused || run.Media.Playback.Paused.PositionMs != item.MediaPaused.PositionMs) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaResumed:
                    target = item.MediaResumed.SurfaceId; id = item.MediaResumed.RunId; run = item.MediaResumed.Run; update = true;
                    if (run?.Media?.Playback?.ClockCase != PlaybackClock.ClockOneofCase.Playing || !run.Media.Playback.Playing.Equals(item.MediaResumed.Playback)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaSeeked:
                    target = item.MediaSeeked.SurfaceId; id = item.MediaSeeked.RunId; run = item.MediaSeeked.Run; update = true;
                    if (run?.Media?.Playback == null || !run.Media.Playback.Equals(item.MediaSeeked.Playback)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStarted:
                    model = true; start = true; target = item.ModelClipStarted.ModelNodeId; id = item.ModelClipStarted.RunId; run = item.ModelClipStarted.Run;
                    if (run?.ModelClip?.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Single || !run.ModelClip.Single.Equals(item.ModelClipStarted.Playback) || !StartsNow(run.ModelClip.Single.Playback, item.OccurredAtRuntimeTimeMs)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeStarted:
                    model = true; start = true; target = item.ModelClipCrossfadeStarted.ModelNodeId; id = item.ModelClipCrossfadeStarted.RunId; run = item.ModelClipCrossfadeStarted.Run;
                    if (run?.ModelClip?.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Crossfade || !run.ModelClip.Crossfade.Equals(item.ModelClipCrossfadeStarted.Crossfade) || !StartsNow(run.ModelClip.Crossfade.To.Playback, item.OccurredAtRuntimeTimeMs) || !StartsNow(run.ModelClip.Crossfade.TransitionClock, item.OccurredAtRuntimeTimeMs)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipPaused:
                    model = true; update = true; target = item.ModelClipPaused.ModelNodeId; id = item.ModelClipPaused.RunId; run = item.ModelClipPaused.Run;
                    if (!ModelClockMode(run?.ModelClip, true)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipResumed:
                    model = true; update = true; target = item.ModelClipResumed.ModelNodeId; id = item.ModelClipResumed.RunId; run = item.ModelClipResumed.Run;
                    if (!ModelClockMode(run?.ModelClip, false)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeCompleted:
                    model = true; update = true; target = item.ModelClipCrossfadeCompleted.ModelNodeId; id = item.ModelClipCrossfadeCompleted.RunId; run = item.ModelClipCrossfadeCompleted.Run;
                    if (run?.ModelClip?.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Single || !run.ModelClip.Single.Equals(item.ModelClipCrossfadeCompleted.Playback)) return false;
                    break;
            }
            if (start || update)
            {
                RuntimeRunSnapshot old = PlaybackRun(target, model);
                bool terminalFade = item.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeCompleted;
                if (terminalFade && (old?.ModelClip?.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Crossfade
                    || !run.ModelClip.Single.Equals(old.ModelClip.Crossfade.To)
                    || PlaybackPosition(old.ModelClip.Crossfade.TransitionClock, item.OccurredAtRuntimeTimeMs, 1) < old.ModelClip.Crossfade.DurationMs
                    || !IsValidClipPlayback(target, run.ModelClip.Single, item.OccurredAtRuntimeTimeMs, true))) return false;
                if (!ValidPlaybackRun(run, id, target, model, item.OccurredAtRuntimeTimeMs, terminalFade)) return false;
                if (update && (old == null || !id.Equals(old.RunId) || !SameRunMetadata(old, run))) return false;
                if (update && model && !terminalFade && !SameModelPhase(old.ModelClip, run.ModelClip)) return false;
                if (item.ModelClipCrossfadeStarted != null && (old == null && (!modelClipStates.TryGetValue(target, out ModelClipRuntimeState prior) || prior.StateCase != ModelClipRuntimeState.StateOneofCase.HeldClip))) return false;
                if (start && run.StartedAtRuntimeTimeMs != item.OccurredAtRuntimeTimeMs) return false;
                if (start && (activeRuns.ContainsKey(RunKey(id)) || !model && old != null
                    || model && old?.ModelClip?.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Crossfade)) return false;
                if (old != null) activeRuns.Remove(RunKey(old.RunId));
                activeRuns[RunKey(id)] = run.Clone();
                if (model) modelClipStates[target] = new ModelClipRuntimeState { ModelNodeId = target, Active = new ModelClipActive { RunId = id.Clone() } };
                else mediaStates[target] = new MediaRuntimeState { SurfaceId = target, Active = new MediaActive { RunId = id.Clone(), Playback = run.Media.Playback.Clone() } };
                error = null; return true;
            }
            switch (item.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.MediaStoppedSeeked:
                    target = item.MediaStoppedSeeked.SurfaceId;
                    if (!mediaStates.TryGetValue(target, out MediaRuntimeState stopped) || stopped.StateCase != MediaRuntimeState.StateOneofCase.Stopped
                        || !ValidMediaPosition(target, item.MediaStoppedSeeked.HeldPositionMs)) return false;
                    stopped.Stopped.HeldPositionMs = item.MediaStoppedSeeked.HeldPositionMs;
                    error = null; return true;
                case ProjectedReliableEvent.PayloadOneofCase.MediaCompleted: target = item.MediaCompleted.SurfaceId; id = item.MediaCompleted.RunId; break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaStopped: target = item.MediaStopped.SurfaceId; id = item.MediaStopped.RunId; break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaCanceled: target = item.MediaCanceled.SurfaceId; id = item.MediaCanceled.RunId; break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStopped: model = true; target = item.ModelClipStopped.ModelNodeId; id = item.ModelClipStopped.RunId; break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCompleted: model = true; target = item.ModelClipCompleted.ModelNodeId; id = item.ModelClipCompleted.RunId; break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCanceled: model = true; target = item.ModelClipCanceled.ModelNodeId; id = item.ModelClipCanceled.RunId; break;
                default: return false;
            }
            RuntimeRunSnapshot active = PlaybackRun(target, model);
            if (active == null || !IsValidRunId(id) || !id.Equals(active.RunId)) return false;
            ModelClipRuntimeState nextModel = null; MediaRuntimeState nextMedia = null; bool remove = false;
            if (model)
            {
                nextModel = new ModelClipRuntimeState { ModelNodeId = target };
                if (item.ModelClipStopped != null)
                {
                    if (item.ModelClipStopped.HeldPoseCase == ModelClipStopped.HeldPoseOneofCase.Clip && active.ModelClip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single && item.ModelClipStopped.Clip.ClipId == active.ModelClip.Single.ClipId && ValidHeldClip(target, item.ModelClipStopped.Clip)) nextModel.HeldClip = item.ModelClipStopped.Clip.Clone();
                    else if (item.ModelClipStopped.HeldPoseCase == ModelClipStopped.HeldPoseOneofCase.Blend && active.ModelClip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Crossfade && item.ModelClipStopped.Blend.From?.ClipId == active.ModelClip.Crossfade.From.ClipId && item.ModelClipStopped.Blend.To?.ClipId == active.ModelClip.Crossfade.To.ClipId && ValidHeldBlend(target, item.ModelClipStopped.Blend)) nextModel.HeldBlend = item.ModelClipStopped.Blend.Clone();
                    else return false;
                }
                else if (item.ModelClipCompleted != null)
                {
                    ClipHeldPose pose = item.ModelClipCompleted.HeldPose;
                    if (!ValidHeldClip(target, pose) || active.ModelClip.PhaseCase != ModelClipRunSnapshot.PhaseOneofCase.Single
                        || active.ModelClip.Single.Loop || active.ModelClip.Single.Playback.ClockCase != PlaybackClock.ClockOneofCase.Playing
                        || active.ModelClip.Single.ClipId != pose.ClipId || !delivery.TryGetModelClip(target, pose.ClipId, out ProjectedModelClipDefinition clip)
                        || pose.PositionMs != clip.DurationMs || PlaybackPosition(active.ModelClip.Single.Playback, item.OccurredAtRuntimeTimeMs, active.ModelClip.Single.Speed) < clip.DurationMs) return false;
                    nextModel.HeldClip = pose.Clone();
                }
                else
                {
                    if (item.ModelClipCanceled.Reason != ModelClipCancelReason.GroupExit && item.ModelClipCanceled.Reason != ModelClipCancelReason.PresentationEnded) return false;
                    remove = item.ModelClipCanceled.Reason == ModelClipCancelReason.GroupExit;
                    if (remove && active.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Group) return false;
                    nextModel.DefaultPose = new DefaultModelPose();
                }
            }
            else
            {
                double held = item.MediaStopped?.HeldPositionMs ?? 0;
                if (!ValidMediaPosition(target, item.MediaCompleted?.HeldPositionMs ?? held)) return false;
                if (item.MediaCompleted != null && (active.Media.Playback.ClockCase != PlaybackClock.ClockOneofCase.Playing
                    || PlaybackPosition(active.Media.Playback, item.OccurredAtRuntimeTimeMs, 1) < item.MediaCompleted.HeldPositionMs)) return false;
                if (item.MediaCanceled != null)
                {
                    if (item.MediaCanceled.Reason != MediaCancelReason.GroupExit && item.MediaCanceled.Reason != MediaCancelReason.PresentationEnded) return false;
                    remove = item.MediaCanceled.Reason == MediaCancelReason.GroupExit;
                    if (remove && active.Owner.ScopeCase != RuntimeRunOwner.ScopeOneofCase.Group) return false;
                }
                nextMedia = new MediaRuntimeState { SurfaceId = target, Stopped = new MediaStoppedState { HeldPositionMs = held } };
            }
            activeRuns.Remove(RunKey(id));
            if (model) { if (remove) modelClipStates.Remove(target); else modelClipStates[target] = nextModel; }
            else { if (remove) mediaStates.Remove(target); else mediaStates[target] = nextMedia; }
            error = null; return true;
        }

        private bool ValidMediaPosition(string surfaceId, double position)
        {
            if (!PresentationDeliveryCatalog.IsFinite(position) || position < 0 || !delivery.TryGetSurface(surfaceId, out ProjectedSurfaceDefinition surface) || !surface.HasVideo) return false;
            foreach (DeliveredRenderSurface render in delivery.Delivery.ProjectionProfile.RenderSurfaces)
                if (render.SemanticSurfaceId == surfaceId)
                    foreach (DeliveredArtifact artifact in render.Artifacts)
                        if (artifact.Video != null && position > artifact.Video.DurationMs) return false;
            return true;
        }

        private static bool StartsNow(PlaybackClock value, ulong time)
        {
            return value?.ClockCase == PlaybackClock.ClockOneofCase.Playing && value.Playing.PositionAtReferenceMs == 0 && value.Playing.ReferenceRuntimeTimeMs == time;
        }

        private static bool SameClipIdentity(ClipPlayback a, ClipPlayback b)
        {
            return a != null && b != null && a.ClipId == b.ClipId && a.Speed == b.Speed && a.Loop == b.Loop;
        }

        private static bool SameModelPhase(ModelClipRunSnapshot a, ModelClipRunSnapshot b)
        {
            if (a.PhaseCase != b.PhaseCase) return false;
            if (a.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single) return SameClipIdentity(a.Single, b.Single);
            return a.Crossfade.DurationMs == b.Crossfade.DurationMs && a.Crossfade.Easing == b.Crossfade.Easing && a.Crossfade.FromIsHeld == b.Crossfade.FromIsHeld
                && SameClipIdentity(a.Crossfade.From, b.Crossfade.From) && SameClipIdentity(a.Crossfade.To, b.Crossfade.To);
        }

        private static bool ModelClockMode(ModelClipRunSnapshot run, bool paused)
        {
            PlaybackClock.ClockOneofCase expected = paused ? PlaybackClock.ClockOneofCase.Paused : PlaybackClock.ClockOneofCase.Playing;
            if (run?.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Single) return run.Single.Playback?.ClockCase == expected;
            return run?.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.Crossfade && run.Crossfade.TransitionClock?.ClockCase == expected
                && run.Crossfade.To.Playback?.ClockCase == expected && (run.Crossfade.FromIsHeld || run.Crossfade.From.Playback?.ClockCase == expected);
        }

        internal bool TryValidateNetworkStateFrame(ElementStateFrame frame, out string error)
        {
            error = "realtime.state_frame violates projection or Timeline ownership.";
            if (frame == null || !TryValidateAnchorBindings(frame, out _)) return false;
            var opacityOwners = new HashSet<string>();
            var positionOwners = new HashSet<string>();
            var rotationOwners = new HashSet<string>();
            var scaleOwners = new HashSet<string>();
            foreach (RuntimeRunSnapshot run in activeRuns.Values)
            {
                if (run.RunCase != RuntimeRunSnapshot.RunOneofCase.Timeline) continue;
                if (!delivery.TryGetTimeline(run.Timeline.TimelineId, out ProjectedTimelineDefinition timeline)) return false;
                foreach (ProjectedTimelineTrack track in timeline.Tracks)
                {
                    if (track.Target.Property == TimelineProperty.Opacity) opacityOwners.Add(track.Target.NodeId);
                    else if (track.Target.Property == TimelineProperty.TransformPosition) positionOwners.Add(track.Target.NodeId);
                    else if (track.Target.Property == TimelineProperty.TransformRotation) rotationOwners.Add(track.Target.NodeId);
                    else if (track.Target.Property == TimelineProperty.TransformScale) scaleOwners.Add(track.Target.NodeId);
                }
            }
            if (frame.Kind == StateFrameKind.Keyframe && frame.Elements.Count != nodeStates.Count) return false;
            string previous = null;
            foreach (ElementStatePatch element in frame.Elements)
            {
                NodeStatePatch patch = element.Node;
                if (patch == null || !nodeStates.ContainsKey(element.ElementId)
                    || previous != null && string.CompareOrdinal(previous, element.ElementId) >= 0) return false;
                previous = element.ElementId;
                bool opacityOwned = opacityOwners.Contains(element.ElementId);
                bool positionOwned = positionOwners.Contains(element.ElementId);
                bool rotationOwned = rotationOwners.Contains(element.ElementId);
                bool scaleOwned = scaleOwners.Contains(element.ElementId);
                if (patch.HasOpacity && opacityOwned
                    || patch.Transform?.Position != null && positionOwned
                    || patch.Transform?.Rotation != null && rotationOwned
                    || patch.Transform?.Scale != null && scaleOwned) return false;
                if (frame.Kind == StateFrameKind.Keyframe
                    && (!patch.HasActive || !patch.HasVisible || !opacityOwned && !patch.HasOpacity
                        || !positionOwned && patch.Transform?.Position == null
                        || !rotationOwned && patch.Transform?.Rotation == null
                        || !scaleOwned && patch.Transform?.Scale == null)) return false;
            }
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

            if (!TryValidateAnchorBindings(frame, out error)) return false;

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
                if (source.Transform != null)
                {
                    if (updated.Transform == null)
                    {
                        error = "realtime.state_frame node has no full base transform.";
                        return false;
                    }
                    if (source.Transform.Position != null) updated.Transform.Position = source.Transform.Position.Clone();
                    if (source.Transform.Rotation != null) updated.Transform.Rotation = source.Transform.Rotation.Clone();
                    if (source.Transform.Scale != null) updated.Transform.Scale = source.Transform.Scale.Clone();
                }
                updates.Add(patch.ElementId, updated);
            }

            foreach (KeyValuePair<string, NodeRuntimeState> update in updates)
            {
                nodeStates[update.Key] = update.Value;
            }

            if (frame.Kind == StateFrameKind.Keyframe) { anchorSamples.Clear(); frozenAnchors.Clear(); }
            long receivedAtTicks = Stopwatch.GetTimestamp();
            foreach (ProjectedAnchorBindingPatch binding in frame.AnchorBindings)
            {
                frozenAnchors.Remove(binding.NodeId);
                if (binding.StateCase == ProjectedAnchorBindingPatch.StateOneofCase.Frozen)
                {
                    anchorSamples.Remove(binding.NodeId);
                    frozenAnchors[binding.NodeId] = binding.Frozen.Clone();
                }
                else if (binding.StateCase == ProjectedAnchorBindingPatch.StateOneofCase.Unavailable
                    || frame.ProducedAtRuntimeMonotonicMs - binding.Sample.ObservedAtRuntimeMonotonicMs > 500)
                    anchorSamples.Remove(binding.NodeId);
                else anchorSamples[binding.NodeId] = new AnchorSampleState
                {
                    Sample = binding.Sample.Clone(),
                    AgeAtReceiptMs = frame.ProducedAtRuntimeMonotonicMs - binding.Sample.ObservedAtRuntimeMonotonicMs,
                    ReceivedAtTicks = receivedAtTicks,
                };
            }

            LastStateFrameSequence = frame.FrameSequence;
            if (clock.StatusCase == RuntimeClockSnapshot.StatusOneofCase.Running) clock.RuntimeTimeMs = Math.Max(clock.RuntimeTimeMs, frame.ProducedAtRuntimeTimeMs);
            error = null;
            return true;
        }

        private bool TryValidateAnchorBindings(ElementStateFrame frame, out string error)
        {
            error = "realtime.state_frame contains invalid anchor bindings.";
            int expected = 0;
            foreach (ProjectedNodeDefinition node in delivery.Nodes)
                if (nodeStates.ContainsKey(node.NodeId) && node.Parent?.ParentCase == SpatialParent.ParentOneofCase.PresenterAnchor) expected++;
            if (frame.Kind == StateFrameKind.Keyframe && frame.AnchorBindings.Count != expected) return false;
            string previous = null;
            foreach (ProjectedAnchorBindingPatch binding in frame.AnchorBindings)
            {
                if (binding == null || !PresentationDeliveryCatalog.IsId(binding.NodeId)
                    || previous != null && string.CompareOrdinal(previous, binding.NodeId) >= 0
                    || !delivery.TryGetNode(binding.NodeId, out ProjectedNodeDefinition node)
                    || !nodeStates.ContainsKey(binding.NodeId)
                    || node.Parent?.ParentCase != SpatialParent.ParentOneofCase.PresenterAnchor) return false;
                previous = binding.NodeId;
                if (binding.StateCase == ProjectedAnchorBindingPatch.StateOneofCase.Unavailable) continue;
                if (binding.StateCase == ProjectedAnchorBindingPatch.StateOneofCase.Frozen)
                {
                    if (binding.Frozen.NodeId != binding.NodeId || !ValidFrozenAnchor(binding.Frozen, node)) return false;
                    continue;
                }
                if (binding.StateCase != ProjectedAnchorBindingPatch.StateOneofCase.Sample) return false;
                ProjectedAnchorBindingSample sample = binding.Sample;
                PresenterAnchorParent parent = node.Parent.PresenterAnchor;
                if (sample.TrackingFrameSequence == 0 || sample.ObservedAtRuntimeMonotonicMs > frame.ProducedAtRuntimeMonotonicMs
                    || parent.FollowPosition != (sample.Position != null)
                    || parent.FollowRotation != (sample.Rotation != null)
                    || sample.Position != null && (!IsValidVector(sample.Position)
                        || !PresentationCoordinateValidation.IsRenderable(sample.Position))
                    || sample.Rotation != null && !PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(sample.Rotation)) return false;
            }
            error = null;
            return true;
        }

        private static bool IsValidStatePatch(NodeStatePatch patch)
        {
            if (patch == null || !patch.HasActive && !patch.HasVisible && !patch.HasOpacity && patch.Transform == null)
            {
                return false;
            }

            if (patch.HasOpacity && (!PresentationDeliveryCatalog.IsCanonicalFinite(patch.Opacity) || patch.Opacity < 0 || patch.Opacity > 1))
            {
                return false;
            }

            if (patch.Transform == null)
            {
                return true;
            }

            Unframe.Presentation.Transform transform = patch.Transform;
            if (transform.Position == null && transform.Rotation == null && transform.Scale == null) return false;
            if (transform.Position != null && (!IsValidVector(transform.Position)
                || !PresentationCoordinateValidation.IsRenderable(transform.Position))) return false;
            if (transform.Rotation != null && !PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(transform.Rotation)) return false;
            return transform.Scale == null || IsValidVector(transform.Scale)
                && PresentationCoordinateValidation.IsRenderableScale(transform.Scale)
                && transform.Scale.X > 0 && transform.Scale.Y > 0 && transform.Scale.Z > 0;
        }

        private static bool IsValidVector(Unframe.Presentation.Vector3 value)
        {
            return PresentationDeliveryCatalog.IsCanonicalFinite(value.X)
                && PresentationDeliveryCatalog.IsCanonicalFinite(value.Y)
                && PresentationDeliveryCatalog.IsCanonicalFinite(value.Z);
        }

        private static bool IsValidNodeRuntimeState(NodeRuntimeState state)
        {
            return state != null && PresentationDeliveryCatalog.IsId(state.NodeId)
                && PresentationDeliveryCatalog.IsCanonicalFinite(state.Opacity) && state.Opacity >= 0 && state.Opacity <= 1
                && (state.Transform == null || IsValidTransform(state.Transform));
        }

        private static bool IsValidTransform(Unframe.Presentation.Transform transform)
        {
            if (transform.Position == null || transform.Rotation == null || transform.Scale == null)
            {
                return false;
            }

            Unframe.Presentation.Vector3 position = transform.Position;
            Unframe.Presentation.Quaternion rotation = transform.Rotation;
            Unframe.Presentation.Vector3 scale = transform.Scale;
            return PresentationDeliveryCatalog.IsCanonicalFinite(position.X) && PresentationDeliveryCatalog.IsCanonicalFinite(position.Y) && PresentationDeliveryCatalog.IsCanonicalFinite(position.Z)
                && PresentationCoordinateValidation.IsRenderable(position)
                && PresentationDeliveryCatalog.IsCanonicalFinite(scale.X) && PresentationDeliveryCatalog.IsCanonicalFinite(scale.Y) && PresentationDeliveryCatalog.IsCanonicalFinite(scale.Z) && scale.X > 0 && scale.Y > 0 && scale.Z > 0
                && PresentationCoordinateValidation.IsRenderableScale(scale)
                && PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(rotation);
        }

        private static bool ValidFrozenAnchor(FrozenAnchorDisplayState frozen, ProjectedNodeDefinition node)
        {
            PresenterAnchorParent parent = node?.Parent?.PresenterAnchor;
            return frozen != null && parent != null && (frozen.Position != null || frozen.Rotation != null)
                && (frozen.Position == null || parent.FollowPosition && IsValidVector(frozen.Position) && PresentationCoordinateValidation.IsRenderable(frozen.Position))
                && (frozen.Rotation == null || parent.FollowRotation && PresentationDeliveryCatalog.IsCanonicalUnitQuaternion(frozen.Rotation));
        }

        private bool TryValidateFrozenAnchors(ParticipantRuntimeView view, out string error)
        {
            error = "realtime snapshot contains invalid frozen anchors.";
            var nodes = new HashSet<string>();
            foreach (var state in view.NodeStates) nodes.Add(state.NodeId);
            string previous = null;
            foreach (FrozenAnchorDisplayState frozen in view.FrozenAnchors)
            {
                if (!nodes.Contains(frozen.NodeId) || previous != null && string.CompareOrdinal(previous, frozen.NodeId) >= 0
                    || !delivery.TryGetNode(frozen.NodeId, out ProjectedNodeDefinition node) || !ValidFrozenAnchor(frozen, node)) return false;
                previous = frozen.NodeId;
            }
            error = null;
            return true;
        }

        private void ReplaceFrozenAnchors(ParticipantRuntimeView view)
        {
            frozenAnchors.Clear();
            foreach (FrozenAnchorDisplayState frozen in view.FrozenAnchors) frozenAnchors.Add(frozen.NodeId, frozen.Clone());
        }

        private bool HasCompleteOwnership(ParticipantRuntimeView view)
        {
            var nodes = new HashSet<string>();
            var surfaces = new HashSet<string>();
            var variables = new HashSet<string>();
            var models = new HashSet<string>();
            var media = new HashSet<string>();
            foreach (var node in delivery.Delivery.ProjectionProfile.RuntimeCatalog.Nodes)
                if (IsViewOwner(node.Owner, view.Progression.CurrentGroupId))
                {
                    nodes.Add(node.NodeId);
                    if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model) models.Add(node.NodeId);
                }
            foreach (var surface in delivery.Delivery.ProjectionProfile.RuntimeCatalog.Surfaces)
                if (IsViewOwner(surface.Owner, view.Progression.CurrentGroupId))
                {
                    surfaces.Add(surface.SurfaceId);
                    if (surface.HasVideo) media.Add(surface.SurfaceId);
                }
            foreach (var variable in delivery.Delivery.ProjectionProfile.RuntimeCatalog.Variables)
                if (IsViewOwner(variable.Owner, view.Progression.CurrentGroupId)) variables.Add(variable.VariableId);
            foreach (var node in view.NodeStates) if (!nodes.Remove(node.NodeId) || node.Transform == null) return false;
            foreach (var surface in view.SurfaceStates) if (!surfaces.Remove(surface.SurfaceId)) return false;
            foreach (var variable in view.Variables) if (!variables.Remove(variable.VariableId)) return false;
            foreach (var model in view.ModelClipStates) if (!models.Remove(model.ModelNodeId)) return false;
            foreach (var state in view.MediaStates) if (!media.Remove(state.SurfaceId)) return false;
            return nodes.Count == 0 && surfaces.Count == 0 && variables.Count == 0 && models.Count == 0 && media.Count == 0;
        }

        private static bool IsViewOwner(ResourceOwner owner, string groupId)
        {
            return owner?.ScopeCase == ResourceOwner.ScopeOneofCase.Presentation
                || owner?.ScopeCase == ResourceOwner.ScopeOneofCase.Group && owner.Group.GroupId == groupId;
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
                    || run.StartedAtRuntimeTimeMs > view.Clock.RuntimeTimeMs
                    || run.Owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Group && (run.Owner.Group.GroupId != view.Progression.CurrentGroupId || run.Owner.Group.GroupEntryEpoch != view.Progression.GroupEntryEpoch))
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
                        if (run.Completion != RunCompletion.NonBlocking || !delivery.TryGetSurface(run.Media.SurfaceId, out ProjectedSurfaceDefinition videoSurface) || !videoSurface.HasVideo
                            || !IsValidPlaybackClock(run.Media.Playback, view.Clock.RuntimeTimeMs)
                            || !mediaRuns.TryAdd(run.Media.SurfaceId, run)) return FailSnapshotReference(out error);
                        break;
                    case RuntimeRunSnapshot.RunOneofCase.ModelClip:
                        if (!IsModelNode(run.ModelClip.ModelNodeId)
                            || run.ModelClip.PhaseCase == ModelClipRunSnapshot.PhaseOneofCase.None
                            || !IsValidModelClipRun(run.ModelClip, view.Clock.RuntimeTimeMs)
                            || run.Completion == RunCompletion.Blocking && (run.ModelClip.Single?.Loop == true || run.ModelClip.Crossfade?.To?.Loop == true)
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
                if (!delivery.TryGetSurface(state.SurfaceId, out ProjectedSurfaceDefinition mediaSurface) || !mediaSurface.HasVideo || !seenMedia.Add(state.SurfaceId)
                    || state.StateCase == MediaRuntimeState.StateOneofCase.None
                    || state.StateCase == MediaRuntimeState.StateOneofCase.Stopped
                        && !ValidMediaPosition(state.SurfaceId, state.Stopped.HeldPositionMs))
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
                if (state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldClip && !ValidHeldClip(state.ModelNodeId, state.HeldClip)
                    || state.StateCase == ModelClipRuntimeState.StateOneofCase.HeldBlend && !ValidHeldBlend(state.ModelNodeId, state.HeldBlend)) return FailSnapshotReference(out error);
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

        private bool ValidRunOwner(RuntimeRunOwner owner)
        {
            return owner != null && (owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Presentation
                || owner.ScopeCase == RuntimeRunOwner.ScopeOneofCase.Group && owner.Group.GroupId == progression.CurrentGroupId
                    && owner.Group.GroupEntryEpoch == progression.GroupEntryEpoch);
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

        private static bool ValidPresence(string id, SessionRole role)
        {
            return PresentationDeliveryCatalog.IsId(id) && (role == SessionRole.Presenter || role == SessionRole.Viewer);
        }

        private static bool ValidOrigin(PresentationOrigin origin)
        {
            return origin != null && origin.Pose != null && IsValidTransform(new Unframe.Presentation.Transform
            {
                Position = origin.Pose.Position,
                Rotation = origin.Pose.Rotation,
                Scale = new Unframe.Presentation.Vector3 { X = 1, Y = 1, Z = 1 }
            });
        }

        private static bool IsGroupOwner(ResourceOwner owner, string groupId)
        {
            return owner != null && owner.ScopeCase == ResourceOwner.ScopeOneofCase.Group && owner.Group.GroupId == groupId;
        }

        private void RemoveGroupState(string groupId)
        {
            ProjectedRuntimeCatalog catalog = delivery.Delivery.ProjectionProfile.RuntimeCatalog;
            foreach (ProjectedNodeDefinition node in catalog.Nodes) if (IsGroupOwner(node.Owner, groupId)) { nodeStates.Remove(node.NodeId); modelClipStates.Remove(node.NodeId); }
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces) if (IsGroupOwner(surface.Owner, groupId)) { surfaceStates.Remove(surface.SurfaceId); mediaStates.Remove(surface.SurfaceId); }
            foreach (ProjectedVariableDefinition variable in catalog.Variables) if (IsGroupOwner(variable.Owner, groupId)) variableStates.Remove(variable.VariableId);
            foreach (string key in new List<string>(activeRuns.Keys)) if (activeRuns[key].Owner?.Group?.GroupId == groupId) activeRuns.Remove(key);
        }

        private bool TryApplyGroupInitialization(GroupRuntimeInitialization initialization, string groupId, out string error)
        {
            error = "realtime group initialization references invalid runtime state.";
            ProjectedRuntimeCatalog catalog = delivery.Delivery.ProjectionProfile.RuntimeCatalog;
            HashSet<string> nodes = new HashSet<string>(), surfaces = new HashSet<string>(), variables = new HashSet<string>();
            foreach (ProjectedNodeDefinition node in catalog.Nodes) if (IsGroupOwner(node.Owner, groupId)) nodes.Add(node.NodeId);
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces) if (IsGroupOwner(surface.Owner, groupId)) surfaces.Add(surface.SurfaceId);
            foreach (ProjectedVariableDefinition variable in catalog.Variables) if (IsGroupOwner(variable.Owner, groupId)) variables.Add(variable.VariableId);
            string previous = null;
            foreach (NodeRuntimeState node in initialization.NodeStates)
            {
                if (!IsValidNodeRuntimeState(node) || !nodes.Remove(node.NodeId) || previous != null && string.CompareOrdinal(previous, node.NodeId) >= 0) return false;
                previous = node.NodeId;
            }
            previous = null;
            foreach (SurfaceRuntimeState surface in initialization.SurfaceStates)
            {
                if (!delivery.IsStateReachable(surface.SurfaceId, surface.StateId) || surface.TransitionRunId != null || !surfaces.Remove(surface.SurfaceId)
                    || previous != null && string.CompareOrdinal(previous, surface.SurfaceId) >= 0) return false;
                previous = surface.SurfaceId;
            }
            previous = null;
            foreach (VariableState variable in initialization.Variables)
            {
                if (!variables.Remove(variable.VariableId) || previous != null && string.CompareOrdinal(previous, variable.VariableId) >= 0) return false;
                previous = variable.VariableId;
            }
            HashSet<string> models = new HashSet<string>(), media = new HashSet<string>();
            foreach (ProjectedNodeDefinition node in catalog.Nodes) if (IsGroupOwner(node.Owner, groupId) && node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model) models.Add(node.NodeId);
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces) if (IsGroupOwner(surface.Owner, groupId) && surface.HasVideo) media.Add(surface.SurfaceId);
            previous = null;
            foreach (ModelClipRuntimeState state in initialization.ModelClipStates)
            {
                if (state == null || !models.Remove(state.ModelNodeId) || state.StateCase != ModelClipRuntimeState.StateOneofCase.DefaultPose
                    || previous != null && string.CompareOrdinal(previous, state.ModelNodeId) >= 0) return false;
                previous = state.ModelNodeId;
            }
            previous = null;
            foreach (MediaRuntimeState state in initialization.MediaStates)
            {
                if (state == null || !media.Remove(state.SurfaceId) || state.StateCase != MediaRuntimeState.StateOneofCase.Stopped || state.Stopped.HeldPositionMs != 0
                    || previous != null && string.CompareOrdinal(previous, state.SurfaceId) >= 0) return false;
                previous = state.SurfaceId;
            }
            if (nodes.Count != 0 || surfaces.Count != 0 || variables.Count != 0 || models.Count != 0 || media.Count != 0) return false;
            foreach (ModelClipRuntimeState state in initialization.ModelClipStates) modelClipStates[state.ModelNodeId] = state.Clone();
            foreach (MediaRuntimeState state in initialization.MediaStates) mediaStates[state.SurfaceId] = state.Clone();
            foreach (NodeRuntimeState node in initialization.NodeStates) nodeStates[node.NodeId] = node.Clone();
            foreach (SurfaceRuntimeState surface in initialization.SurfaceStates) surfaceStates[surface.SurfaceId] = surface.Clone();
            foreach (VariableState variable in initialization.Variables) variableStates[variable.VariableId] = variable.Clone();
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
