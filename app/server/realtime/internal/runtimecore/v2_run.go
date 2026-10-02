package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) AdvanceFromWall(ctx context.Context, now time.Time) ([]*realtimev2.ProjectedReliableEvent, error) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	if !now.After(s.lastTick) {
		s.mu.Unlock()
		return nil, nil
	}
	if s.snapshot.Clock.GetRunning() == nil {
		s.lastTick = now
		s.mu.Unlock()
		return nil, nil
	}
	delta := uint64(now.Sub(s.lastTick) / time.Millisecond)
	if delta == 0 {
		s.mu.Unlock()
		return nil, nil
	}
	if s.snapshot.Clock.RuntimeTimeMs > math.MaxUint64-delta {
		previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
		s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
		s.mu.Unlock()
		return nil, ErrV2RuntimeDefinition
	}
	target := s.snapshot.Clock.RuntimeTimeMs + delta
	s.mu.Unlock()
	events, err := s.advanceTo(ctx, target)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.lastTick = now
	s.mu.Unlock()
	return events, nil
}

func (s *V2Session) AdvanceTo(ctx context.Context, runtimeTimeMs uint64) ([]*realtimev2.ProjectedReliableEvent, error) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	return s.advanceTo(ctx, runtimeTimeMs)
}

func (s *V2Session) advanceTo(ctx context.Context, runtimeTimeMs uint64) ([]*realtimev2.ProjectedReliableEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetRunning() == nil || runtimeTimeMs < s.snapshot.Clock.RuntimeTimeMs {
		return nil, nil
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	var events []*realtimev2.ProjectedReliableEvent
	var currentDeadline uint64
	stepsAtDeadline := 0
	firstDeadline := true
	for s.snapshot.Clock.GetTerminating() == nil {
		run, timer, deadline, err := s.nextV2Due(runtimeTimeMs)
		if err != nil {
			s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
			return nil, err
		}
		if run == nil && timer == nil {
			break
		}
		if firstDeadline || deadline != currentDeadline {
			currentDeadline, stepsAtDeadline, firstDeadline = deadline, 0, false
		}
		if stepsAtDeadline == 1024 {
			paused := &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_MICROSTEP_LIMIT_EXCEEDED}
			s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: paused}
			events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Paused{Paused: paused}}}}))
			break
		}
		stepsAtDeadline++
		s.snapshot.Clock.RuntimeTimeMs = deadline
		if timer != nil {
			timerEvents, err := s.fireV2Timer(timer)
			if err != nil {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, err
			}
			events = append(events, timerEvents...)
			continue
		}
		if media := run.GetMedia(); media != nil {
			var stateID string
			for _, state := range s.snapshot.SurfaceStates {
				if state.SurfaceId == media.SurfaceId {
					stateID = state.StateId
					break
				}
			}
			spec, ok := s.mediaSpecs[media.SurfaceId][stateID]
			if !ok {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, ErrV2RuntimeDefinition
			}
			completed, err := completeV2MediaRun(s.snapshot, spec, run.RunId)
			if err != nil {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, err
			}
			for _, event := range completed {
				sequenced := s.nextEvent(event)
				events = append(events, sequenced)
				cueEvents, err := s.fireV2MediaCompleted(media.SurfaceId, fmt.Sprintf("event-%d", sequenced.Sequence))
				if err != nil {
					s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
					return nil, err
				}
				events = append(events, cueEvents...)
			}
			continue
		}
		if model := run.GetModelClip(); model != nil {
			clips := s.modelClips[model.ModelNodeId]
			durations := make(map[string]uint64, len(clips))
			for id, clip := range clips {
				durations[id] = clip.DurationMS
			}
			var state *realtimev2.ModelClipRuntimeState
			for _, candidate := range s.snapshot.ModelClipStates {
				if candidate.ModelNodeId == model.ModelNodeId {
					state = candidate
					break
				}
			}
			result, err := advanceV2ModelRun(state, run, durations, deadline)
			if err != nil {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, err
			}
			for index, candidate := range s.snapshot.ModelClipStates {
				if candidate == state {
					s.snapshot.ModelClipStates[index] = result.State
					break
				}
			}
			for index, candidate := range s.snapshot.ActiveRuns {
				if candidate == run {
					if result.Run == nil {
						s.snapshot.ActiveRuns = append(s.snapshot.ActiveRuns[:index], s.snapshot.ActiveRuns[index+1:]...)
					} else {
						s.snapshot.ActiveRuns[index] = result.Run
					}
					break
				}
			}
			for _, event := range result.Events {
				sequenced := s.nextEvent(event)
				events = append(events, sequenced)
				if sequenced.GetModelClipCompleted() != nil {
					cueEvents, err := s.fireV2ModelCompleted(model.ModelNodeId, sequenced.GetModelClipCompleted().HeldPose.ClipId, fmt.Sprintf("event-%d", sequenced.Sequence))
					if err != nil {
						s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
						return nil, err
					}
					events = append(events, cueEvents...)
				}
			}
			if result.Run != nil {
				continue
			}
		}
		var timeline v2Timeline
		if run.GetModelClip() != nil {
			// The Model run was removed above; blocking progression is resolved below.
		} else if run.GetTimeline() != nil {
			_ = json.Unmarshal(s.definition.Flow.Timelines[run.GetTimeline().TimelineId], &timeline)
			if err := applyV2TimelineFinal(s.snapshot, timeline); err != nil {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, err
			}
		} else if transition := run.GetSurfaceTransition(); transition != nil {
			found := false
			for _, state := range s.snapshot.SurfaceStates {
				if state.SurfaceId == transition.SurfaceId && proto.Equal(state.TransitionRunId, run.RunId) {
					state.TransitionRunId = nil
					found = true
					break
				}
			}
			if !found {
				s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
				return nil, ErrV2RuntimeDefinition
			}
		}
		for index, active := range s.snapshot.ActiveRuns {
			if proto.Equal(active.RunId, run.RunId) {
				s.snapshot.ActiveRuns = append(s.snapshot.ActiveRuns[:index], s.snapshot.ActiveRuns[index+1:]...)
				break
			}
		}
		if run.GetTimeline() != nil {
			events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_TimelineCompleted{TimelineCompleted: &realtimev2.TimelineCompleted{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), TimelineId: timeline.ID}}}))
		}
		if transition := run.GetSurfaceTransition(); transition != nil {
			events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_SurfaceTransitionCompleted{SurfaceTransitionCompleted: &realtimev2.SurfaceTransitionCompleted{SurfaceId: transition.SurfaceId, RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), StateId: transition.ToStateId}}}))
		}
		for _, track := range timeline.Tracks {
			for _, node := range s.snapshot.NodeStates {
				if node.NodeId == track.Target.NodeID {
					events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_NodeStateCommitted{NodeStateCommitted: &realtimev2.NodeStateCommitted{State: proto.Clone(node).(*realtimev2.NodeRuntimeState)}}}))
					break
				}
			}
		}
		if transitioning := s.snapshot.Progression.GetTransitioning(); transitioning != nil {
			var remaining []*presentationv2.RuntimeRunId
			for _, id := range transitioning.BlockingRunIds {
				if !proto.Equal(id, run.RunId) {
					remaining = append(remaining, id)
				}
			}
			transitioning.BlockingRunIds = remaining
			if len(remaining) == 0 {
				pending := transitioning.PendingNext
				s.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}
				if group := pending.GetGroup(); group != nil {
					groupEvents, err := s.enterV2Group(group.GroupId)
					if err != nil {
						s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
						return nil, err
					}
					for _, event := range groupEvents {
						events = append(events, s.nextEvent(event))
					}
				}
				if step := pending.GetStep(); step != nil {
					stepEvent, err := s.enterV2Step(step.StepId)
					if err != nil {
						s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
						return nil, err
					}
					events = append(events, s.nextEvent(stepEvent))
				}
				if pending.GetEnd() != nil {
					if s.completionWriter == nil || s.checkpointMetadata == nil {
						s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
						return nil, ErrV2RuntimeDefinition
					}
					events, err = s.prepareV2Termination(events, realtimev2.TerminationReason_TERMINATION_REASON_EXPLICIT_END)
					if err != nil {
						s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
						return nil, err
					}
				}
			}
		}
	}
	if s.snapshot.Clock.GetRunning() != nil {
		s.snapshot.Clock.RuntimeTimeMs = runtimeTimeMs
	}
	var err error
	if s.snapshot.Clock.GetTerminating() != nil {
		err = s.commitV2Completion(ctx, previous, events)
	} else {
		err = s.commitV2Mutation(ctx, previous, events)
	}
	if err != nil {
		return nil, err
	}
	return cloneV2Events(events), nil
}

func applyV2TimelineFinal(snapshot *realtimev2.CanonicalRuntimeSnapshot, timeline v2Timeline) error {
	for _, track := range timeline.Tracks {
		if len(track.Keyframes) == 0 {
			return ErrV2RuntimeDefinition
		}
		var node *realtimev2.NodeRuntimeState
		for _, candidate := range snapshot.NodeStates {
			if candidate.NodeId == track.Target.NodeID {
				node = candidate
				break
			}
		}
		if node == nil {
			return ErrV2RuntimeDefinition
		}
		last := track.Keyframes[len(track.Keyframes)-1].Value
		switch track.Target.Property {
		case "opacity":
			var value float64
			if json.Unmarshal(last, &value) != nil {
				return ErrV2RuntimeDefinition
			}
			node.Opacity = value
		case "transform.position", "transform.scale":
			var value [3]float64
			if json.Unmarshal(last, &value) != nil {
				return ErrV2RuntimeDefinition
			}
			target := node.Transform.Position
			if track.Target.Property == "transform.scale" {
				target = node.Transform.Scale
			}
			target.X, target.Y, target.Z = value[0], value[1], value[2]
		case "transform.rotation":
			var value [4]float64
			if json.Unmarshal(last, &value) != nil {
				return ErrV2RuntimeDefinition
			}
			node.Transform.Rotation.X, node.Transform.Rotation.Y, node.Transform.Rotation.Z, node.Transform.Rotation.W = value[0], value[1], value[2], value[3]
		default:
			return ErrV2RuntimeUnsupported
		}
	}
	return nil
}

type v2Timeline struct {
	ID                   string  `json:"id"`
	Owner                v2Owner `json:"owner"`
	DurationMilliseconds uint64  `json:"durationMilliseconds"`
	Tracks               []struct {
		Target struct {
			NodeID   string `json:"nodeId"`
			Property string `json:"property"`
		} `json:"target"`
		Keyframes []struct {
			TimeMilliseconds uint64          `json:"timeMilliseconds"`
			Value            json.RawMessage `json:"value"`
		} `json:"keyframes"`
	} `json:"tracks"`
}

type v2SurfaceTransition struct {
	Kind                 string `json:"kind"`
	DurationMilliseconds uint64 `json:"durationMilliseconds"`
	Easing               string `json:"easing"`
	Completion           string `json:"completion"`
}

func v2TransitionKind(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "cut"
	}
	var transition v2SurfaceTransition
	if json.Unmarshal(raw, &transition) != nil {
		return ""
	}
	return transition.Kind
}

func v2Easing(value string) (presentationv2.Easing, bool) {
	switch value {
	case "linear":
		return presentationv2.Easing_EASING_LINEAR, true
	case "cubicIn":
		return presentationv2.Easing_EASING_CUBIC_IN, true
	case "cubicOut":
		return presentationv2.Easing_EASING_CUBIC_OUT, true
	case "cubicInOut":
		return presentationv2.Easing_EASING_CUBIC_IN_OUT, true
	default:
		return presentationv2.Easing_EASING_UNSPECIFIED, false
	}
}

func (s *V2Session) evaluateV2RunActions(next *realtimev2.CanonicalRuntimeSnapshot, cue v2Cue, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, []*presentationv2.RuntimeRunId, *realtimev2.CueBatchRejected, error) {
	var events []*realtimev2.ProjectedReliableEvent
	var blocking []*presentationv2.RuntimeRunId
	reject := func(reason realtimev2.CueRejectionReason) ([]*realtimev2.ProjectedReliableEvent, []*presentationv2.RuntimeRunId, *realtimev2.CueBatchRejected, error) {
		return nil, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: reason}, nil
	}
	var actions []v2Action
	for _, action := range cue.Actions {
		if action.Kind == "timeline.play" || action.Kind == "timeline.stop" || action.Kind == "surface.setState" && v2TransitionKind(action.Transition) == "crossfade" {
			actions = append(actions, action)
		}
	}
	sort.Slice(actions, func(i, j int) bool {
		left, right := actions[i], actions[j]
		if left.Kind == "surface.setState" && right.Kind != "surface.setState" {
			return true
		}
		if left.Kind != "surface.setState" && right.Kind == "surface.setState" {
			return false
		}
		if left.Kind == "surface.setState" {
			return left.SurfaceID < right.SurfaceID
		}
		return left.TimelineID < right.TimelineID
	})
	for _, action := range actions {
		if action.Kind == "timeline.stop" {
			return nil, nil, nil, ErrV2RuntimeUnsupported
		}
		if s.checkpointMetadata == nil {
			return nil, nil, nil, ErrV2RuntimeDefinition
		}
		if action.Kind == "surface.setState" {
			var transition v2SurfaceTransition
			if json.Unmarshal(action.Transition, &transition) != nil || transition.Kind != "crossfade" || transition.DurationMilliseconds == 0 || transition.Completion != "blocking" {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			easing, ok := v2Easing(transition.Easing)
			if !ok {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			surface, exists := s.definition.Scene.Surfaces[action.SurfaceID]
			if !exists || surface.States[action.StateID] == nil {
				return nil, nil, nil, ErrV2RuntimeDefinition
			}
			var target *realtimev2.SurfaceRuntimeState
			for _, state := range next.SurfaceStates {
				if state.SurfaceId == action.SurfaceID {
					target = state
					break
				}
			}
			if target == nil {
				return reject(realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID)
			}
			if target.TransitionRunId != nil {
				return reject(realtimev2.CueRejectionReason_CUE_REJECTION_REASON_SURFACE_TRANSITION_ACTIVE)
			}
			if target.StateId == action.StateID {
				return reject(realtimev2.CueRejectionReason_CUE_REJECTION_REASON_SAME_STATE_CROSSFADE)
			}
			if mediaRun(next, action.SurfaceID) != nil {
				spec, ok := s.mediaSpecs[action.SurfaceID][target.StateId]
				if !ok {
					return nil, nil, nil, ErrV2RuntimeDefinition
				}
				stopped, rejected, err := applyV2MediaCommand(next, spec, v2MediaCommand{Kind: "media.stop"}, nil, 0)
				if err != nil {
					return nil, nil, nil, err
				}
				if rejected {
					return reject(realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID)
				}
				events = append(events, stopped...)
			}
			host := s.definition.Scene.Nodes[surface.HostNodeID]
			next.LastAllocatedRunSequence++
			id := &presentationv2.RuntimeRunId{AssignmentEpoch: s.checkpointMetadata.AssignmentEpoch, RunSequence: next.LastAllocatedRunSequence}
			owner := &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}
			if host.Owner.Kind == "group" {
				owner.Scope = &presentationv2.RuntimeRunOwner_Group{Group: &presentationv2.GroupRunOwner{GroupId: host.Owner.GroupID, GroupEntryEpoch: next.Progression.GroupEntryEpoch}}
			}
			cause := &presentationv2.RuntimeRunCause{CueId: cue.ID, CauseEventId: causeEventID, GroupId: next.Progression.CurrentGroupId, GroupEntryEpoch: next.Progression.GroupEntryEpoch, StepId: next.Progression.CurrentStepId, StepEntryEpoch: next.Progression.StepEntryEpoch}
			from := target.StateId
			target.StateId = action.StateID
			target.TransitionRunId = proto.Clone(id).(*presentationv2.RuntimeRunId)
			run := &realtimev2.RuntimeRunSnapshot{RunId: id, Owner: owner, Cause: cause, Completion: presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING, StartedAtRuntimeTimeMs: next.Clock.RuntimeTimeMs, Run: &realtimev2.RuntimeRunSnapshot_SurfaceTransition{SurfaceTransition: &realtimev2.SurfaceTransitionRunSnapshot{SurfaceId: action.SurfaceID, FromStateId: from, ToStateId: action.StateID, DurationMs: transition.DurationMilliseconds, Easing: easing}}}
			next.ActiveRuns = append(next.ActiveRuns, run)
			events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_SurfaceTransitionStarted{SurfaceTransitionStarted: &realtimev2.SurfaceTransitionStarted{SurfaceId: action.SurfaceID, RunId: proto.Clone(id).(*presentationv2.RuntimeRunId), FromStateId: from, StateId: action.StateID, StartedAtRuntimeTimeMs: next.Clock.RuntimeTimeMs, DurationMs: transition.DurationMilliseconds, Easing: easing, Run: proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)}}})
			blocking = append(blocking, proto.Clone(id).(*presentationv2.RuntimeRunId))
			continue
		}
		var timeline v2Timeline
		if json.Unmarshal(s.definition.Flow.Timelines[action.TimelineID], &timeline) != nil || timeline.ID != action.TimelineID || timeline.DurationMilliseconds == 0 || !v2OwnerActive(timeline.Owner, next.Progression.CurrentGroupId) || s.checkpointMetadata == nil {
			return nil, nil, nil, ErrV2RuntimeDefinition
		}
		for _, run := range next.ActiveRuns {
			if run.GetTimeline().GetTimelineId() == timeline.ID {
				return reject(realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT)
			}
		}
		next.LastAllocatedRunSequence++
		id := &presentationv2.RuntimeRunId{AssignmentEpoch: s.checkpointMetadata.AssignmentEpoch, RunSequence: next.LastAllocatedRunSequence}
		owner := &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}
		if timeline.Owner.Kind == "group" {
			owner.Scope = &presentationv2.RuntimeRunOwner_Group{Group: &presentationv2.GroupRunOwner{GroupId: timeline.Owner.GroupID, GroupEntryEpoch: next.Progression.GroupEntryEpoch}}
		}
		completion := presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING
		if action.Completion == "blocking" {
			completion = presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING
		} else if action.Completion != "nonBlocking" {
			return nil, nil, nil, fmt.Errorf("%w: timeline completion", ErrV2RuntimeDefinition)
		}
		cause := &presentationv2.RuntimeRunCause{CueId: cue.ID, CauseEventId: causeEventID, GroupId: next.Progression.CurrentGroupId, GroupEntryEpoch: next.Progression.GroupEntryEpoch, StepId: next.Progression.CurrentStepId, StepEntryEpoch: next.Progression.StepEntryEpoch}
		run := &realtimev2.RuntimeRunSnapshot{RunId: id, Owner: owner, Cause: cause, Completion: completion, StartedAtRuntimeTimeMs: next.Clock.RuntimeTimeMs, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: timeline.ID}}}
		next.ActiveRuns = append(next.ActiveRuns, run)
		events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_TimelineStarted{TimelineStarted: &realtimev2.TimelineStarted{RunId: proto.Clone(id).(*presentationv2.RuntimeRunId), TimelineId: timeline.ID, Owner: proto.Clone(owner).(*presentationv2.RuntimeRunOwner), Cause: proto.Clone(cause).(*presentationv2.RuntimeRunCause), Completion: completion, StartedAtRuntimeTimeMs: next.Clock.RuntimeTimeMs}}})
		if completion == presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING {
			blocking = append(blocking, proto.Clone(id).(*presentationv2.RuntimeRunId))
		}
	}
	return events, blocking, nil, nil
}

func v2PendingNext(cue v2Cue) (*realtimev2.ProgressionNext, error) {
	switch cue.Next.Kind {
	case "stay":
		return &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Stay{Stay: &realtimev2.StayOnStep{}}}, nil
	case "step":
		return &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Step{Step: &realtimev2.NextStep{StepId: cue.Next.StepID}}}, nil
	case "group":
		return &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Group{Group: &realtimev2.NextGroup{GroupId: cue.Next.GroupID}}}, nil
	case "end":
		return &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_End{End: &realtimev2.EndPresentation{}}}, nil
	default:
		return nil, ErrV2RuntimeDefinition
	}
}
