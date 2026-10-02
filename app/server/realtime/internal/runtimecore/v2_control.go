package runtimecore

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) ConfigureCompletion(writer V2CompletionWriter) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.completionWriter = writer
}

func (s *V2Session) RuntimeControl(ctx context.Context, identity session.Identity, command *realtimev2.RuntimeControlCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if err := protocolv2.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
	if identity.Role != session.RolePresenter {
		return nil, nil, ErrV2PresenterRequired
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evictV2Outcomes(time.Now())
	if command.PresentationOriginVersion != s.snapshot.PresentationOrigin.Version {
		return nil, nil, ErrV2OriginMismatch
	}
	key := identity.ParticipantID + "\x00" + command.ClientEventId
	fingerprint := fmt.Sprintf("runtimeControl\x00%d\x00%d", command.Kind, command.PresentationOriginVersion)
	if stored, ok := s.outcomes[key]; ok {
		if stored.fingerprint != fingerprint {
			return nil, nil, ErrV2IdempotencyKeyReused
		}
		return proto.Clone(stored.outcome).(*realtimev2.CommandOutcome), nil, nil
	}
	noOp := realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_UNSPECIFIED
	if s.snapshot.Clock.GetTerminating() != nil {
		noOp = realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_ALREADY_TERMINATING
	} else if command.Kind == realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE && s.snapshot.Clock.GetPaused() != nil {
		noOp = realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_ALREADY_PAUSED
	} else if command.Kind == realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME && s.snapshot.Clock.GetRunning() != nil {
		noOp = realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_ALREADY_RUNNING
	}
	if noOp != realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_UNSPECIFIED {
		outcome := &realtimev2.CommandOutcome{ClientEventId: command.ClientEventId, Result: &realtimev2.CommandOutcome_NoOp{NoOp: &realtimev2.CommandNoOp{Reason: noOp}}}
		s.rememberOutcome(key, fingerprint, outcome)
		return proto.Clone(outcome).(*realtimev2.CommandOutcome), nil, nil
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	var status *realtimev2.RuntimeStatusChanged
	switch command.Kind {
	case realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE:
		s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE}}
		status = &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE}}}
	case realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME:
		if err := s.validateV2Resume(ctx); err != nil {
			return nil, nil, err
		}
		s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Running{Running: &realtimev2.Running{}}
		status = &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Running{Running: &realtimev2.Running{}}}
	case realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END:
		if s.completionWriter == nil || s.checkpointMetadata == nil {
			return nil, nil, ErrV2RuntimeDefinition
		}
	default:
		return nil, nil, ErrV2RuntimeDefinition
	}
	var events []*realtimev2.ProjectedReliableEvent
	if command.Kind == realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END {
		var err error
		events, err = s.prepareV2Termination(events, realtimev2.TerminationReason_TERMINATION_REASON_EXPLICIT_END)
		if err != nil {
			s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
			return nil, nil, err
		}
		status = nil
	}
	var mainEvent *realtimev2.ProjectedReliableEvent
	if status != nil {
		mainEvent = s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: status}})
		events = append(events, mainEvent)
	} else {
		mainEvent = events[len(events)-2]
	}
	if command.Kind == realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END {
		if err := s.commitV2Completion(ctx, previous, events); err != nil {
			return nil, nil, err
		}
	} else if err := s.commitV2Mutation(ctx, previous, events); err != nil {
		return nil, nil, err
	}
	if command.Kind == realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME {
		s.lastTick = time.Now()
	}
	outcome := &realtimev2.CommandOutcome{ClientEventId: command.ClientEventId, Result: &realtimev2.CommandOutcome_Accepted{Accepted: &realtimev2.CommandAccepted{CanonicalEventId: mainEvent.EventId, ReliableSequence: mainEvent.Sequence}}}
	s.rememberOutcome(key, fingerprint, outcome)
	return proto.Clone(outcome).(*realtimev2.CommandOutcome), cloneV2Events(events), nil
}

func (s *V2Session) validateV2Resume(ctx context.Context) error {
	if paused := s.snapshot.Clock.GetPaused(); paused != nil && paused.Reason == realtimev2.PauseReason_PAUSE_REASON_RECOVERY_GAP {
		return ErrV2RuntimeDefinition
	}
	epoch := uint64(1)
	if s.checkpointMetadata != nil {
		epoch = s.checkpointMetadata.AssignmentEpoch
	} else if len(s.snapshot.ActiveRuns) != 0 {
		epoch = s.snapshot.ActiveRuns[0].RunId.AssignmentEpoch
	}
	if err := protocolv2.ValidateSnapshot(s.snapshot, s.validationCatalog, epoch); err != nil {
		return err
	}
	_, _, _, err := s.nextV2Due(math.MaxUint64)
	if err != nil {
		return err
	}
	if s.resumeValidator != nil {
		validate := s.resumeValidator
		s.mu.Unlock()
		err := validate(ctx)
		s.mu.Lock()
		return err
	}
	return nil
}

func (s *V2Session) prepareV2Termination(events []*realtimev2.ProjectedReliableEvent, reason realtimev2.TerminationReason) ([]*realtimev2.ProjectedReliableEvent, error) {
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Terminating{Terminating: &realtimev2.Terminating{Reason: reason}}
	sort.Slice(s.snapshot.ActiveRuns, func(i, j int) bool {
		return s.snapshot.ActiveRuns[i].RunId.RunSequence < s.snapshot.ActiveRuns[j].RunId.RunSequence
	})
	activeRuns := append([]*realtimev2.RuntimeRunSnapshot(nil), s.snapshot.ActiveRuns...)
	cancellations := make(map[uint64]*realtimev2.ProjectedReliableEvent)
	for _, run := range activeRuns {
		if timeline := run.GetTimeline(); timeline != nil {
			cancellations[run.RunId.RunSequence] = &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_TimelineCanceled{TimelineCanceled: &realtimev2.TimelineCanceled{RunId: run.RunId, TimelineId: timeline.TimelineId, Reason: realtimev2.TimelineCancelReason_TIMELINE_CANCEL_REASON_PRESENTATION_ENDED}}}
		}
	}
	for _, canceled := range cancelV2MediaRuns(s.snapshot, realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_PRESENTATION_ENDED, "") {
		cancellations[canceled.GetMediaCanceled().RunId.RunSequence] = canceled
	}
	for _, run := range activeRuns {
		model := run.GetModelClip()
		if model == nil {
			continue
		}
		matched := false
		for index, state := range s.snapshot.ModelClipStates {
			if state.ModelNodeId != model.ModelNodeId {
				continue
			}
			result, err := cancelV2ModelRun(state, run, realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_PRESENTATION_ENDED)
			if err != nil {
				return nil, err
			}
			s.snapshot.ModelClipStates[index] = result.State
			for _, event := range result.Events {
				cancellations[run.RunId.RunSequence] = event
			}
			matched = true
			break
		}
		if !matched {
			return nil, ErrV2RuntimeDefinition
		}
	}
	for _, run := range activeRuns {
		if canceled := cancellations[run.RunId.RunSequence]; canceled != nil {
			events = append(events, s.nextEvent(canceled))
		}
	}
	for _, surface := range s.snapshot.SurfaceStates {
		surface.TransitionRunId = nil
	}
	s.snapshot.ActiveRuns = nil
	s.snapshot.StepExecution.Timers = nil
	s.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}
	events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Terminating{Terminating: &realtimev2.Terminating{Reason: reason}}}}}))
	events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_PresentationEnded{PresentationEnded: &realtimev2.PresentationEnded{Reason: reason}}}))
	return events, nil
}

func (s *V2Session) commitV2Completion(ctx context.Context, previous *realtimev2.CanonicalRuntimeSnapshot, events []*realtimev2.ProjectedReliableEvent, previousTracking ...v2TrackingEvaluator) error {
	candidate := s.snapshot
	candidateTracking := s.tracking
	metadata := proto.Clone(s.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
	metadata.CheckpointSequence++
	catalog := proto.Clone(s.checkpointCatalog).(*presentationv2.ProjectedRuntimeCatalog)
	writer := s.completionWriter
	participants := make([]V2Participant, 0, len(s.participants))
	for id, role := range s.participants {
		participants = append(participants, V2Participant{UserID: id, Role: v2RoleName(role)})
	}
	sort.Slice(participants, func(i, j int) bool { return participants[i].UserID < participants[j].UserID })
	startedAt := s.startedAt.UTC().Format(time.RFC3339Nano)
	s.snapshot = previous
	if len(previousTracking) != 0 {
		s.tracking = previousTracking[0]
	}
	s.mu.Unlock()
	checkpoint, encodeErr := protocolv2.EncodeCheckpoint(candidate, metadata, catalog)
	var writeErr error
	if encodeErr == nil {
		writeErr = writer.CompleteCheckpoint(ctx, checkpoint, startedAt, time.Now().UTC().Format(time.RFC3339Nano), participants)
	}
	s.mu.Lock()
	if encodeErr != nil {
		s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
		return encodeErr
	}
	if writeErr != nil {
		s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED)
		return fmt.Errorf("%w: %v", ErrV2PersistenceUnavailable, writeErr)
	}
	s.snapshot = candidate
	if len(previousTracking) != 0 {
		s.tracking = candidateTracking
	}
	s.checkpointMetadata.CheckpointSequence = checkpoint.CheckpointSequence
	s.publishV2Events(events)
	return nil
}

func v2RoleName(role session.Role) string {
	if role == session.RolePresenter {
		return "presenter"
	}
	return "viewer"
}
