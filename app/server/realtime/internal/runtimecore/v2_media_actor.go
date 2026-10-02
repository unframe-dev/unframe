package runtimecore

import (
	"math"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
)

func isV2MediaAction(kind string) bool {
	switch kind {
	case "media.play", "media.pause", "media.seek":
		return true
	default:
		return false
	}
}

func (s *V2Session) evaluateV2MediaActions(next *realtimev2.CanonicalRuntimeSnapshot, cue v2Cue, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, *realtimev2.CueBatchRejected, error) {
	var events []*realtimev2.ProjectedReliableEvent
	claims := map[string]bool{}
	for _, action := range cue.Actions {
		if action.Kind == "surface.setState" {
			claims[action.SurfaceID] = true
		}
	}
	for _, action := range cue.Actions {
		if !isV2MediaAction(action.Kind) {
			continue
		}
		if claims[action.SurfaceID] {
			return nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT}, nil
		}
		claims[action.SurfaceID] = true
		var stateID string
		for _, state := range s.snapshot.SurfaceStates {
			if state.SurfaceId == action.SurfaceID {
				stateID = state.StateId
				break
			}
		}
		spec, ok := s.mediaSpecs[action.SurfaceID][stateID]
		if !ok {
			return nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID}, nil
		}
		command := v2MediaCommand{Kind: action.Kind}
		if action.Kind == "media.seek" {
			value, ok := v2ActionValue(action.PositionSeconds, s.snapshot, cue.FixedPayload)
			seconds, number := value.(float64)
			if !ok || !number || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 0 || seconds > float64(spec.DurationMS)/1000 {
				return nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID}, nil
			}
			command.SeekMS = seconds * 1000
		}
		if s.checkpointMetadata == nil {
			return nil, nil, ErrV2RuntimeDefinition
		}
		cause := &presentationv2.RuntimeRunCause{CueId: cue.ID, CauseEventId: causeEventID, GroupId: s.snapshot.Progression.CurrentGroupId, GroupEntryEpoch: s.snapshot.Progression.GroupEntryEpoch, StepId: s.snapshot.Progression.CurrentStepId, StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch}
		applied, rejected, err := applyV2MediaCommand(next, spec, command, cause, s.checkpointMetadata.AssignmentEpoch)
		if err != nil {
			return nil, nil, err
		}
		if rejected {
			return nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID}, nil
		}
		events = append(events, applied...)
	}
	return events, nil, nil
}
