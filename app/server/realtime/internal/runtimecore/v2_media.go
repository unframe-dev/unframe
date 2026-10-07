package runtimecore

import (
	"errors"
	"math"
	"sort"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

var errV2MediaInvariant = errors.New("media runtime state is inconsistent")

type v2MediaSpec struct {
	SurfaceID  string
	DurationMS uint64
	Loop       bool
	Owner      v2Owner
}

type v2MediaCommand struct {
	Kind   string
	SeekMS float64
}

func mediaPlaybackPosition(clock *realtimev2.PlaybackClock, runtimeMS uint64, durationMS uint64, loop bool) (float64, error) {
	if clock == nil || durationMS == 0 || durationMS > 1<<53-1 {
		return 0, errV2MediaInvariant
	}
	var position float64
	switch value := clock.Clock.(type) {
	case *realtimev2.PlaybackClock_Paused:
		position = value.Paused.PositionMs
	case *realtimev2.PlaybackClock_Playing:
		if value.Playing.ReferenceRuntimeTimeMs > runtimeMS {
			return 0, errV2MediaInvariant
		}
		position = value.Playing.PositionAtReferenceMs + float64(runtimeMS-value.Playing.ReferenceRuntimeTimeMs)
	default:
		return 0, errV2MediaInvariant
	}
	if math.IsNaN(position) || math.IsInf(position, 0) || position < 0 {
		return 0, errV2MediaInvariant
	}
	if loop {
		position = math.Mod(position, float64(durationMS))
	} else if position > float64(durationMS) {
		position = float64(durationMS)
	}
	if position == 0 {
		position = 0
	}
	return position, nil
}

func mediaRun(snapshot *realtimev2.CanonicalRuntimeSnapshot, surfaceID string) *realtimev2.RuntimeRunSnapshot {
	for _, run := range snapshot.ActiveRuns {
		if run.GetMedia().GetSurfaceId() == surfaceID {
			return run
		}
	}
	return nil
}

func mediaState(snapshot *realtimev2.CanonicalRuntimeSnapshot, surfaceID string) *realtimev2.MediaRuntimeState {
	for _, state := range snapshot.MediaStates {
		if state.SurfaceId == surfaceID {
			return state
		}
	}
	return nil
}

func applyV2MediaCommand(snapshot *realtimev2.CanonicalRuntimeSnapshot, spec v2MediaSpec, command v2MediaCommand, cause *presentationv2.RuntimeRunCause, assignmentEpoch uint64) ([]*realtimev2.ProjectedReliableEvent, bool, error) {
	if snapshot == nil || snapshot.Clock == nil || spec.SurfaceID == "" || spec.DurationMS == 0 || spec.DurationMS > 1<<53-1 {
		return nil, false, errV2MediaInvariant
	}
	state := mediaState(snapshot, spec.SurfaceID)
	if state == nil {
		return nil, true, nil
	}
	if state.GetStopped() == nil && state.GetActive() == nil {
		return nil, false, errV2MediaInvariant
	}
	if spec.Owner.Kind == "group" && (snapshot.Progression == nil || snapshot.Progression.CurrentGroupId != spec.Owner.GroupID) {
		return nil, true, nil
	}
	run := mediaRun(snapshot, spec.SurfaceID)
	if (run == nil) != (state.GetActive() == nil) {
		return nil, false, errV2MediaInvariant
	}
	if run != nil && (run.RunId == nil || state.GetActive().RunId == nil || run.GetMedia().Playback == nil || state.GetActive().Playback == nil) {
		return nil, false, errV2MediaInvariant
	}
	now := snapshot.Clock.RuntimeTimeMs
	var position float64
	if run != nil {
		if !proto.Equal(run.RunId, state.GetActive().RunId) || !proto.Equal(run.GetMedia().Playback, state.GetActive().Playback) {
			return nil, false, errV2MediaInvariant
		}
		var err error
		position, err = mediaPlaybackPosition(run.GetMedia().Playback, now, spec.DurationMS, spec.Loop)
		if err != nil {
			return nil, false, err
		}
	}
	setClock := func(clock *realtimev2.PlaybackClock) {
		run.GetMedia().Playback = clock
		state.GetActive().Playback = proto.Clone(clock).(*realtimev2.PlaybackClock)
	}
	switch command.Kind {
	case "media.play":
		if run != nil {
			if run.GetMedia().Playback.GetPlaying() != nil {
				return nil, false, nil
			}
			playing := &realtimev2.PlayingClock{PositionAtReferenceMs: position, ReferenceRuntimeTimeMs: now}
			setClock(&realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: playing}})
			return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaResumed{MediaResumed: &realtimev2.MediaResumed{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), SurfaceId: spec.SurfaceID, Playback: proto.Clone(playing).(*realtimev2.PlayingClock), Run: proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)}}}}, false, nil
		}
		if state.GetStopped() == nil || cause == nil || assignmentEpoch == 0 || snapshot.LastAllocatedRunSequence == ^uint64(0) {
			return nil, false, errV2MediaInvariant
		}
		position = state.GetStopped().HeldPositionMs
		if math.IsNaN(position) || math.IsInf(position, 0) || position < 0 || position > float64(spec.DurationMS) {
			return nil, false, errV2MediaInvariant
		}
		clock := &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{PositionAtReferenceMs: position, ReferenceRuntimeTimeMs: now}}}
		owner := &presentationv2.RuntimeRunOwner{}
		switch spec.Owner.Kind {
		case "group":
			owner.Scope = &presentationv2.RuntimeRunOwner_Group{Group: &presentationv2.GroupRunOwner{GroupId: spec.Owner.GroupID, GroupEntryEpoch: snapshot.Progression.GroupEntryEpoch}}
		case "presentation":
			owner.Scope = &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}
		default:
			return nil, false, errV2MediaInvariant
		}
		snapshot.LastAllocatedRunSequence++
		id := &presentationv2.RuntimeRunId{AssignmentEpoch: assignmentEpoch, RunSequence: snapshot.LastAllocatedRunSequence}
		run = &realtimev2.RuntimeRunSnapshot{RunId: id, Owner: owner, Cause: proto.Clone(cause).(*presentationv2.RuntimeRunCause), Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, StartedAtRuntimeTimeMs: now, Run: &realtimev2.RuntimeRunSnapshot_Media{Media: &realtimev2.MediaRunSnapshot{SurfaceId: spec.SurfaceID, Playback: clock}}}
		snapshot.ActiveRuns = append(snapshot.ActiveRuns, run)
		state.State = &realtimev2.MediaRuntimeState_Active{Active: &realtimev2.MediaActive{RunId: proto.Clone(id).(*presentationv2.RuntimeRunId), Playback: proto.Clone(clock).(*realtimev2.PlaybackClock)}}
		return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaStarted{MediaStarted: &realtimev2.MediaStarted{RunId: proto.Clone(id).(*presentationv2.RuntimeRunId), SurfaceId: spec.SurfaceID, Playback: proto.Clone(clock).(*realtimev2.PlaybackClock), Run: proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)}}}}, false, nil
	case "media.pause":
		if run == nil {
			return nil, true, nil
		}
		if run.GetMedia().Playback.GetPaused() != nil {
			return nil, false, nil
		}
		setClock(&realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{PositionMs: position}}})
		return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaPaused{MediaPaused: &realtimev2.MediaPaused{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), SurfaceId: spec.SurfaceID, PositionMs: position, Run: proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)}}}}, false, nil
	case "media.seek":
		if math.IsNaN(command.SeekMS) || math.IsInf(command.SeekMS, 0) || command.SeekMS < 0 || command.SeekMS > float64(spec.DurationMS) {
			return nil, true, nil
		}
		position = command.SeekMS
		if position == 0 {
			position = 0
		}
		if run == nil {
			state.GetStopped().HeldPositionMs = position
			return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaStoppedSeeked{MediaStoppedSeeked: &realtimev2.MediaStoppedSeeked{SurfaceId: spec.SurfaceID, HeldPositionMs: position}}}}, false, nil
		}
		var clock *realtimev2.PlaybackClock
		if run.GetMedia().Playback.GetPaused() != nil {
			clock = &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{PositionMs: position}}}
		} else {
			clock = &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{PositionAtReferenceMs: position, ReferenceRuntimeTimeMs: now}}}
		}
		setClock(clock)
		return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaSeeked{MediaSeeked: &realtimev2.MediaSeeked{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), SurfaceId: spec.SurfaceID, Playback: proto.Clone(clock).(*realtimev2.PlaybackClock), Run: proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)}}}}, false, nil
	case "media.stop":
		if run == nil {
			return nil, false, nil
		}
		id := proto.Clone(run.RunId).(*presentationv2.RuntimeRunId)
		removeMediaRun(snapshot, run)
		state.State = &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{HeldPositionMs: position}}
		return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaStopped{MediaStopped: &realtimev2.MediaStopped{RunId: id, SurfaceId: spec.SurfaceID, HeldPositionMs: position}}}}, false, nil
	default:
		return nil, false, ErrV2RuntimeUnsupported
	}
}

func removeMediaRun(snapshot *realtimev2.CanonicalRuntimeSnapshot, target *realtimev2.RuntimeRunSnapshot) {
	for i, run := range snapshot.ActiveRuns {
		if run == target {
			snapshot.ActiveRuns = append(snapshot.ActiveRuns[:i], snapshot.ActiveRuns[i+1:]...)
			return
		}
	}
}

func nextV2MediaDue(snapshot *realtimev2.CanonicalRuntimeSnapshot, specs map[string]v2MediaSpec, target uint64) (uint64, *presentationv2.RuntimeRunId, bool, error) {
	if snapshot == nil || snapshot.Clock == nil || target < snapshot.Clock.RuntimeTimeMs {
		return 0, nil, false, errV2MediaInvariant
	}
	var earliest uint64
	var selected *presentationv2.RuntimeRunId
	selectedSurface := ""
	for _, run := range snapshot.ActiveRuns {
		media := run.GetMedia()
		if media == nil {
			continue
		}
		spec, ok := specs[media.SurfaceId]
		if !ok || spec.SurfaceID != media.SurfaceId || spec.DurationMS == 0 || spec.DurationMS > 1<<53-1 || run.RunId == nil || media.Playback == nil {
			return 0, nil, false, errV2MediaInvariant
		}
		state := mediaState(snapshot, media.SurfaceId)
		if state == nil || state.GetActive() == nil || !proto.Equal(state.GetActive().RunId, run.RunId) || !proto.Equal(state.GetActive().Playback, media.Playback) {
			return 0, nil, false, errV2MediaInvariant
		}
		if paused := media.Playback.GetPaused(); paused != nil && (math.IsNaN(paused.PositionMs) || math.IsInf(paused.PositionMs, 0) || paused.PositionMs < 0 || paused.PositionMs > float64(spec.DurationMS)) {
			return 0, nil, false, errV2MediaInvariant
		}
		if playing := media.Playback.GetPlaying(); playing != nil && (math.IsNaN(playing.PositionAtReferenceMs) || math.IsInf(playing.PositionAtReferenceMs, 0) || playing.PositionAtReferenceMs < 0 || playing.PositionAtReferenceMs > float64(spec.DurationMS)) {
			return 0, nil, false, errV2MediaInvariant
		}
		position, err := mediaPlaybackPosition(media.Playback, snapshot.Clock.RuntimeTimeMs, spec.DurationMS, spec.Loop)
		if err != nil || math.IsNaN(position) || math.IsInf(position, 0) {
			return 0, nil, false, errV2MediaInvariant
		}
		if media.Playback.GetPaused() != nil || spec.Loop {
			continue
		}
		playing := media.Playback.GetPlaying()
		if playing == nil || math.IsNaN(playing.PositionAtReferenceMs) || math.IsInf(playing.PositionAtReferenceMs, 0) || playing.PositionAtReferenceMs < 0 || playing.PositionAtReferenceMs > float64(spec.DurationMS) {
			return 0, nil, false, errV2MediaInvariant
		}
		remaining := float64(spec.DurationMS) - playing.PositionAtReferenceMs
		if remaining < 0 || math.IsNaN(remaining) || math.IsInf(remaining, 0) {
			return 0, nil, false, errV2MediaInvariant
		}
		wait := math.Ceil(remaining)
		if wait > float64(1<<53-1) {
			return 0, nil, false, errV2MediaInvariant
		}
		waitMS := uint64(wait)
		if waitMS > ^uint64(0)-playing.ReferenceRuntimeTimeMs {
			return 0, nil, false, errV2MediaInvariant
		}
		deadline := playing.ReferenceRuntimeTimeMs + waitMS
		if deadline < snapshot.Clock.RuntimeTimeMs {
			return 0, nil, false, errV2MediaInvariant
		}
		if deadline > target {
			continue
		}
		if selected == nil || deadline < earliest || deadline == earliest && media.SurfaceId < selectedSurface {
			earliest, selected, selectedSurface = deadline, run.RunId, media.SurfaceId
		}
	}
	return earliest, selected, selected != nil, nil
}

func completeV2MediaRun(snapshot *realtimev2.CanonicalRuntimeSnapshot, spec v2MediaSpec, runID *presentationv2.RuntimeRunId) ([]*realtimev2.ProjectedReliableEvent, error) {
	run := mediaRun(snapshot, spec.SurfaceID)
	if run == nil || !proto.Equal(run.RunId, runID) || spec.Loop {
		return nil, nil
	}
	position, err := mediaPlaybackPosition(run.GetMedia().Playback, snapshot.Clock.RuntimeTimeMs, spec.DurationMS, false)
	if err != nil {
		return nil, err
	}
	if position < float64(spec.DurationMS) {
		return nil, nil
	}
	state := mediaState(snapshot, spec.SurfaceID)
	if state == nil || state.GetActive() == nil {
		return nil, errV2MediaInvariant
	}
	removeMediaRun(snapshot, run)
	state.State = &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{HeldPositionMs: 0}}
	return []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_MediaCompleted{MediaCompleted: &realtimev2.MediaCompleted{RunId: proto.Clone(runID).(*presentationv2.RuntimeRunId), SurfaceId: spec.SurfaceID, HeldPositionMs: float64(spec.DurationMS)}}}}, nil
}

func cancelV2MediaRuns(snapshot *realtimev2.CanonicalRuntimeSnapshot, reason realtimev2.MediaCancelReason, groupID string) []*realtimev2.ProjectedReliableEvent {
	selected := make([]*realtimev2.RuntimeRunSnapshot, 0)
	for _, run := range snapshot.ActiveRuns {
		if run.GetMedia() != nil && (reason == realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_PRESENTATION_ENDED || run.Owner.GetGroup().GetGroupId() == groupID) {
			selected = append(selected, run)
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].RunId.RunSequence < selected[j].RunId.RunSequence })
	events := make([]*realtimev2.ProjectedReliableEvent, 0, len(selected))
	for _, run := range selected {
		id := proto.Clone(run.RunId).(*presentationv2.RuntimeRunId)
		surfaceID := run.GetMedia().SurfaceId
		removeMediaRun(snapshot, run)
		if state := mediaState(snapshot, surfaceID); state != nil {
			if reason == realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_GROUP_EXIT {
				for i, candidate := range snapshot.MediaStates {
					if candidate == state {
						snapshot.MediaStates = append(snapshot.MediaStates[:i], snapshot.MediaStates[i+1:]...)
						break
					}
				}
			} else {
				state.State = &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{HeldPositionMs: 0}}
			}
		}
		events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_MediaCanceled{MediaCanceled: &realtimev2.MediaCanceled{RunId: id, SurfaceId: surfaceID, Reason: reason}}})
	}
	return events
}
