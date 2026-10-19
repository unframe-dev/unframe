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
        private const uint RealtimeSnapshotSchemaVersion = 2;

        private readonly PresentationDeliveryCatalog delivery;
        private readonly Dictionary<string, NodeRuntimeState> nodeStates = new Dictionary<string, NodeRuntimeState>();
        private readonly Dictionary<string, SurfaceRuntimeState> surfaceStates = new Dictionary<string, SurfaceRuntimeState>();
        private readonly Dictionary<string, MediaRuntimeState> mediaStates = new Dictionary<string, MediaRuntimeState>();
        private readonly Dictionary<string, VariableState> variableStates = new Dictionary<string, VariableState>();
        private readonly Dictionary<string, ModelClipRuntimeState> modelClipStates = new Dictionary<string, ModelClipRuntimeState>();
        private readonly Dictionary<string, AnchorSampleState> anchorSamples = new Dictionary<string, AnchorSampleState>();
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
            ClearCommandOutcome();
            nodeStates.Clear();
            surfaceStates.Clear();
            variableStates.Clear();
            mediaStates.Clear();
            modelClipStates.Clear();
            anchorSamples.Clear();
            LastReliableSequence = 0;
            LastStateFrameSequence = 0;
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
            if (!anchorSamples.TryGetValue(id, out AnchorSampleState state)) return false;
            double elapsedMs = (Stopwatch.GetTimestamp() - state.ReceivedAtTicks) * 1000d / Stopwatch.Frequency;
            if (elapsedMs < 0 || state.AgeAtReceiptMs + elapsedMs > 500d) return false;
            value = state.Sample.Clone();
            return true;
        }
        internal void InvalidateAnchorSamples() { anchorSamples.Clear(); }
        internal bool TryGetSurfaceState(string id, out SurfaceRuntimeState value) { return surfaceStates.TryGetValue(id, out value); }
        internal bool TryGetVariableState(string id, out VariableState value) { return variableStates.TryGetValue(id, out value); }
        internal bool TryGetMediaState(string surfaceId, out MediaRuntimeState value) { return mediaStates.TryGetValue(surfaceId, out value); }
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

            Dictionary<string, ProjectedParticipantPresence> presence = new Dictionary<string, ProjectedParticipantPresence>();
            if (envelope.PresenceAtCut != null)
                foreach (ProjectedParticipantPresence participant in envelope.PresenceAtCut.Participants)
                    if (!ValidPresence(participant.ParticipantId, participant.Role) || !presence.TryAdd(participant.ParticipantId, participant.Clone()))
                    { error = "realtime snapshot presence is invalid."; return false; }
            if (view.PresentationOrigin != null && !ValidOrigin(view.PresentationOrigin))
            { error = "realtime snapshot presentation origin is invalid."; return false; }

            if (!TryValidateSnapshotView(view, out error)
                || !TryReplaceRuntimeState(view.NodeStates, view.SurfaceStates, view.Variables, view.ModelClipStates, out error))
            {
                return false;
            }

            mediaStates.Clear();
            foreach (MediaRuntimeState media in view.MediaStates) mediaStates.Add(media.SurfaceId, media.Clone());
            LastReliableSequence = envelope.ReliableSequence;
            LastStateFrameSequence = 0;
            anchorSamples.Clear();
            presentationOriginVersion = envelope.Fence.PresentationOriginVersion;
            presentationOrigin = view.PresentationOrigin?.Clone();
            Replace(participants, presence);
            ClearCommandOutcome();
            hasSnapshot = true;
            lastConnectionSnapshot = envelope.Clone();
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
                case ProjectedReliableEvent.PayloadOneofCase.MediaStarted:
                case ProjectedReliableEvent.PayloadOneofCase.MediaPaused:
                case ProjectedReliableEvent.PayloadOneofCase.MediaResumed:
                case ProjectedReliableEvent.PayloadOneofCase.MediaSeeked:
                case ProjectedReliableEvent.PayloadOneofCase.MediaCompleted:
                case ProjectedReliableEvent.PayloadOneofCase.MediaStopped:
                case ProjectedReliableEvent.PayloadOneofCase.MediaCanceled:
                case ProjectedReliableEvent.PayloadOneofCase.MediaStoppedSeeked:
                    if (!TryApplyMediaEvent(reliableEvent, out error)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStarted:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipPaused:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipResumed:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStopped:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCompleted:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeStarted:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeCompleted:
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCanceled:
                    if (!TryApplyModelClipEvent(reliableEvent, out error)) return false;
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
                    error = "realtime.event payload is unsupported; request a new snapshot.";
                    return false;
            }

            LastReliableSequence = reliableEvent.Sequence;
            clock.RuntimeTimeMs = reliableEvent.OccurredAtRuntimeTimeMs;
            error = null;
            return true;
        }

        private bool TryApplyModelClipEvent(ProjectedReliableEvent message, out string error)
        {
            error = "realtime model clip event is inconsistent with the active Run.";
            string nodeId;
            RuntimeRunId runId;
            RuntimeRunSnapshot incoming = null;
            ModelClipRuntimeState terminal = null;
            bool starts = false;
            switch (message.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStarted:
                    var start = message.ModelClipStarted;
                    nodeId = start.ModelNodeId; runId = start.RunId; incoming = start.Run; starts = true;
                    if (incoming?.ModelClip?.Single == null || !incoming.ModelClip.Single.Equals(start.Playback)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeStarted:
                    var fade = message.ModelClipCrossfadeStarted;
                    nodeId = fade.ModelNodeId; runId = fade.RunId; incoming = fade.Run; starts = true;
                    if (incoming?.ModelClip?.Crossfade == null || !incoming.ModelClip.Crossfade.Equals(fade.Crossfade)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipPaused:
                    nodeId = message.ModelClipPaused.ModelNodeId; runId = message.ModelClipPaused.RunId; incoming = message.ModelClipPaused.Run;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipResumed:
                    nodeId = message.ModelClipResumed.ModelNodeId; runId = message.ModelClipResumed.RunId; incoming = message.ModelClipResumed.Run;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCrossfadeCompleted:
                    var complete = message.ModelClipCrossfadeCompleted;
                    nodeId = complete.ModelNodeId; runId = complete.RunId; incoming = complete.Run;
                    if (incoming?.ModelClip?.Single == null || !incoming.ModelClip.Single.Equals(complete.Playback)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipStopped:
                    var stop = message.ModelClipStopped;
                    nodeId = stop.ModelNodeId; runId = stop.RunId;
                    terminal = new ModelClipRuntimeState { ModelNodeId = nodeId };
                    if (stop.Clip != null) terminal.HeldClip = stop.Clip.Clone();
                    else if (stop.Blend != null) terminal.HeldBlend = stop.Blend.Clone();
                    else return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCompleted:
                    nodeId = message.ModelClipCompleted.ModelNodeId; runId = message.ModelClipCompleted.RunId;
                    if (message.ModelClipCompleted.HeldPose == null) return false;
                    terminal = new ModelClipRuntimeState { ModelNodeId = nodeId, HeldClip = message.ModelClipCompleted.HeldPose.Clone() };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.ModelClipCanceled:
                    nodeId = message.ModelClipCanceled.ModelNodeId; runId = message.ModelClipCanceled.RunId;
                    if (message.ModelClipCanceled.Reason == ModelClipCancelReason.Unspecified || !Enum.IsDefined(typeof(ModelClipCancelReason), message.ModelClipCanceled.Reason)) return false;
                    terminal = new ModelClipRuntimeState { ModelNodeId = nodeId, DefaultPose = new DefaultModelPose() };
                    break;
                default: return false;
            }
            if (!IsModelNode(nodeId) || !IsValidRunId(runId)) return false;
            modelClipStates.TryGetValue(nodeId, out ModelClipRuntimeState previous);
            RuntimeRunSnapshot current = null;
            if (previous?.Active != null) activeRuns.TryGetValue(RunKey(previous.Active.RunId), out current);
            if (!starts && (current?.ModelClip?.ModelNodeId != nodeId || !current.RunId.Equals(runId))) return false;
            if (incoming != null)
            {
                if (incoming.RunId == null || !incoming.RunId.Equals(runId) || incoming.ModelClip?.ModelNodeId != nodeId || !ValidRunOwner(incoming.Owner)
                    || incoming.Cause == null || !PresentationDeliveryCatalog.IsId(incoming.Cause.CueId) || !PresentationDeliveryCatalog.IsId(incoming.Cause.CauseEventId)
                    || incoming.Completion != RunCompletion.Blocking && incoming.Completion != RunCompletion.NonBlocking
                    || !IsValidModelClipRun(incoming.ModelClip, message.OccurredAtRuntimeTimeMs)
                    || starts && (activeRuns.ContainsKey(RunKey(runId)) || incoming.StartedAtRuntimeTimeMs != message.OccurredAtRuntimeTimeMs)
                    || !starts && (incoming.StartedAtRuntimeTimeMs != current.StartedAtRuntimeTimeMs || !incoming.Owner.Equals(current.Owner)
                        || !incoming.Cause.Equals(current.Cause) || incoming.Completion != current.Completion)) return false;
            }
            else if (!IsValidHeldModelState(terminal)) return false;
            if (current != null) activeRuns.Remove(RunKey(current.RunId));
            if (incoming != null)
            {
                activeRuns[RunKey(runId)] = incoming.Clone();
                modelClipStates[nodeId] = new ModelClipRuntimeState { ModelNodeId = nodeId, Active = new ModelClipActive { RunId = runId.Clone() } };
            }
            else modelClipStates[nodeId] = terminal;
            error = null;
            return true;
        }

        private bool IsValidHeldModelState(ModelClipRuntimeState state)
        {
            if (state == null || !IsModelNode(state.ModelNodeId)) return false;
            if (state.DefaultPose != null) return true;
            if (state.HeldClip != null) return IsValidHeldModelPose(state.ModelNodeId, state.HeldClip);
            return state.HeldBlend != null && IsValidHeldModelPose(state.ModelNodeId, state.HeldBlend.From)
                && IsValidHeldModelPose(state.ModelNodeId, state.HeldBlend.To)
                && PresentationDeliveryCatalog.IsFinite(state.HeldBlend.ToWeight) && state.HeldBlend.ToWeight >= 0 && state.HeldBlend.ToWeight <= 1;
        }
        private bool IsValidHeldModelPose(string nodeId, ClipHeldPose pose)
        {
            return pose != null && delivery.TryGetModelClip(nodeId, pose.ClipId, out ProjectedModelClipDefinition clip)
                && PresentationDeliveryCatalog.IsFinite(pose.PositionMs) && pose.PositionMs >= 0 && pose.PositionMs <= clip.DurationMs;
        }

        private bool TryApplyMediaEvent(ProjectedReliableEvent message, out string error)
        {
            error = "realtime media event is inconsistent with the active Run.";
            string surfaceId;
            RuntimeRunId runId;
            RuntimeRunSnapshot incoming = null;
            PlaybackClock playback = null;
            double held = 0;
            bool started = message.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.MediaStarted;
            bool terminal = false;
            switch (message.PayloadCase)
            {
                case ProjectedReliableEvent.PayloadOneofCase.MediaStarted:
                    surfaceId = message.MediaStarted.SurfaceId; runId = message.MediaStarted.RunId;
                    incoming = message.MediaStarted.Run; playback = message.MediaStarted.Playback;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaPaused:
                    surfaceId = message.MediaPaused.SurfaceId; runId = message.MediaPaused.RunId; incoming = message.MediaPaused.Run;
                    playback = new PlaybackClock { Paused = new PausedClock { PositionMs = message.MediaPaused.PositionMs } };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaResumed:
                    surfaceId = message.MediaResumed.SurfaceId; runId = message.MediaResumed.RunId; incoming = message.MediaResumed.Run;
                    playback = new PlaybackClock { Playing = message.MediaResumed.Playback?.Clone() };
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaSeeked:
                    surfaceId = message.MediaSeeked.SurfaceId; runId = message.MediaSeeked.RunId; incoming = message.MediaSeeked.Run;
                    playback = message.MediaSeeked.Playback;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaCompleted:
                    surfaceId = message.MediaCompleted.SurfaceId; runId = message.MediaCompleted.RunId; held = message.MediaCompleted.HeldPositionMs; terminal = true;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaStopped:
                    surfaceId = message.MediaStopped.SurfaceId; runId = message.MediaStopped.RunId; held = message.MediaStopped.HeldPositionMs; terminal = true;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaCanceled:
                    surfaceId = message.MediaCanceled.SurfaceId; runId = message.MediaCanceled.RunId; terminal = true;
                    if (message.MediaCanceled.Reason == MediaCancelReason.Unspecified || !Enum.IsDefined(typeof(MediaCancelReason), message.MediaCanceled.Reason)) return false;
                    break;
                case ProjectedReliableEvent.PayloadOneofCase.MediaStoppedSeeked:
                    surfaceId = message.MediaStoppedSeeked.SurfaceId; held = message.MediaStoppedSeeked.HeldPositionMs;
                    if (!delivery.ContainsSurface(surfaceId) || !mediaStates.TryGetValue(surfaceId, out MediaRuntimeState stopped)
                        || stopped.StateCase != MediaRuntimeState.StateOneofCase.Stopped || !PresentationDeliveryCatalog.IsFinite(held) || held < 0) return false;
                    mediaStates[surfaceId] = new MediaRuntimeState { SurfaceId = surfaceId, Stopped = new MediaStoppedState { HeldPositionMs = held } };
                    error = null;
                    return true;
                default: return false;
            }
            if (!delivery.ContainsSurface(surfaceId) || !IsValidRunId(runId)) return false;
            string key = RunKey(runId);
            bool exists = activeRuns.TryGetValue(key, out RuntimeRunSnapshot existing);
            if (started)
            {
                if (exists || !mediaStates.TryGetValue(surfaceId, out MediaRuntimeState stopped) || stopped.StateCase != MediaRuntimeState.StateOneofCase.Stopped) return false;
            }
            else if (!exists || existing.RunCase != RuntimeRunSnapshot.RunOneofCase.Media || existing.Media.SurfaceId != surfaceId
                || !mediaStates.TryGetValue(surfaceId, out MediaRuntimeState active) || active.StateCase != MediaRuntimeState.StateOneofCase.Active || !runId.Equals(active.Active.RunId)) return false;
            if (terminal)
            {
                if (!PresentationDeliveryCatalog.IsFinite(held) || held < 0) return false;
                activeRuns.Remove(key);
                if (message.PayloadCase == ProjectedReliableEvent.PayloadOneofCase.MediaCanceled) mediaStates.Remove(surfaceId);
                else mediaStates[surfaceId] = new MediaRuntimeState { SurfaceId = surfaceId, Stopped = new MediaStoppedState { HeldPositionMs = held } };
            }
            else
            {
                if (incoming == null || incoming.RunCase != RuntimeRunSnapshot.RunOneofCase.Media || !runId.Equals(incoming.RunId)
                    || incoming.Media.SurfaceId != surfaceId || !IsValidPlaybackClock(playback, message.OccurredAtRuntimeTimeMs)
                    || !playback.Equals(incoming.Media.Playback) || !ValidRunOwner(incoming.Owner)
                    || incoming.Cause == null || !PresentationDeliveryCatalog.IsId(incoming.Cause.CueId) || !PresentationDeliveryCatalog.IsId(incoming.Cause.CauseEventId)
                    || incoming.Completion != RunCompletion.Blocking && incoming.Completion != RunCompletion.NonBlocking
                    || incoming.StartedAtRuntimeTimeMs > message.OccurredAtRuntimeTimeMs
                    || started && incoming.StartedAtRuntimeTimeMs != message.OccurredAtRuntimeTimeMs
                    || !started && (incoming.StartedAtRuntimeTimeMs != existing.StartedAtRuntimeTimeMs || !incoming.Owner.Equals(existing.Owner)
                        || !incoming.Cause.Equals(existing.Cause) || incoming.Completion != existing.Completion)) return false;
                activeRuns[key] = incoming.Clone();
                mediaStates[surfaceId] = new MediaRuntimeState { SurfaceId = surfaceId, Active = new MediaActive { RunId = runId.Clone(), Playback = playback.Clone() } };
            }
            error = null;
            return true;
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

            if (frame.Kind == StateFrameKind.Keyframe) anchorSamples.Clear();
            long receivedAtTicks = Stopwatch.GetTimestamp();
            foreach (ProjectedAnchorBindingPatch binding in frame.AnchorBindings)
            {
                if (binding.StateCase == ProjectedAnchorBindingPatch.StateOneofCase.Unavailable
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
                    || !hasRun && !IsValidHeldModelState(state))
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
            if (nodes.Count != 0 || surfaces.Count != 0 || variables.Count != 0) return false;
            var mediaIds = new HashSet<string>();
            foreach (ProjectedSurfaceDefinition surface in catalog.Surfaces)
                if (surface.HasVideo && IsGroupOwner(surface.Owner, groupId)) mediaIds.Add(surface.SurfaceId);
            foreach (MediaRuntimeState media in initialization.MediaStates)
                if (media == null || !mediaIds.Remove(media.SurfaceId) || media.StateCase != MediaRuntimeState.StateOneofCase.Stopped
                    || !PresentationDeliveryCatalog.IsFinite(media.Stopped.HeldPositionMs) || media.Stopped.HeldPositionMs < 0) return false;
            if (mediaIds.Count != 0) return false;
            var modelIds = new HashSet<string>();
            foreach (ProjectedNodeDefinition node in catalog.Nodes)
                if (node.NodeCase == ProjectedNodeDefinition.NodeOneofCase.Model && IsGroupOwner(node.Owner, groupId)) modelIds.Add(node.NodeId);
            foreach (ModelClipRuntimeState model in initialization.ModelClipStates)
                if (!IsValidHeldModelState(model) || !modelIds.Remove(model.ModelNodeId)) return false;
            if (modelIds.Count != 0) return false;
            foreach (ModelClipRuntimeState model in initialization.ModelClipStates) modelClipStates[model.ModelNodeId] = model.Clone();
            foreach (MediaRuntimeState media in initialization.MediaStates) mediaStates[media.SurfaceId] = media.Clone();
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
