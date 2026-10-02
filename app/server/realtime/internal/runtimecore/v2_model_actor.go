package runtimecore

import (
	"encoding/json"
	"sort"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func isV2ModelAction(kind string) bool {
	switch kind {
	case "modelClip.play", "modelClip.pause", "modelClip.resume", "modelClip.stop":
		return true
	default:
		return false
	}
}

func (s *V2Session) evaluateV2ModelActions(next *realtimev2.CanonicalRuntimeSnapshot, cue v2Cue, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, []*presentationv2.RuntimeRunId, *realtimev2.CueBatchRejected, error) {
	var events []*realtimev2.ProjectedReliableEvent
	var blocking []*presentationv2.RuntimeRunId
	claims := map[string]bool{}
	for _, action := range cue.Actions {
		if !isV2ModelAction(action.Kind) {
			continue
		}
		if claims[action.NodeID] {
			return nil, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT}, nil
		}
		claims[action.NodeID] = true
		node, ok := s.definition.Scene.Nodes[action.NodeID]
		if !ok || node.Kind != "model" || !v2OwnerActive(node.Owner, next.Progression.CurrentGroupId) {
			return nil, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID}, nil
		}
		durations := make(map[string]uint64)
		for id, clip := range s.modelClips[action.NodeID] {
			durations[id] = clip.DurationMS
		}
		if len(durations) == 0 {
			return nil, nil, nil, ErrV2RuntimeDefinition
		}
		var state *realtimev2.ModelClipRuntimeState
		for _, current := range next.ModelClipStates {
			if current.ModelNodeId == action.NodeID {
				state = current
				break
			}
		}
		if state == nil {
			return nil, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID}, nil
		}
		var active *realtimev2.RuntimeRunSnapshot
		for _, run := range next.ActiveRuns {
			if run.GetModelClip().GetModelNodeId() == action.NodeID {
				active = run
				break
			}
		}
		command := v2ModelCommand{Kind: action.Kind, NodeID: action.NodeID, ClipID: action.ClipID, Speed: action.Speed, Loop: action.Loop}
		var newID *presentationv2.RuntimeRunId
		var owner *presentationv2.RuntimeRunOwner
		var cause *presentationv2.RuntimeRunCause
		if action.Kind == "modelClip.play" {
			if s.checkpointMetadata == nil {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			switch action.Completion {
			case "blocking":
				command.Completion = presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING
			case "nonBlocking":
				command.Completion = presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING
			default:
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			var transition struct {
				Kind                 string `json:"kind"`
				DurationMilliseconds uint64 `json:"durationMilliseconds"`
				Easing               string `json:"easing"`
			}
			if json.Unmarshal(action.Transition, &transition) != nil {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			command.TransitionKind, command.DurationMs = transition.Kind, transition.DurationMilliseconds
			if transition.Kind == "crossfade" {
				easing, valid := v2Easing(transition.Easing)
				if !valid {
					return nil, nil, nil, ErrV2RuntimeDefinition
				}
				command.Easing = easing
			}
			if next.LastAllocatedRunSequence == ^uint64(0) {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			newID = &presentationv2.RuntimeRunId{AssignmentEpoch: s.checkpointMetadata.AssignmentEpoch, RunSequence: next.LastAllocatedRunSequence + 1}
			owner = &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}
			if node.Owner.Kind == "group" {
				owner.Scope = &presentationv2.RuntimeRunOwner_Group{Group: &presentationv2.GroupRunOwner{GroupId: node.Owner.GroupID, GroupEntryEpoch: next.Progression.GroupEntryEpoch}}
			}
			cause = &presentationv2.RuntimeRunCause{CueId: cue.ID, CauseEventId: causeEventID, GroupId: next.Progression.CurrentGroupId, GroupEntryEpoch: next.Progression.GroupEntryEpoch, StepId: next.Progression.CurrentStepId, StepEntryEpoch: next.Progression.StepEntryEpoch}
		}
		result, err := evaluateV2ModelAction(state, active, command, durations, next.Clock.RuntimeTimeMs, newID, owner, cause)
		if err != nil {
			return nil, nil, nil, err
		}
		if result.Rejection != 0 {
			return nil, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: result.Rejection}, nil
		}
		if result.NoOp {
			continue
		}
		if newID != nil {
			next.LastAllocatedRunSequence = newID.RunSequence
		}
		for i, current := range next.ModelClipStates {
			if current == state {
				next.ModelClipStates[i] = result.State
				break
			}
		}
		if active != nil {
			for i, run := range next.ActiveRuns {
				if run == active {
					next.ActiveRuns = append(next.ActiveRuns[:i], next.ActiveRuns[i+1:]...)
					break
				}
			}
		}
		if result.Run != nil {
			next.ActiveRuns = append(next.ActiveRuns, result.Run)
			if result.Run.Completion == presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING {
				blocking = append(blocking, proto.Clone(result.Run.RunId).(*presentationv2.RuntimeRunId))
			}
		}
		sort.Slice(next.ActiveRuns, func(i, j int) bool {
			return next.ActiveRuns[i].RunId.RunSequence < next.ActiveRuns[j].RunId.RunSequence
		})
		events = append(events, result.Events...)
	}
	return events, blocking, nil, nil
}
