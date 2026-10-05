package runtimecore

import (
	"errors"
	"math"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

var errV2ModelClip = errors.New("invalid model clip transition")

// v2ModelCommand contains the resolved values of one Model clip action.
type v2ModelCommand struct {
	Kind           string
	NodeID         string
	ClipID         string
	Speed          float64
	Loop           bool
	Completion     presentationv2.RunCompletion
	TransitionKind string
	DurationMs     uint64
	Easing         presentationv2.Easing
}

type v2ModelResult struct {
	State        *realtimev2.ModelClipRuntimeState
	Run          *realtimev2.RuntimeRunSnapshot
	RemovedRunID *presentationv2.RuntimeRunId
	Events       []*realtimev2.ProjectedReliableEvent
	Rejection    realtimev2.CueRejectionReason
	NoOp         bool
}

func modelCloneState(state *realtimev2.ModelClipRuntimeState) *realtimev2.ModelClipRuntimeState {
	if state == nil {
		return nil
	}
	return proto.Clone(state).(*realtimev2.ModelClipRuntimeState)
}

func modelCloneRun(run *realtimev2.RuntimeRunSnapshot) *realtimev2.RuntimeRunSnapshot {
	if run == nil {
		return nil
	}
	return proto.Clone(run).(*realtimev2.RuntimeRunSnapshot)
}

func modelPlaying(position float64, now uint64) *realtimev2.PlaybackClock {
	return &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{PositionAtReferenceMs: position, ReferenceRuntimeTimeMs: now}}}
}

func modelPaused(position float64) *realtimev2.PlaybackClock {
	return &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{PositionMs: position}}}
}

func modelClockValid(clock *realtimev2.PlaybackClock) bool {
	if clock == nil {
		return false
	}
	switch value := clock.Clock.(type) {
	case *realtimev2.PlaybackClock_Playing:
		return value != nil && value.Playing != nil
	case *realtimev2.PlaybackClock_Paused:
		return value != nil && value.Paused != nil
	default:
		return false
	}
}

func modelPosition(playback *realtimev2.ClipPlayback, duration uint64, now uint64) (float64, error) {
	if playback == nil || !modelClockValid(playback.Playback) || duration == 0 || math.IsNaN(playback.Speed) || math.IsInf(playback.Speed, 0) || playback.Speed <= 0 {
		return 0, errV2ModelClip
	}
	var raw float64
	if playing := playback.Playback.GetPlaying(); playing != nil {
		if now < playing.ReferenceRuntimeTimeMs {
			return 0, errV2ModelClip
		}
		raw = playing.PositionAtReferenceMs + float64(now-playing.ReferenceRuntimeTimeMs)*playback.Speed
	} else if paused := playback.Playback.GetPaused(); paused != nil {
		raw = paused.PositionMs
	} else {
		return 0, errV2ModelClip
	}
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw < 0 {
		return 0, errV2ModelClip
	}
	if playback.Loop {
		raw = math.Mod(raw, float64(duration))
	} else {
		raw = math.Min(raw, float64(duration))
	}
	if raw == 0 {
		return 0, nil
	}
	return raw, nil
}

func modelTransitionElapsed(clock *realtimev2.PlaybackClock, now uint64) (float64, error) {
	if !modelClockValid(clock) {
		return 0, errV2ModelClip
	}
	if playing := clock.GetPlaying(); playing != nil {
		if now < playing.ReferenceRuntimeTimeMs {
			return 0, errV2ModelClip
		}
		value := playing.PositionAtReferenceMs + float64(now-playing.ReferenceRuntimeTimeMs)
		if !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 {
			return value, nil
		}
	} else if paused := clock.GetPaused(); paused != nil && !math.IsNaN(paused.PositionMs) && !math.IsInf(paused.PositionMs, 0) && paused.PositionMs >= 0 {
		return paused.PositionMs, nil
	}
	return 0, errV2ModelClip
}

func modelDeadline(clock *realtimev2.PlaybackClock, speed float64, duration uint64) (uint64, bool, error) {
	if !modelClockValid(clock) || duration == 0 || math.IsNaN(speed) || math.IsInf(speed, 0) || speed <= 0 {
		return 0, false, errV2ModelClip
	}
	if paused := clock.GetPaused(); paused != nil {
		if math.IsNaN(paused.PositionMs) || math.IsInf(paused.PositionMs, 0) || paused.PositionMs < 0 {
			return 0, false, errV2ModelClip
		}
		return 0, false, nil
	}
	playing := clock.GetPlaying()
	if playing == nil || math.IsNaN(playing.PositionAtReferenceMs) || math.IsInf(playing.PositionAtReferenceMs, 0) || playing.PositionAtReferenceMs < 0 {
		return 0, false, errV2ModelClip
	}
	remaining := math.Max(0, float64(duration)-playing.PositionAtReferenceMs)
	delta := math.Ceil(remaining / speed)
	if delta == 0 {
		return playing.ReferenceRuntimeTimeMs, true, nil
	}
	if math.IsNaN(delta) || math.IsInf(delta, 0) || delta >= math.Exp2(64) || uint64(delta) > ^uint64(0)-playing.ReferenceRuntimeTimeMs {
		return 0, false, errV2ModelClip
	}
	return playing.ReferenceRuntimeTimeMs + uint64(delta), true, nil
}

func nextV2ModelDeadline(run *realtimev2.RuntimeRunSnapshot, durations map[string]uint64, now uint64) (uint64, bool, error) {
	if !modelValidRun(run) {
		return 0, false, errV2ModelClip
	}
	if single := run.GetModelClip().GetSingle(); single != nil {
		if _, err := modelPosition(single, durations[single.ClipId], now); err != nil {
			return 0, false, errV2ModelClip
		}
		if single.Loop {
			return 0, false, nil
		}
		return modelDeadline(single.Playback, single.Speed, durations[single.ClipId])
	}
	if fade := run.GetModelClip().GetCrossfade(); fade != nil {
		if fade.From == nil || fade.To == nil {
			return 0, false, errV2ModelClip
		}
		if _, err := modelPosition(fade.From, durations[fade.From.ClipId], now); err != nil {
			return 0, false, errV2ModelClip
		}
		if _, err := modelPosition(fade.To, durations[fade.To.ClipId], now); err != nil {
			return 0, false, errV2ModelClip
		}
		if _, err := modelTransitionElapsed(fade.TransitionClock, now); err != nil {
			return 0, false, errV2ModelClip
		}
		return modelDeadline(fade.TransitionClock, 1, fade.DurationMs)
	}
	return 0, false, errV2ModelClip
}

func modelEasedWeight(elapsed float64, duration uint64, easing presentationv2.Easing) (float64, error) {
	if duration == 0 {
		return 0, errV2ModelClip
	}
	u := math.Max(0, math.Min(1, elapsed/float64(duration)))
	switch easing {
	case presentationv2.Easing_EASING_LINEAR:
		return u, nil
	case presentationv2.Easing_EASING_CUBIC_IN:
		return u * u * u, nil
	case presentationv2.Easing_EASING_CUBIC_OUT:
		v := 1 - u
		return 1 - v*v*v, nil
	case presentationv2.Easing_EASING_CUBIC_IN_OUT:
		if u < 0.5 {
			return 4 * u * u * u, nil
		}
		v := -2*u + 2
		return 1 - v*v*v/2, nil
	default:
		return 0, errV2ModelClip
	}
}

func modelActiveMatches(state *realtimev2.ModelClipRuntimeState, run *realtimev2.RuntimeRunSnapshot) bool {
	return modelValidState(state) && modelValidRun(run) && state.GetActive() != nil && proto.Equal(state.GetActive().RunId, run.RunId) &&
		run.GetModelClip().ModelNodeId == state.ModelNodeId
}

func modelValidRun(run *realtimev2.RuntimeRunSnapshot) bool {
	if run == nil || run.RunId == nil || run.GetModelClip() == nil || run.GetModelClip().ModelNodeId == "" {
		return false
	}
	switch phase := run.GetModelClip().Phase.(type) {
	case *realtimev2.ModelClipRunSnapshot_Single:
		return phase != nil && phase.Single != nil && phase.Single.Playback != nil
	case *realtimev2.ModelClipRunSnapshot_Crossfade:
		return phase != nil && phase.Crossfade != nil && phase.Crossfade.From != nil && phase.Crossfade.From.Playback != nil && phase.Crossfade.To != nil && phase.Crossfade.To.Playback != nil && phase.Crossfade.TransitionClock != nil
	default:
		return false
	}
}

func modelValidState(state *realtimev2.ModelClipRuntimeState) bool {
	if state == nil || state.ModelNodeId == "" {
		return false
	}
	switch value := state.State.(type) {
	case *realtimev2.ModelClipRuntimeState_DefaultPose:
		return value != nil && value.DefaultPose != nil
	case *realtimev2.ModelClipRuntimeState_HeldClip:
		return value != nil && value.HeldClip != nil
	case *realtimev2.ModelClipRuntimeState_HeldBlend:
		return value != nil && value.HeldBlend != nil
	case *realtimev2.ModelClipRuntimeState_Active:
		return value != nil && value.Active != nil && value.Active.RunId != nil
	default:
		return false
	}
}

func evaluateV2ModelAction(state *realtimev2.ModelClipRuntimeState, active *realtimev2.RuntimeRunSnapshot, command v2ModelCommand, durations map[string]uint64, now uint64, newID *presentationv2.RuntimeRunId, owner *presentationv2.RuntimeRunOwner, cause *presentationv2.RuntimeRunCause) (v2ModelResult, error) {
	result := v2ModelResult{State: modelCloneState(state), Run: modelCloneRun(active)}
	if !modelValidState(state) || state.ModelNodeId != command.NodeID || active != nil && !modelActiveMatches(state, active) || active == nil && state.GetActive() != nil {
		return v2ModelResult{}, errV2ModelClip
	}
	switch command.Kind {
	case "modelClip.play":
		if command.ClipID == "" || durations[command.ClipID] == 0 || math.IsNaN(command.Speed) || math.IsInf(command.Speed, 0) || command.Speed <= 0 ||
			command.Completion != presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING && command.Completion != presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING ||
			command.Loop && command.Completion == presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING ||
			newID == nil || newID.AssignmentEpoch == 0 || newID.RunSequence == 0 || owner == nil || cause == nil {
			return v2ModelResult{}, errV2ModelClip
		}
		if active != nil && active.GetModelClip().GetCrossfade() != nil {
			result.Rejection = realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT
			return result, nil
		}
		to := &realtimev2.ClipPlayback{ClipId: command.ClipID, Playback: modelPlaying(0, now), Speed: command.Speed, Loop: command.Loop}
		modelRun := &realtimev2.ModelClipRunSnapshot{ModelNodeId: command.NodeID}
		switch command.TransitionKind {
		case "immediate":
			modelRun.Phase = &realtimev2.ModelClipRunSnapshot_Single{Single: to}
		case "crossfade":
			if command.DurationMs == 0 || state.GetHeldBlend() != nil || state.GetDefaultPose() != nil {
				result.Rejection = realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT
				return result, nil
			}
			var from *realtimev2.ClipPlayback
			fromHeld := false
			if held := state.GetHeldClip(); held != nil {
				if durations[held.ClipId] == 0 || held.PositionMs < 0 || held.PositionMs > float64(durations[held.ClipId]) {
					return v2ModelResult{}, errV2ModelClip
				}
				from = &realtimev2.ClipPlayback{ClipId: held.ClipId, Playback: modelPaused(held.PositionMs), Speed: 1}
				fromHeld = true
			} else if active != nil {
				from = proto.Clone(active.GetModelClip().GetSingle()).(*realtimev2.ClipPlayback)
			} else {
				return v2ModelResult{}, errV2ModelClip
			}
			if _, err := modelPosition(from, durations[from.ClipId], now); err != nil {
				return v2ModelResult{}, err
			}
			if _, err := modelEasedWeight(0, command.DurationMs, command.Easing); err != nil {
				return v2ModelResult{}, err
			}
			modelRun.Phase = &realtimev2.ModelClipRunSnapshot_Crossfade{Crossfade: &realtimev2.ModelClipCrossfade{From: from, To: to, TransitionClock: modelPlaying(0, now), DurationMs: command.DurationMs, Easing: command.Easing, FromIsHeld: fromHeld}}
		default:
			return v2ModelResult{}, errV2ModelClip
		}
		result.RemovedRunID = nil
		if active != nil {
			result.RemovedRunID = proto.Clone(active.RunId).(*presentationv2.RuntimeRunId)
		}
		result.Run = &realtimev2.RuntimeRunSnapshot{RunId: proto.Clone(newID).(*presentationv2.RuntimeRunId), Owner: proto.Clone(owner).(*presentationv2.RuntimeRunOwner), Cause: proto.Clone(cause).(*presentationv2.RuntimeRunCause), Completion: command.Completion, StartedAtRuntimeTimeMs: now, Run: &realtimev2.RuntimeRunSnapshot_ModelClip{ModelClip: modelRun}}
		result.State.State = &realtimev2.ModelClipRuntimeState_Active{Active: &realtimev2.ModelClipActive{RunId: proto.Clone(newID).(*presentationv2.RuntimeRunId)}}
		if single := modelRun.GetSingle(); single != nil {
			result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipStarted{ModelClipStarted: &realtimev2.ModelClipStarted{RunId: proto.Clone(newID).(*presentationv2.RuntimeRunId), ModelNodeId: command.NodeID, Playback: proto.Clone(single).(*realtimev2.ClipPlayback), Run: modelCloneRun(result.Run)}}}}
		} else {
			result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipCrossfadeStarted{ModelClipCrossfadeStarted: &realtimev2.ModelClipCrossfadeStarted{RunId: proto.Clone(newID).(*presentationv2.RuntimeRunId), ModelNodeId: command.NodeID, Crossfade: proto.Clone(modelRun.GetCrossfade()).(*realtimev2.ModelClipCrossfade), Run: modelCloneRun(result.Run)}}}}
		}
	case "modelClip.pause", "modelClip.resume":
		if active == nil {
			result.Rejection = realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID
			return result, nil
		}
		if err := modelRebaseRun(result.Run, durations, now, command.Kind == "modelClip.pause"); err != nil {
			return v2ModelResult{}, err
		}
		if proto.Equal(result.Run, active) {
			result.NoOp = true
			return result, nil
		}
		if command.Kind == "modelClip.pause" {
			result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipPaused{ModelClipPaused: &realtimev2.ModelClipPaused{RunId: proto.Clone(active.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: command.NodeID, Run: modelCloneRun(result.Run)}}}}
		} else {
			result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipResumed{ModelClipResumed: &realtimev2.ModelClipResumed{RunId: proto.Clone(active.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: command.NodeID, Run: modelCloneRun(result.Run)}}}}
		}
	case "modelClip.stop":
		if active == nil {
			result.NoOp = true
			return result, nil
		}
		result.RemovedRunID = proto.Clone(active.RunId).(*presentationv2.RuntimeRunId)
		result.Run = nil
		stopped := &realtimev2.ModelClipStopped{RunId: proto.Clone(active.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: command.NodeID}
		if single := active.GetModelClip().GetSingle(); single != nil {
			position, err := modelPosition(single, durations[single.ClipId], now)
			if err != nil {
				return v2ModelResult{}, err
			}
			held := &realtimev2.ClipHeldPose{ClipId: single.ClipId, PositionMs: position}
			result.State.State = &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: proto.Clone(held).(*realtimev2.ClipHeldPose)}
			stopped.HeldPose = &realtimev2.ModelClipStopped_Clip{Clip: held}
		} else if fade := active.GetModelClip().GetCrossfade(); fade != nil {
			blend, err := modelHeldBlend(fade, durations, now)
			if err != nil {
				return v2ModelResult{}, err
			}
			result.State.State = &realtimev2.ModelClipRuntimeState_HeldBlend{HeldBlend: proto.Clone(blend).(*realtimev2.BlendHeldPose)}
			stopped.HeldPose = &realtimev2.ModelClipStopped_Blend{Blend: blend}
		} else {
			return v2ModelResult{}, errV2ModelClip
		}
		result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipStopped{ModelClipStopped: stopped}}}
	default:
		return v2ModelResult{}, errV2ModelClip
	}
	return result, nil
}

func modelRebaseRun(run *realtimev2.RuntimeRunSnapshot, durations map[string]uint64, now uint64, pause bool) error {
	model := run.GetModelClip()
	if model == nil {
		return errV2ModelClip
	}
	var clips []*realtimev2.ClipPlayback
	if single := model.GetSingle(); single != nil {
		clips = append(clips, single)
	} else if fade := model.GetCrossfade(); fade != nil {
		if !fade.FromIsHeld {
			clips = append(clips, fade.From)
		}
		clips = append(clips, fade.To)
	} else {
		return errV2ModelClip
	}
	for _, clip := range clips {
		if pause && clip.Playback.GetPaused() != nil || !pause && clip.Playback.GetPlaying() != nil {
			continue
		}
		position, err := modelPosition(clip, durations[clip.ClipId], now)
		if err != nil {
			return err
		}
		if pause {
			clip.Playback = modelPaused(position)
		} else {
			clip.Playback = modelPlaying(position, now)
		}
	}
	if fade := model.GetCrossfade(); fade != nil {
		if pause && fade.TransitionClock.GetPlaying() != nil || !pause && fade.TransitionClock.GetPaused() != nil {
			elapsed, err := modelTransitionElapsed(fade.TransitionClock, now)
			if err != nil {
				return err
			}
			if pause {
				fade.TransitionClock = modelPaused(elapsed)
			} else {
				fade.TransitionClock = modelPlaying(elapsed, now)
			}
		}
	}
	return nil
}

func modelHeldBlend(fade *realtimev2.ModelClipCrossfade, durations map[string]uint64, now uint64) (*realtimev2.BlendHeldPose, error) {
	from, err := modelPosition(fade.From, durations[fade.From.ClipId], now)
	if err != nil {
		return nil, err
	}
	to, err := modelPosition(fade.To, durations[fade.To.ClipId], now)
	if err != nil {
		return nil, err
	}
	elapsed, err := modelTransitionElapsed(fade.TransitionClock, now)
	if err != nil {
		return nil, err
	}
	weight, err := modelEasedWeight(elapsed, fade.DurationMs, fade.Easing)
	if err != nil {
		return nil, err
	}
	return &realtimev2.BlendHeldPose{From: &realtimev2.ClipHeldPose{ClipId: fade.From.ClipId, PositionMs: from}, To: &realtimev2.ClipHeldPose{ClipId: fade.To.ClipId, PositionMs: to}, ToWeight: weight}, nil
}

func advanceV2ModelRun(state *realtimev2.ModelClipRuntimeState, run *realtimev2.RuntimeRunSnapshot, durations map[string]uint64, now uint64) (v2ModelResult, error) {
	if !modelActiveMatches(state, run) {
		return v2ModelResult{}, errV2ModelClip
	}
	result := v2ModelResult{State: modelCloneState(state), Run: modelCloneRun(run)}
	model := run.GetModelClip()
	if single := model.GetSingle(); single != nil {
		position, err := modelPosition(single, durations[single.ClipId], now)
		if err != nil {
			return v2ModelResult{}, err
		}
		if single.Loop || single.Playback.GetPaused() != nil || position < float64(durations[single.ClipId]) {
			return result, nil
		}
		result.State.State = &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: single.ClipId, PositionMs: position}}
		result.Run = nil
		result.RemovedRunID = proto.Clone(run.RunId).(*presentationv2.RuntimeRunId)
		result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipCompleted{ModelClipCompleted: &realtimev2.ModelClipCompleted{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: state.ModelNodeId, HeldPose: proto.Clone(result.State.GetHeldClip()).(*realtimev2.ClipHeldPose)}}}}
		return result, nil
	}
	fade := model.GetCrossfade()
	if fade == nil {
		return v2ModelResult{}, errV2ModelClip
	}
	elapsed, err := modelTransitionElapsed(fade.TransitionClock, now)
	if err != nil {
		return v2ModelResult{}, err
	}
	if fade.TransitionClock.GetPaused() != nil || elapsed < float64(fade.DurationMs) {
		return result, nil
	}
	to := proto.Clone(fade.To).(*realtimev2.ClipPlayback)
	result.Run.GetModelClip().Phase = &realtimev2.ModelClipRunSnapshot_Single{Single: to}
	result.Events = []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipCrossfadeCompleted{ModelClipCrossfadeCompleted: &realtimev2.ModelClipCrossfadeCompleted{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: state.ModelNodeId, Playback: proto.Clone(to).(*realtimev2.ClipPlayback), Run: modelCloneRun(result.Run)}}}}
	if !to.Loop {
		position, err := modelPosition(to, durations[to.ClipId], now)
		if err != nil {
			return v2ModelResult{}, err
		}
		if position >= float64(durations[to.ClipId]) {
			result.State.State = &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: to.ClipId, PositionMs: position}}
			result.Run = nil
			result.RemovedRunID = proto.Clone(run.RunId).(*presentationv2.RuntimeRunId)
			result.Events = append(result.Events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_ModelClipCompleted{ModelClipCompleted: &realtimev2.ModelClipCompleted{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: state.ModelNodeId, HeldPose: proto.Clone(result.State.GetHeldClip()).(*realtimev2.ClipHeldPose)}}})
		}
	}
	return result, nil
}

func cancelV2ModelRun(state *realtimev2.ModelClipRuntimeState, run *realtimev2.RuntimeRunSnapshot, reason realtimev2.ModelClipCancelReason) (v2ModelResult, error) {
	if !modelActiveMatches(state, run) || reason != realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_GROUP_EXIT && reason != realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_PRESENTATION_ENDED {
		return v2ModelResult{}, errV2ModelClip
	}
	result := v2ModelResult{RemovedRunID: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), Events: []*realtimev2.ProjectedReliableEvent{{Payload: &realtimev2.ProjectedReliableEvent_ModelClipCanceled{ModelClipCanceled: &realtimev2.ModelClipCanceled{RunId: proto.Clone(run.RunId).(*presentationv2.RuntimeRunId), ModelNodeId: state.ModelNodeId, Reason: reason}}}}}
	if reason == realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_PRESENTATION_ENDED {
		result.State = &realtimev2.ModelClipRuntimeState{ModelNodeId: state.ModelNodeId, State: &realtimev2.ModelClipRuntimeState_DefaultPose{DefaultPose: &realtimev2.DefaultModelPose{}}}
	}
	return result, nil
}
