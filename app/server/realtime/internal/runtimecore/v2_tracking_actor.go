package runtimecore

import (
	"context"
	"fmt"
	"sort"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func v2TrackingCueFromDefinition(cue v2Cue) (v2TrackingCue, error) {
	trigger := cue.Trigger
	tracked := v2TrackingCue{ID: cue.ID, Kind: trigger.Kind, SubjectKind: trigger.Subject.Kind, ZoneID: trigger.ZoneID, Edge: trigger.Edge, DwellMilliseconds: trigger.DwellMilliseconds, HysteresisMeters: trigger.HysteresisMeters, MinimumDistanceMeters: trigger.MinimumDistanceMeters, WindowMilliseconds: trigger.WindowMilliseconds}
	if trigger.Subject.Kind == "anchor" {
		switch trigger.Subject.Target {
		case "head":
			tracked.Target = realtimev2.TrackedTarget_TRACKED_TARGET_HEAD
		case "leftHand":
			tracked.Target = realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND
		case "rightHand":
			tracked.Target = realtimev2.TrackedTarget_TRACKED_TARGET_RIGHT_HAND
		case "body":
			tracked.Target = realtimev2.TrackedTarget_TRACKED_TARGET_BODY
		default:
			return tracked, ErrV2RuntimeDefinition
		}
	} else if trigger.Subject.Kind != "participant" {
		return tracked, ErrV2RuntimeDefinition
	}
	if trigger.Kind != "zoneEdge" && trigger.Kind != "motion" {
		return tracked, ErrV2RuntimeDefinition
	}
	return tracked, nil
}

func (s *V2Session) AcceptTracking(ctx context.Context, identity session.Identity, frame *realtimev2.TrackingFrame, receivedAt time.Time, observedAtMs uint64) ([]v2PresentedTrackingSample, []*realtimev2.ProjectedReliableEvent, error) {
	if identity.Role != session.RolePresenter {
		return nil, nil, ErrV2PresenterRequired
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetRunning() == nil {
		return nil, nil, ErrV2RuntimeDefinition
	}
	group := s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId]
	step := group.Steps[s.snapshot.Progression.CurrentStepId]
	definition := v2TrackingDefinition{Zones: s.definition.Stage.Zones, CurrentGroupID: group.ID, GroupEntryEpoch: s.snapshot.Progression.GroupEntryEpoch, CurrentStepID: step.ID, StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch}
	byID := make(map[string]v2Cue)
	for _, cue := range step.Cues {
		if cue.Trigger.Kind != "zoneEdge" && cue.Trigger.Kind != "motion" {
			continue
		}
		tracked, err := v2TrackingCueFromDefinition(cue)
		if err != nil {
			return nil, nil, err
		}
		definition.Cues = append(definition.Cues, tracked)
		byID[cue.ID] = cue
	}
	previousEvaluator := s.tracking.Clone()
	samples, fired, err := s.tracking.Accept(frame, receivedAt, observedAtMs, definition, s.snapshot.PresentationOrigin.Version)
	if err != nil {
		return nil, nil, err
	}
	if len(fired) == 0 || s.snapshot.Progression.GetTransitioning() != nil {
		return samples, nil, nil
	}
	var candidates []v2Cue
	for _, id := range fired {
		cue := byID[id]
		if cue.FirePolicy.Kind == "oncePerStepEntry" && containsV2(s.snapshot.StepExecution.ConsumedCueIds, id) || !v2GuardPasses(cue, s.snapshot, nil) {
			continue
		}
		candidates = append(candidates, cue)
	}
	if len(candidates) == 0 {
		return samples, nil, nil
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
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	cause := fmt.Sprintf("event-%d", s.snapshot.ReliableSequence+1)
	events, rejection, err := s.applySelectedV2Cue(candidates[0], cause)
	if err != nil {
		s.snapshot = previous
		s.tracking = previousEvaluator
		return nil, nil, err
	}
	if rejection != nil {
		return samples, nil, nil
	}
	if s.snapshot.Clock.GetTerminating() != nil {
		err = s.commitV2Completion(ctx, previous, events, previousEvaluator)
	} else {
		err = s.commitV2Mutation(ctx, previous, events, previousEvaluator)
	}
	if err != nil {
		s.tracking = previousEvaluator
		return nil, nil, err
	}
	return samples, cloneV2Events(events), nil
}
