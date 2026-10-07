package runtimecore

import (
	"math"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

func modelTestState() *realtimev2.ModelClipRuntimeState {
	return &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_DefaultPose{DefaultPose: &realtimev2.DefaultModelPose{}}}
}

func modelTestRunID(sequence uint64) *presentationv2.RuntimeRunId {
	return &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: sequence}
}

func modelTestOwner() *presentationv2.RuntimeRunOwner {
	return &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}
}

func modelTestCause() *presentationv2.RuntimeRunCause {
	return &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "event-1", GroupId: "group", GroupEntryEpoch: 1, StepId: "step", StepEntryEpoch: 1}
}

func TestV2ModelCutPlayCompletesAtSpeedAdjustedDeadline(t *testing.T) {
	initial := modelTestState()
	command := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 2, Completion: presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING, TransitionKind: "immediate"}
	started, err := evaluateV2ModelAction(initial, nil, command, map[string]uint64{"walk": 100}, 5, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil || started.Rejection != realtimev2.CueRejectionReason_CUE_REJECTION_REASON_UNSPECIFIED || started.Run == nil || started.State.GetActive() == nil || started.Events[0].GetModelClipStarted() == nil {
		t.Fatalf("start=%#v error=%v", started, err)
	}
	if !proto.Equal(initial, modelTestState()) {
		t.Fatal("play changed its input")
	}
	before, err := advanceV2ModelRun(started.State, started.Run, map[string]uint64{"walk": 100}, 54)
	if err != nil || before.Run == nil || len(before.Events) != 0 {
		t.Fatalf("early completion=%#v error=%v", before, err)
	}
	completed, err := advanceV2ModelRun(started.State, started.Run, map[string]uint64{"walk": 100}, 55)
	if err != nil || completed.Run != nil || completed.State.GetHeldClip().PositionMs != 100 || len(completed.Events) != 1 || completed.Events[0].GetModelClipCompleted() == nil {
		t.Fatalf("completion=%#v error=%v", completed, err)
	}
}

func TestV2ModelPlayRejectsInvalidSpeedAndLoopBlocking(t *testing.T) {
	for _, command := range []v2ModelCommand{
		{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: math.NaN(), Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"},
		{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 0, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"},
		{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Loop: true, Completion: presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING, TransitionKind: "immediate"},
	} {
		if _, err := evaluateV2ModelAction(modelTestState(), nil, command, map[string]uint64{"walk": 100}, 0, modelTestRunID(1), modelTestOwner(), modelTestCause()); err == nil {
			t.Fatalf("accepted invalid command %#v", command)
		}
	}
}

func TestV2ModelHeldSourceCrossfadePauseResumeAndStop(t *testing.T) {
	state := &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: "idle", PositionMs: 25}}}
	durations := map[string]uint64{"idle": 100, "walk": 100}
	command := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "crossfade", DurationMs: 20, Easing: presentationv2.Easing_EASING_LINEAR}
	started, err := evaluateV2ModelAction(state, nil, command, durations, 0, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil || started.Run.GetModelClip().GetCrossfade() == nil || !started.Run.GetModelClip().GetCrossfade().FromIsHeld || started.Events[0].GetModelClipCrossfadeStarted() == nil {
		t.Fatalf("crossfade=%#v error=%v", started, err)
	}
	paused, err := evaluateV2ModelAction(started.State, started.Run, v2ModelCommand{Kind: "modelClip.pause", NodeID: "model"}, durations, 5, nil, nil, nil)
	if err != nil || paused.Run.GetModelClip().GetCrossfade().From.Playback.GetPaused().PositionMs != 25 || paused.Run.GetModelClip().GetCrossfade().To.Playback.GetPaused().PositionMs != 5 || paused.Run.GetModelClip().GetCrossfade().TransitionClock.GetPaused().PositionMs != 5 || paused.Events[0].GetModelClipPaused() == nil {
		t.Fatalf("pause=%#v error=%v", paused, err)
	}
	resumed, err := evaluateV2ModelAction(paused.State, paused.Run, v2ModelCommand{Kind: "modelClip.resume", NodeID: "model"}, durations, 10, nil, nil, nil)
	if err != nil || resumed.Run.GetModelClip().GetCrossfade().From.Playback.GetPaused() == nil || resumed.Run.GetModelClip().GetCrossfade().To.Playback.GetPlaying().ReferenceRuntimeTimeMs != 10 || resumed.Events[0].GetModelClipResumed() == nil {
		t.Fatalf("resume=%#v error=%v", resumed, err)
	}
	before, err := advanceV2ModelRun(resumed.State, resumed.Run, durations, 24)
	if err != nil || len(before.Events) != 0 {
		t.Fatalf("early crossfade=%#v error=%v", before, err)
	}
	completed, err := advanceV2ModelRun(resumed.State, resumed.Run, durations, 25)
	if err != nil || completed.Run.GetModelClip().GetSingle() == nil || len(completed.Events) != 1 || completed.Events[0].GetModelClipCrossfadeCompleted() == nil {
		t.Fatalf("crossfade completion=%#v error=%v", completed, err)
	}
	stopped, err := evaluateV2ModelAction(completed.State, completed.Run, v2ModelCommand{Kind: "modelClip.stop", NodeID: "model"}, durations, 25, nil, nil, nil)
	if err != nil || stopped.Run != nil || stopped.State.GetHeldClip().ClipId != "walk" || stopped.State.GetHeldClip().PositionMs != 20 || stopped.Events[0].GetModelClipStopped() == nil {
		t.Fatalf("stop=%#v error=%v", stopped, err)
	}
}

func TestV2ModelCrossfadeStopsAtEasedHeldBlendAndCompletesEndedTarget(t *testing.T) {
	state := &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: "idle", PositionMs: 25}}}
	durations := map[string]uint64{"idle": 100, "walk": 10}
	command := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 2, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "crossfade", DurationMs: 20, Easing: presentationv2.Easing_EASING_CUBIC_IN}
	started, err := evaluateV2ModelAction(state, nil, command, durations, 0, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	stopped, err := evaluateV2ModelAction(started.State, started.Run, v2ModelCommand{Kind: "modelClip.stop", NodeID: "model"}, durations, 10, nil, nil, nil)
	if err != nil || stopped.State.GetHeldBlend() == nil || stopped.State.GetHeldBlend().From.PositionMs != 25 || stopped.State.GetHeldBlend().To.PositionMs != 10 || stopped.State.GetHeldBlend().ToWeight != 0.125 {
		t.Fatalf("held blend=%#v error=%v", stopped, err)
	}
	rejected, err := evaluateV2ModelAction(stopped.State, nil, command, durations, 10, modelTestRunID(2), modelTestOwner(), modelTestCause())
	if err != nil || rejected.Rejection == realtimev2.CueRejectionReason_CUE_REJECTION_REASON_UNSPECIFIED {
		t.Fatalf("held blend crossfade=%#v error=%v", rejected, err)
	}
	completed, err := advanceV2ModelRun(started.State, started.Run, durations, 20)
	if err != nil || completed.Run != nil || completed.State.GetHeldClip().PositionMs != 10 || len(completed.Events) != 2 || completed.Events[0].GetModelClipCrossfadeCompleted() == nil || completed.Events[1].GetModelClipCompleted() == nil {
		t.Fatalf("ended target=%#v error=%v", completed, err)
	}
}

func TestV2ModelReplacementNoOpAndCancellation(t *testing.T) {
	durations := map[string]uint64{"walk": 100, "idle": 100}
	play := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"}
	first, err := evaluateV2ModelAction(modelTestState(), nil, play, durations, 0, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	repeatResume, err := evaluateV2ModelAction(first.State, first.Run, v2ModelCommand{Kind: "modelClip.resume", NodeID: "model"}, durations, 2, nil, nil, nil)
	if err != nil || !repeatResume.NoOp || len(repeatResume.Events) != 0 {
		t.Fatalf("resume noop=%#v error=%v", repeatResume, err)
	}
	play.ClipID = "idle"
	replacement, err := evaluateV2ModelAction(first.State, first.Run, play, durations, 10, modelTestRunID(2), modelTestOwner(), modelTestCause())
	if err != nil || replacement.RemovedRunID.RunSequence != 1 || replacement.Run.RunId.RunSequence != 2 || len(replacement.Events) != 1 || replacement.Events[0].GetModelClipStarted() == nil {
		t.Fatalf("replacement=%#v error=%v", replacement, err)
	}
	for _, reason := range []realtimev2.ModelClipCancelReason{realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_GROUP_EXIT, realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_PRESENTATION_ENDED} {
		canceled, err := cancelV2ModelRun(replacement.State, replacement.Run, reason)
		if err != nil || canceled.Run != nil || canceled.RemovedRunID.RunSequence != 2 || canceled.Events[0].GetModelClipCanceled().Reason != reason || reason == realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_GROUP_EXIT && canceled.State != nil || reason == realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_PRESENTATION_ENDED && canceled.State.GetDefaultPose() == nil {
			t.Fatalf("cancel %s=%#v error=%v", reason, canceled, err)
		}
	}
}

func TestV2ModelDeadlineUsesSpeedAndTransitionClock(t *testing.T) {
	durations := map[string]uint64{"walk": 100, "idle": 100}
	play := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 2, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"}
	started, err := evaluateV2ModelAction(modelTestState(), nil, play, durations, 5, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	deadline, due, err := nextV2ModelDeadline(started.Run, durations, 5)
	if err != nil || !due || deadline != 55 {
		t.Fatalf("single deadline=%d due=%t error=%v", deadline, due, err)
	}
	paused, err := evaluateV2ModelAction(started.State, started.Run, v2ModelCommand{Kind: "modelClip.pause", NodeID: "model"}, durations, 20, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, due, err = nextV2ModelDeadline(paused.Run, durations, 20); err != nil || due {
		t.Fatalf("paused due=%t error=%v", due, err)
	}
	play.Loop = true
	looped, err := evaluateV2ModelAction(modelTestState(), nil, play, durations, 5, modelTestRunID(2), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	if _, due, err = nextV2ModelDeadline(looped.Run, durations, 5); err != nil || due {
		t.Fatalf("loop due=%t error=%v", due, err)
	}
	held := &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: "idle", PositionMs: 10}}}
	play.Loop = false
	play.TransitionKind = "crossfade"
	play.DurationMs = 20
	play.Easing = presentationv2.Easing_EASING_LINEAR
	faded, err := evaluateV2ModelAction(held, nil, play, durations, 5, modelTestRunID(3), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	deadline, due, err = nextV2ModelDeadline(faded.Run, durations, 5)
	if err != nil || !due || deadline != 25 {
		t.Fatalf("fade deadline=%d due=%t error=%v", deadline, due, err)
	}
	endedAtLastTick := &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{PositionAtReferenceMs: 100, ReferenceRuntimeTimeMs: math.MaxUint64}}}
	deadline, due, err = modelDeadline(endedAtLastTick, 1, 100)
	if err != nil || !due || deadline != math.MaxUint64 {
		t.Fatalf("last-tick deadline=%d due=%t error=%v", deadline, due, err)
	}
}

func TestV2ModelDeadlineRejectsMalformedLoopAndCrossfadeClocks(t *testing.T) {
	durations := map[string]uint64{"walk": 100, "idle": 100}
	looped, err := evaluateV2ModelAction(modelTestState(), nil, v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Loop: true, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"}, durations, 5, modelTestRunID(1), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	for _, clock := range []*realtimev2.PlaybackClock{{}, {Clock: (*realtimev2.PlaybackClock_Playing)(nil)}, {Clock: (*realtimev2.PlaybackClock_Paused)(nil)}, {Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{PositionMs: math.NaN()}}}, {Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{PositionAtReferenceMs: -1, ReferenceRuntimeTimeMs: 5}}}, {Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{ReferenceRuntimeTimeMs: 6}}}} {
		invalid := proto.Clone(looped.Run).(*realtimev2.RuntimeRunSnapshot)
		invalid.GetModelClip().GetSingle().Playback = clock
		if _, _, err := nextV2ModelDeadline(invalid, durations, 5); err == nil {
			t.Fatalf("malformed loop clock admitted: %#v", clock)
		}
	}
	held := &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldClip{HeldClip: &realtimev2.ClipHeldPose{ClipId: "idle", PositionMs: 10}}}
	faded, err := evaluateV2ModelAction(held, nil, v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "crossfade", DurationMs: 20, Easing: presentationv2.Easing_EASING_LINEAR}, durations, 5, modelTestRunID(2), modelTestOwner(), modelTestCause())
	if err != nil {
		t.Fatal(err)
	}
	invalid := proto.Clone(faded.Run).(*realtimev2.RuntimeRunSnapshot)
	invalid.GetModelClip().GetCrossfade().From.Playback = &realtimev2.PlaybackClock{}
	if _, _, err := nextV2ModelDeadline(invalid, durations, 5); err == nil {
		t.Fatal("malformed crossfade source clock admitted")
	}
	invalid.GetModelClip().GetCrossfade().From.Playback = &realtimev2.PlaybackClock{Clock: (*realtimev2.PlaybackClock_Playing)(nil)}
	if _, _, err := nextV2ModelDeadline(invalid, durations, 5); err == nil {
		t.Fatal("typed nil crossfade source clock admitted")
	}
}

func TestV2ModelRejectsAbsentAndTypedNilState(t *testing.T) {
	play := v2ModelCommand{Kind: "modelClip.play", NodeID: "model", ClipID: "walk", Speed: 1, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, TransitionKind: "immediate"}
	for _, invalid := range []*realtimev2.ModelClipRuntimeState{
		{ModelNodeId: "model"},
		{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_DefaultPose{}},
		{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldClip{}},
		{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_HeldBlend{}},
		{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_Active{}},
	} {
		if _, err := evaluateV2ModelAction(invalid, nil, play, map[string]uint64{"walk": 100}, 0, modelTestRunID(1), modelTestOwner(), modelTestCause()); err == nil {
			t.Fatalf("accepted invalid state %#v", invalid)
		}
	}
}

func TestV2ModelRejectsMalformedActiveRunWithoutPanic(t *testing.T) {
	state := &realtimev2.ModelClipRuntimeState{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_Active{Active: &realtimev2.ModelClipActive{RunId: modelTestRunID(1)}}}
	for _, run := range []*realtimev2.RuntimeRunSnapshot{
		{RunId: modelTestRunID(1), Run: &realtimev2.RuntimeRunSnapshot_ModelClip{ModelClip: &realtimev2.ModelClipRunSnapshot{ModelNodeId: "model"}}},
		{RunId: modelTestRunID(1), Run: &realtimev2.RuntimeRunSnapshot_ModelClip{ModelClip: &realtimev2.ModelClipRunSnapshot{ModelNodeId: "model", Phase: &realtimev2.ModelClipRunSnapshot_Single{}}}},
		{RunId: modelTestRunID(1), Run: &realtimev2.RuntimeRunSnapshot_ModelClip{ModelClip: &realtimev2.ModelClipRunSnapshot{ModelNodeId: "model", Phase: &realtimev2.ModelClipRunSnapshot_Crossfade{}}}},
	} {
		if _, err := evaluateV2ModelAction(state, run, v2ModelCommand{Kind: "modelClip.pause", NodeID: "model"}, map[string]uint64{"walk": 100}, 0, nil, nil, nil); err == nil {
			t.Fatalf("accepted malformed run %#v", run)
		}
		if _, err := advanceV2ModelRun(state, run, map[string]uint64{"walk": 100}, 0); err == nil {
			t.Fatalf("advanced malformed run %#v", run)
		}
	}
}
