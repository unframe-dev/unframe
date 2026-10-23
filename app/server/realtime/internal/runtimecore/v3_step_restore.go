package runtimecore

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
	"unicode/utf16"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

var errV3StepEntryCapacity = fmt.Errorf("%w: Step entry history", ErrV3RuntimeCapacity)

func v3UTF16Less(a, b string) bool {
	left, right := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(left) && i < len(right); i++ {
		if left[i] != right[i] {
			return left[i] < right[i]
		}
	}
	return len(left) < len(right)
}

func captureV3StepStart(snapshot *realtimev2.CanonicalRuntimeSnapshot) error {
	p := snapshot.Progression
	entry := proto.Clone(&realtimev2.StepStartState{GroupId: p.CurrentGroupId, StepId: p.CurrentStepId, GroupEntryEpoch: p.GroupEntryEpoch, StepEntryEpoch: p.StepEntryEpoch, CapturedAtRuntimeTimeMs: snapshot.Clock.RuntimeTimeMs, NodeStates: snapshot.NodeStates, SurfaceStates: snapshot.SurfaceStates, MediaStates: snapshot.MediaStates, ModelClipStates: snapshot.ModelClipStates, Variables: snapshot.Variables, ActiveRuns: snapshot.ActiveRuns}).(*realtimev2.StepStartState)
	if protocolv2.KnownSize(entry) > protocolv2.MaximumStepStartStateBytes {
		return ErrV3RuntimeCapacity
	}
	history := append([]*realtimev2.StepStartState(nil), snapshot.StepStartHistory...)
	replaced := false
	for i, old := range history {
		if old.GroupId == entry.GroupId && old.StepId == entry.StepId {
			history[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		history = append(history, entry)
	}
	sort.Slice(history, func(i, j int) bool {
		if history[i].GroupId != history[j].GroupId {
			return v3UTF16Less(history[i].GroupId, history[j].GroupId)
		}
		return v3UTF16Less(history[i].StepId, history[j].StepId)
	})
	old := snapshot.StepStartHistory
	snapshot.StepStartHistory = history
	if !withinV3SnapshotCapacity(snapshot) {
		snapshot.StepStartHistory = old
		return ErrV3RuntimeCapacity
	}
	return nil
}

func withinV3SnapshotCapacity(snapshot *realtimev2.CanonicalRuntimeSnapshot) bool {
	history := &realtimev2.CanonicalRuntimeSnapshot{StepStartHistory: snapshot.StepStartHistory}
	if protocolv2.KnownSize(history) > protocolv2.MaximumStepStartHistoryBytes || protocolv2.KnownSize(snapshot) > protocolv2.MaximumCanonicalSnapshotBytes {
		return false
	}
	for _, entry := range snapshot.StepStartHistory {
		if protocolv2.KnownSize(entry) > protocolv2.MaximumStepStartStateBytes {
			return false
		}
	}
	return true
}

func rebaseV3Playback(clock *realtimev2.PlaybackClock, delta uint64) error {
	if playing := clock.GetPlaying(); playing != nil {
		if playing.ReferenceRuntimeTimeMs > math.MaxUint64-delta {
			return ErrV2RuntimeDefinition
		}
		playing.ReferenceRuntimeTimeMs += delta
	}
	return nil
}
func rebaseV3Clip(playback *realtimev2.ClipPlayback, delta uint64) error {
	if playback == nil {
		return nil
	}
	return rebaseV3Playback(playback.Playback, delta)
}

func (s *V2Session) restoreV3Step(entry *realtimev2.StepStartState) error {
	wasPaused := s.snapshot.Clock.GetPaused() != nil
	frozenBefore := s.snapshot.FrozenAnchors
	next := proto.Clone(entry).(*realtimev2.StepStartState)
	p := s.snapshot.Progression
	if p.GroupEntryEpoch == math.MaxUint64 || p.StepEntryEpoch == math.MaxUint64 || next.CapturedAtRuntimeTimeMs > s.snapshot.Clock.RuntimeTimeMs {
		return ErrV2RuntimeDefinition
	}
	delta := s.snapshot.Clock.RuntimeTimeMs - next.CapturedAtRuntimeTimeMs
	p.CurrentGroupId, p.CurrentStepId = next.GroupId, next.StepId
	p.GroupEntryEpoch++
	p.StepEntryEpoch++
	p.StepEnteredAtRuntimeTimeMs = s.snapshot.Clock.RuntimeTimeMs
	p.Phase = &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}
	s.snapshot.NodeStates = next.NodeStates
	s.snapshot.SurfaceStates = next.SurfaceStates
	s.snapshot.MediaStates = next.MediaStates
	s.snapshot.ModelClipStates = next.ModelClipStates
	s.snapshot.Variables = next.Variables
	s.snapshot.ActiveRuns = next.ActiveRuns
	ids := map[uint64]*presentationv2.RuntimeRunId{}
	var blocking []*presentationv2.RuntimeRunId
	for _, run := range s.snapshot.ActiveRuns {
		if s.snapshot.LastAllocatedRunSequence == math.MaxUint64 || run.StartedAtRuntimeTimeMs > math.MaxUint64-delta {
			return ErrV2RuntimeDefinition
		}
		s.snapshot.LastAllocatedRunSequence++
		id := &presentationv2.RuntimeRunId{AssignmentEpoch: run.RunId.AssignmentEpoch, RunSequence: s.snapshot.LastAllocatedRunSequence}
		if s.checkpointMetadata != nil {
			id.AssignmentEpoch = s.checkpointMetadata.AssignmentEpoch
		}
		ids[run.RunId.RunSequence] = id
		run.RunId = id
		run.StartedAtRuntimeTimeMs += delta
		if owner := run.Owner.GetGroup(); owner != nil {
			owner.GroupEntryEpoch = p.GroupEntryEpoch
		}
		if run.Cause.GroupId == p.CurrentGroupId {
			run.Cause.GroupEntryEpoch = p.GroupEntryEpoch
		}
		if run.Cause.GroupId == p.CurrentGroupId && run.Cause.StepId == p.CurrentStepId {
			run.Cause.StepEntryEpoch = p.StepEntryEpoch
		}
		if err := rebaseV3Playback(run.GetMedia().GetPlayback(), delta); err != nil {
			return err
		}
		if model := run.GetModelClip(); model != nil {
			if err := rebaseV3Clip(model.GetSingle(), delta); err != nil {
				return err
			}
			if fade := model.GetCrossfade(); fade != nil {
				if err := rebaseV3Clip(fade.From, delta); err != nil {
					return err
				}
				if err := rebaseV3Clip(fade.To, delta); err != nil {
					return err
				}
				if err := rebaseV3Playback(fade.TransitionClock, delta); err != nil {
					return err
				}
			}
		}
		if run.Completion == presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING {
			blocking = append(blocking, id)
		}
	}
	for _, surface := range s.snapshot.SurfaceStates {
		if surface.TransitionRunId != nil {
			id := ids[surface.TransitionRunId.RunSequence]
			if id == nil {
				return ErrV2RuntimeDefinition
			}
			surface.TransitionRunId = proto.Clone(id).(*presentationv2.RuntimeRunId)
		}
	}
	for _, media := range s.snapshot.MediaStates {
		if active := media.GetActive(); active != nil {
			id := ids[active.RunId.RunSequence]
			if id == nil {
				return ErrV2RuntimeDefinition
			}
			active.RunId = proto.Clone(id).(*presentationv2.RuntimeRunId)
			if err := rebaseV3Playback(active.Playback, delta); err != nil {
				return err
			}
		}
	}
	for _, model := range s.snapshot.ModelClipStates {
		if active := model.GetActive(); active != nil {
			id := ids[active.RunId.RunSequence]
			if id == nil {
				return ErrV2RuntimeDefinition
			}
			active.RunId = proto.Clone(id).(*presentationv2.RuntimeRunId)
		}
	}
	if len(blocking) > 0 {
		p.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: blocking, PendingNext: &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Stay{Stay: &realtimev2.StayOnStep{}}}}}
	}
	s.snapshot.StepExecution = &realtimev2.StepExecutionSnapshot{StepEntryEpoch: p.StepEntryEpoch}
	if err := s.armV2StepTimers(); err != nil {
		return err
	}
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE}}
	if err := s.freezeV3Anchors(time.Now()); err != nil {
		return err
	}
	if wasPaused {
		for i, frozen := range s.snapshot.FrozenAnchors {
			if previous := frozenV3ByNode(frozenBefore, frozen.NodeId); previous != nil {
				s.snapshot.FrozenAnchors[i] = proto.Clone(previous).(*realtimev2.FrozenAnchorDisplayState)
			}
		}
	}
	if err := s.requireV3Synchronization(realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_STEP_ENTERED, false); err != nil {
		return err
	}
	if err := captureV3StepStart(s.snapshot); err != nil {
		return err
	}
	return nil
}

func (s *V2Session) selectV3Step(ctx context.Context, command *realtimev2.RuntimeControlCommand, key, fingerprint string) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	var entry *realtimev2.StepStartState
	for _, candidate := range s.snapshot.StepStartHistory {
		if candidate.GroupId == command.StepSelection.GroupId && candidate.StepId == command.StepSelection.StepId {
			entry = candidate
			break
		}
	}
	if entry == nil {
		return v3Rejected(command.ClientEventId, realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_STEP_NOT_REACHED), nil, nil
	}
	if _, ok := s.definition.Flow.Groups[entry.GroupId].Steps[entry.StepId]; !ok {
		return nil, nil, ErrV2RuntimeDefinition
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	recovery := s.v2Recovery()
	if err := s.restoreV3Step(entry); err != nil {
		s.snapshot = previous
		_ = s.restoreV2Recovery(recovery)
		if err == ErrV3RuntimeCapacity {
			return v3Rejected(command.ClientEventId, realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED), nil, nil
		}
		return nil, nil, err
	}
	event := s.nextEvent(&realtimev2.ProjectedReliableEvent{})
	event.Payload = &realtimev2.ProjectedReliableEvent_RuntimeViewReplaced{RuntimeViewReplaced: &realtimev2.RuntimeViewReplaced{RuntimeView: s.canonicalV3RuntimeView()}}
	outcome := &realtimev2.CommandOutcome{ClientEventId: command.ClientEventId, Result: &realtimev2.CommandOutcome_Accepted{Accepted: &realtimev2.CommandAccepted{CanonicalEventId: event.EventId, ReliableSequence: event.Sequence}}}
	if !withinV3SnapshotCapacity(s.snapshot) {
		s.snapshot = previous
		_ = s.restoreV2Recovery(recovery)
		return v3Rejected(command.ClientEventId, realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED), nil, nil
	}
	s.rememberOutcome(key, fingerprint, outcome)
	events := []*realtimev2.ProjectedReliableEvent{event}
	if err := s.commitV2Mutation(ctx, previous, events); err != nil {
		return nil, nil, err
	}
	return proto.Clone(outcome).(*realtimev2.CommandOutcome), cloneV2Events(events), nil
}

func (s *V2Session) pauseV3CapacityFault(ctx context.Context, previous *realtimev2.CanonicalRuntimeSnapshot) error {
	s.snapshot = proto.Clone(previous).(*realtimev2.CanonicalRuntimeSnapshot)
	pause := &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION}
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: pause}
	event := s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Paused{Paused: pause}}}})
	if err := s.commitV2Mutation(ctx, previous, []*realtimev2.ProjectedReliableEvent{event}); err != nil {
		return err
	}
	s.faultGeneration++
	return nil
}

func (s *V2Session) rollbackV3EvaluationFault(ctx context.Context, previous *realtimev2.CanonicalRuntimeSnapshot, err error) error {
	if errors.Is(err, errV3StepEntryCapacity) {
		if pauseErr := s.pauseV3CapacityFault(ctx, previous); pauseErr != nil {
			return pauseErr
		}
	} else {
		s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
	}
	return err
}

func (s *V2Session) validateV3StepHistory(snapshot *realtimev2.CanonicalRuntimeSnapshot) error {
	for _, entry := range snapshot.StepStartHistory {
		if _, ok := s.definition.Flow.Groups[entry.GroupId].Steps[entry.StepId]; !ok {
			return ErrV2RuntimeDefinition
		}
	}
	return nil
}
