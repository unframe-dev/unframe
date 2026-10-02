package runtimecore

import (
	"encoding/json"
	"google.golang.org/protobuf/proto"
	"math"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
)

func (s *V2Session) nextV2Due(target uint64) (*realtimev2.RuntimeRunSnapshot, *realtimev2.ArmedTimer, uint64, error) {
	var chosenRun *realtimev2.RuntimeRunSnapshot
	var chosenTimer *realtimev2.ArmedTimer
	deadline := uint64(math.MaxUint64)
	currentMedia := make(map[string]v2MediaSpec)
	for _, run := range s.snapshot.ActiveRuns {
		media := run.GetMedia()
		if media == nil {
			continue
		}
		stateID := ""
		for _, state := range s.snapshot.SurfaceStates {
			if state.SurfaceId == media.SurfaceId {
				stateID = state.StateId
				break
			}
		}
		spec, ok := s.mediaSpecs[media.SurfaceId][stateID]
		if !ok {
			return nil, nil, 0, ErrV2RuntimeDefinition
		}
		currentMedia[media.SurfaceId] = spec
	}
	mediaDeadline, mediaID, mediaDue, err := nextV2MediaDue(s.snapshot, currentMedia, target)
	if err != nil {
		return nil, nil, 0, err
	}
	for _, run := range s.snapshot.ActiveRuns {
		var duration uint64
		if run.GetMedia() != nil {
			continue
		}
		if model := run.GetModelClip(); model != nil {
			clips, ok := s.modelClips[model.ModelNodeId]
			if !ok {
				return nil, nil, 0, ErrV2RuntimeDefinition
			}
			durations := make(map[string]uint64, len(clips))
			for id, clip := range clips {
				durations[id] = clip.DurationMS
			}
			due, scheduled, err := nextV2ModelDeadline(run, durations, s.snapshot.Clock.RuntimeTimeMs)
			if err != nil || scheduled && due < s.snapshot.Clock.RuntimeTimeMs {
				return nil, nil, 0, ErrV2RuntimeDefinition
			}
			if scheduled && due <= target && (chosenRun == nil || due < deadline || due == deadline && v2RunBefore(run, chosenRun)) {
				chosenRun, chosenTimer, deadline = run, nil, due
			}
			continue
		}
		if transition := run.GetSurfaceTransition(); transition != nil {
			duration = transition.DurationMs
		} else if timelineRun := run.GetTimeline(); timelineRun != nil {
			var timeline v2Timeline
			if json.Unmarshal(s.definition.Flow.Timelines[timelineRun.TimelineId], &timeline) != nil {
				return nil, nil, 0, ErrV2RuntimeDefinition
			}
			duration = timeline.DurationMilliseconds
		} else {
			return nil, nil, 0, ErrV2RuntimeUnsupported
		}
		if duration == 0 || run.StartedAtRuntimeTimeMs > math.MaxUint64-duration {
			return nil, nil, 0, ErrV2RuntimeDefinition
		}
		due := run.StartedAtRuntimeTimeMs + duration
		if due > target {
			continue
		}
		if chosenRun == nil && (chosenTimer == nil || due <= deadline) || chosenRun != nil && (due < deadline || due == deadline && v2RunBefore(run, chosenRun)) {
			chosenRun, chosenTimer, deadline = run, nil, due
		}
	}
	if mediaDue {
		for _, run := range s.snapshot.ActiveRuns {
			if proto.Equal(run.RunId, mediaID) && (chosenRun == nil || mediaDeadline < deadline || mediaDeadline == deadline && v2RunBefore(run, chosenRun)) {
				chosenRun, chosenTimer, deadline = run, nil, mediaDeadline
			}
		}
	}
	for _, timer := range s.snapshot.StepExecution.Timers {
		if timer.Fired || timer.DeadlineRuntimeTimeMs > target {
			continue
		}
		due := timer.DeadlineRuntimeTimeMs
		if chosenRun == nil && (chosenTimer == nil || due < deadline || due == deadline && timer.CueId < chosenTimer.CueId) || chosenRun != nil && due < deadline {
			chosenRun, chosenTimer, deadline = nil, timer, due
		}
	}
	if chosenRun == nil && chosenTimer == nil {
		return nil, nil, 0, nil
	}
	return chosenRun, chosenTimer, deadline, nil
}

func v2RunBefore(left, right *realtimev2.RuntimeRunSnapshot) bool {
	leftKind, rightKind := 1, 1
	leftTarget, rightTarget := "", ""
	if surface := left.GetSurfaceTransition(); surface != nil {
		leftKind = 0
		leftTarget = surface.SurfaceId
	} else if timeline := left.GetTimeline(); timeline != nil {
		leftTarget = timeline.TimelineId
	} else if media := left.GetMedia(); media != nil {
		leftKind, leftTarget = 2, media.SurfaceId
	} else if model := left.GetModelClip(); model != nil {
		leftKind, leftTarget = 3, model.ModelNodeId
	}
	if surface := right.GetSurfaceTransition(); surface != nil {
		rightKind = 0
		rightTarget = surface.SurfaceId
	} else if timeline := right.GetTimeline(); timeline != nil {
		rightTarget = timeline.TimelineId
	} else if media := right.GetMedia(); media != nil {
		rightKind, rightTarget = 2, media.SurfaceId
	} else if model := right.GetModelClip(); model != nil {
		rightKind, rightTarget = 3, model.ModelNodeId
	}
	if leftKind != rightKind {
		return leftKind < rightKind
	}
	if leftTarget != rightTarget {
		return leftTarget < rightTarget
	}
	return left.RunId.RunSequence < right.RunId.RunSequence
}
