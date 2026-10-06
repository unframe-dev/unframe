package runtimecore

import (
	"fmt"
	"math"
	"sort"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func (s *V2Session) applySelectedV2Cue(cue v2Cue, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, *realtimev2.CueBatchRejected, error) {
	if conflict, err := s.v2TimelineBatchConflict(cue); err != nil {
		return nil, nil, err
	} else if conflict {
		return nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT}, nil
	}
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	if cue.Next.Kind == "step" {
		if _, found := group.Steps[cue.Next.StepID]; !found {
			return nil, nil, ErrV2RuntimeDefinition
		}
	}
	immediate := cue
	immediate.Actions = nil
	for _, action := range cue.Actions {
		if action.Kind == "timeline.play" || action.Kind == "timeline.stop" || action.Kind == "surface.setState" && v2TransitionKind(action.Transition) == "crossfade" {
			continue
		}
		if isV2MediaAction(action.Kind) {
			continue
		}
		if isV2ModelAction(action.Kind) {
			continue
		}
		if action.Kind == "surface.setState" && v2TransitionKind(action.Transition) == "cut" {
			action.Transition = nil
		}
		immediate.Actions = append(immediate.Actions, action)
	}
	next, actionEvents, rejection, err := evaluateV2ActionsWithMedia(s.definition, s.snapshot, immediate, nil, s.mediaSpecs)
	if err != nil || rejection != nil {
		return nil, rejection, err
	}
	runEvents, blocking, rejection, err := s.evaluateV2RunActions(next, cue, causeEventID)
	if err != nil || rejection != nil {
		return nil, rejection, err
	}
	mediaEvents, rejection, err := s.evaluateV2MediaActions(next, cue, causeEventID)
	if err != nil || rejection != nil {
		return nil, rejection, err
	}
	modelEvents, modelBlocking, rejection, err := s.evaluateV2ModelActions(next, cue, causeEventID)
	if err != nil || rejection != nil {
		return nil, rejection, err
	}
	blocking = append(blocking, modelBlocking...)
	if cue.FirePolicy.Kind == "repeatable" && next.Clock.RuntimeTimeMs > math.MaxUint64-cue.FirePolicy.CooldownMilliseconds {
		return nil, nil, ErrV2RuntimeDefinition
	}
	s.snapshot = next
	if cue.FirePolicy.Kind == "repeatable" {
		deadline := next.Clock.RuntimeTimeMs + cue.FirePolicy.CooldownMilliseconds
		found := false
		for _, cooldown := range next.StepExecution.Cooldowns {
			if cooldown.CueId == cue.ID {
				cooldown.NextEligibleRuntimeTimeMs = deadline
				found = true
				break
			}
		}
		if !found {
			next.StepExecution.Cooldowns = append(next.StepExecution.Cooldowns, &realtimev2.CueCooldown{CueId: cue.ID, NextEligibleRuntimeTimeMs: deadline})
		}
		sort.Slice(next.StepExecution.Cooldowns, func(i, j int) bool {
			return next.StepExecution.Cooldowns[i].CueId < next.StepExecution.Cooldowns[j].CueId
		})
	}
	if cue.FirePolicy.Kind == "oncePerStepEntry" {
		s.snapshot.StepExecution.ConsumedCueIds = append(s.snapshot.StepExecution.ConsumedCueIds, cue.ID)
		sort.Strings(s.snapshot.StepExecution.ConsumedCueIds)
	}
	events := []*realtimev2.ProjectedReliableEvent{s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_CueAccepted{CueAccepted: &realtimev2.CueAccepted{GroupId: group.ID, StepId: step.ID, CueId: cue.ID}}})}
	for _, event := range runEvents {
		events = append(events, s.nextEvent(event))
	}
	for _, event := range mediaEvents {
		events = append(events, s.nextEvent(event))
	}
	for _, event := range modelEvents {
		events = append(events, s.nextEvent(event))
	}
	for _, event := range actionEvents {
		events = append(events, s.nextEvent(event))
	}
	if len(blocking) != 0 {
		pending, err := v2PendingNext(cue)
		if err != nil {
			return nil, nil, err
		}
		s.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: blocking, PendingNext: pending}}
		return events, nil, nil
	}
	switch cue.Next.Kind {
	case "stay":
	case "group":
		groupEvents, err := s.enterV2Group(cue.Next.GroupID)
		if err != nil {
			return nil, nil, err
		}
		for _, event := range groupEvents {
			events = append(events, s.nextEvent(event))
		}
	case "step":
		stepEvent, err := s.enterV2Step(cue.Next.StepID)
		if err != nil {
			return nil, nil, err
		}
		events = append(events, s.nextEvent(stepEvent))
	case "end":
		if s.completionWriter == nil || s.checkpointMetadata == nil {
			return nil, nil, ErrV2RuntimeDefinition
		}
		var err error
		events, err = s.prepareV2Termination(events, realtimev2.TerminationReason_TERMINATION_REASON_EXPLICIT_END)
		if err != nil {
			return nil, nil, err
		}
	default:
		return nil, nil, ErrV2RuntimeDefinition
	}
	return events, nil, nil
}

func (s *V2Session) enterV2Step(targetID string) (*realtimev2.ProjectedReliableEvent, error) {
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	if _, found := group.Steps[targetID]; !found {
		return nil, ErrV2RuntimeDefinition
	}
	s.snapshot.Progression.CurrentStepId = targetID
	s.snapshot.Progression.StepEntryEpoch++
	s.snapshot.Progression.StepEnteredAtRuntimeTimeMs = s.snapshot.Clock.RuntimeTimeMs
	s.snapshot.StepExecution = &realtimev2.StepExecutionSnapshot{StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch}
	if err := s.armV2StepTimers(); err != nil {
		return nil, err
	}
	return &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_StepEntered{StepEntered: &realtimev2.StepEntered{GroupId: s.snapshot.Progression.CurrentGroupId, GroupEntryEpoch: s.snapshot.Progression.GroupEntryEpoch, StepId: targetID, StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch, EnteredAtRuntimeTimeMs: s.snapshot.Clock.RuntimeTimeMs}}}, nil
}

func (s *V2Session) armV2StepTimers() error {
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	for _, cue := range step.Cues {
		if cue.Trigger.Kind != "timer" {
			continue
		}
		if cue.Trigger.AfterMilliseconds == 0 || s.snapshot.Clock.RuntimeTimeMs > math.MaxUint64-cue.Trigger.AfterMilliseconds {
			return ErrV2RuntimeDefinition
		}
		s.snapshot.StepExecution.Timers = append(s.snapshot.StepExecution.Timers, &realtimev2.ArmedTimer{CueId: cue.ID, DeadlineRuntimeTimeMs: s.snapshot.Clock.RuntimeTimeMs + cue.Trigger.AfterMilliseconds})
	}
	sort.Slice(s.snapshot.StepExecution.Timers, func(i, j int) bool {
		return s.snapshot.StepExecution.Timers[i].CueId < s.snapshot.StepExecution.Timers[j].CueId
	})
	return nil
}

func (s *V2Session) fireV2Timer(timer *realtimev2.ArmedTimer) ([]*realtimev2.ProjectedReliableEvent, error) {
	timer.Fired = true
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	for _, cue := range step.Cues {
		if cue.ID != timer.CueId {
			continue
		}
		if cue.Trigger.Kind != "timer" {
			return nil, ErrV2RuntimeDefinition
		}
		if s.snapshot.Progression.GetTransitioning() != nil || !v2CueEligible(cue, s.snapshot) || !v2GuardPasses(cue, s.snapshot, nil) {
			return nil, nil
		}
		cause := fmt.Sprintf("event-%d", s.snapshot.ReliableSequence+1)
		events, rejection, err := s.applySelectedV2Cue(cue, cause)
		if err != nil {
			return nil, err
		}
		if rejection != nil {
			return nil, nil
		}
		return events, nil
	}
	return nil, ErrV2RuntimeDefinition
}

func (s *V2Session) fireV2MediaCompleted(surfaceID string, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, error) {
	if s.snapshot.Progression.GetTransitioning() != nil {
		return nil, nil
	}
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	var candidates []v2Cue
	for _, cue := range step.Cues {
		if cue.Trigger.Kind != "mediaCompleted" || cue.Trigger.SurfaceID != surfaceID || !v2CueEligible(cue, s.snapshot) || !v2GuardPasses(cue, s.snapshot, nil) {
			continue
		}
		candidates = append(candidates, cue)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		if candidates[i].Order != candidates[j].Order {
			return candidates[i].Order < candidates[j].Order
		}
		return candidates[i].ID < candidates[j].ID
	})
	if len(candidates) == 0 {
		return nil, nil
	}
	events, rejection, err := s.applySelectedV2Cue(candidates[0], causeEventID)
	if rejection != nil {
		return nil, nil
	}
	return events, err
}

func (s *V2Session) fireV2ModelCompleted(nodeID, clipID, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, error) {
	if s.snapshot.Progression.GetTransitioning() != nil {
		return nil, nil
	}
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	var candidates []v2Cue
	for _, cue := range step.Cues {
		if cue.Trigger.Kind != "modelClipCompleted" || cue.Trigger.NodeID != nodeID || cue.Trigger.ClipID != clipID || !v2CueEligible(cue, s.snapshot) || !v2GuardPasses(cue, s.snapshot, nil) {
			continue
		}
		candidates = append(candidates, cue)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		if candidates[i].Order != candidates[j].Order {
			return candidates[i].Order < candidates[j].Order
		}
		return candidates[i].ID < candidates[j].ID
	})
	if len(candidates) == 0 {
		return nil, nil
	}
	events, rejection, err := s.applySelectedV2Cue(candidates[0], causeEventID)
	if rejection != nil {
		return nil, nil
	}
	return events, err
}

func v2CueEligible(cue v2Cue, snapshot *realtimev2.CanonicalRuntimeSnapshot) bool {
	if cue.FirePolicy.Kind == "oncePerStepEntry" {
		return !containsV2(snapshot.StepExecution.ConsumedCueIds, cue.ID)
	}
	for _, cooldown := range snapshot.StepExecution.Cooldowns {
		if cooldown.CueId == cue.ID && snapshot.Clock.RuntimeTimeMs < cooldown.NextEligibleRuntimeTimeMs {
			return false
		}
	}
	return true
}

// EnabledLogicalInputs derives input availability from the same canonical cut used for projection.
func (s *V2Session) EnabledLogicalInputs(snapshot *realtimev2.CanonicalRuntimeSnapshot) []string {
	if snapshot.Clock.GetRunning() == nil || snapshot.Progression.GetTransitioning() != nil {
		return nil
	}
	names := map[string]bool{}
	for _, cue := range s.definition.Flow.Groups[snapshot.Progression.CurrentGroupId].Steps[snapshot.Progression.CurrentStepId].Cues {
		if cue.Trigger.Kind == "logicalInput" && cue.Trigger.Actor.Kind != "system" && v2CueEligible(cue, snapshot) && v2GuardPasses(cue, snapshot, nil) {
			names[cue.Trigger.Action] = true
		}
	}
	result := make([]string, 0, len(names))
	for name := range names {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

func (s *V2Session) fireV2TimelineCompleted(timelineID, causeEventID string) ([]*realtimev2.ProjectedReliableEvent, error) {
	if s.snapshot.Progression.GetTransitioning() != nil {
		return nil, nil
	}
	var candidates []v2Cue
	for _, cue := range s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId].Steps[s.snapshot.Progression.CurrentStepId].Cues {
		if cue.Trigger.Kind == "timelineCompleted" && cue.Trigger.TimelineID == timelineID && v2CueEligible(cue, s.snapshot) && v2GuardPasses(cue, s.snapshot, nil) {
			candidates = append(candidates, cue)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.Priority != b.Priority {
			return a.Priority > b.Priority
		}
		if a.Order != b.Order {
			return a.Order < b.Order
		}
		return a.ID < b.ID
	})
	if len(candidates) == 0 {
		return nil, nil
	}
	events, rejection, err := s.applySelectedV2Cue(candidates[0], causeEventID)
	if rejection != nil {
		return nil, nil
	}
	return events, err
}
