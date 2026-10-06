package runtimecore

import (
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func TestV2MediaPlayPauseResumeSeekStop(t *testing.T) {
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "presentation"}}
	snapshot := mediaTestSnapshot()
	cause := &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "input", GroupId: "intro", GroupEntryEpoch: 1, StepId: "start", StepEntryEpoch: 1}
	apply := func(command v2MediaCommand) []*realtimev2.ProjectedReliableEvent {
		t.Helper()
		events, rejected, err := applyV2MediaCommand(snapshot, spec, command, cause, 3)
		if err != nil || rejected {
			t.Fatalf("command %s: rejected=%v err=%v", command.Kind, rejected, err)
		}
		return events
	}
	if events := apply(v2MediaCommand{Kind: "media.play"}); len(events) != 1 || events[0].GetMediaStarted() == nil || snapshot.LastAllocatedRunSequence != 1 || snapshot.MediaStates[0].GetActive() == nil {
		t.Fatalf("play: %#v %#v", events, snapshot)
	}
	snapshot.Clock.RuntimeTimeMs = 250
	if events := apply(v2MediaCommand{Kind: "media.pause"}); len(events) != 1 || events[0].GetMediaPaused().PositionMs != 250 || snapshot.MediaStates[0].GetActive().Playback.GetPaused().PositionMs != 250 {
		t.Fatalf("pause: %#v", events)
	}
	if events := apply(v2MediaCommand{Kind: "media.pause"}); len(events) != 0 {
		t.Fatalf("duplicate pause emitted: %#v", events)
	}
	if events := apply(v2MediaCommand{Kind: "media.seek", SeekMS: 400}); len(events) != 1 || snapshot.MediaStates[0].GetActive().Playback.GetPaused().PositionMs != 400 {
		t.Fatalf("seek: %#v", events)
	}
	if events := apply(v2MediaCommand{Kind: "media.play"}); len(events) != 1 || events[0].GetMediaResumed() == nil || snapshot.MediaStates[0].GetActive().Playback.GetPlaying().PositionAtReferenceMs != 400 {
		t.Fatalf("resume: %#v", events)
	}
	snapshot.Clock.RuntimeTimeMs = 350
	if events := apply(v2MediaCommand{Kind: "media.stop"}); len(events) != 1 || events[0].GetMediaStopped().HeldPositionMs != 500 || snapshot.MediaStates[0].GetStopped().HeldPositionMs != 500 || len(snapshot.ActiveRuns) != 0 {
		t.Fatalf("stop: %#v %#v", events, snapshot)
	}
}

func mediaTestSnapshot() *realtimev2.CanonicalRuntimeSnapshot {
	return &realtimev2.CanonicalRuntimeSnapshot{Clock: &realtimev2.RuntimeClockSnapshot{RuntimeTimeMs: 0}, Progression: &realtimev2.ProgressionRuntimeState{CurrentGroupId: "intro", GroupEntryEpoch: 1, CurrentStepId: "start", StepEntryEpoch: 1}, MediaStates: []*realtimev2.MediaRuntimeState{{SurfaceId: "video", State: &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{}}}}}
}

func TestV2MediaNaturalCompletionAndLoop(t *testing.T) {
	cause := &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "input"}
	for _, loop := range []bool{false, true} {
		snapshot := mediaTestSnapshot()
		spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Loop: loop, Owner: v2Owner{Kind: "presentation"}}
		if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, cause, 3); err != nil || rejected {
			t.Fatalf("play loop=%v: %v %v", loop, rejected, err)
		}
		specs := map[string]v2MediaSpec{"video": spec}
		deadline, runID, due, err := nextV2MediaDue(snapshot, specs, 1000)
		if err != nil {
			t.Fatal(err)
		}
		if loop {
			if due {
				t.Fatal("loop Media must not naturally complete")
			}
			continue
		}
		if !due || deadline != 1000 || runID.RunSequence != 1 {
			t.Fatalf("due: %d %#v %v", deadline, runID, due)
		}
		snapshot.Clock.RuntimeTimeMs = deadline
		events, err := completeV2MediaRun(snapshot, spec, runID)
		if err != nil || len(events) != 1 || events[0].GetMediaCompleted().HeldPositionMs != 1000 || snapshot.MediaStates[0].GetStopped().HeldPositionMs != 0 || len(snapshot.ActiveRuns) != 0 {
			t.Fatalf("complete: %#v %#v %v", events, snapshot, err)
		}
		again, err := completeV2MediaRun(snapshot, spec, runID)
		if err != nil || len(again) != 0 {
			t.Fatalf("duplicate completion: %#v %v", again, err)
		}
	}
}

func TestV2MediaStoppedSeekEmitsReliableHeldPosition(t *testing.T) {
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "presentation"}}
	events, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.seek", SeekMS: 500}, nil, 3)
	if err != nil || rejected || len(events) != 1 || events[0].GetMediaStoppedSeeked().HeldPositionMs != 500 || snapshot.MediaStates[0].GetStopped().HeldPositionMs != 500 {
		t.Fatalf("stopped seek must be reliable: %#v %v %v", events, rejected, err)
	}
}

func TestV2MediaCancelGroupAndEnd(t *testing.T) {
	cause := &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "input"}
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "group", GroupID: "intro"}}
	if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, cause, 3); err != nil || rejected {
		t.Fatalf("play: %v %v", rejected, err)
	}
	events := cancelV2MediaRuns(snapshot, realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_GROUP_EXIT, "intro")
	if len(events) != 1 || events[0].GetMediaCanceled().Reason != realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_GROUP_EXIT || len(snapshot.MediaStates) != 0 || len(snapshot.ActiveRuns) != 0 {
		t.Fatalf("group exit: %#v %#v", events, snapshot)
	}
	snapshot = mediaTestSnapshot()
	if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, cause, 3); err != nil || rejected {
		t.Fatalf("play: %v %v", rejected, err)
	}
	events = cancelV2MediaRuns(snapshot, realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_PRESENTATION_ENDED, "")
	if len(events) != 1 || events[0].GetMediaCanceled().Reason != realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_PRESENTATION_ENDED || len(snapshot.ActiveRuns) != 0 || snapshot.MediaStates[0].GetStopped() == nil {
		t.Fatalf("end: %#v %#v", events, snapshot)
	}
}

func TestV2MediaLoopStopUsesWrappedPositionAndInvalidSeekDoesNotMutate(t *testing.T) {
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Loop: true, Owner: v2Owner{Kind: "presentation"}}
	cause := &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "input"}
	if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, cause, 3); err != nil || rejected {
		t.Fatalf("play: %v %v", rejected, err)
	}
	snapshot.Clock.RuntimeTimeMs = 2250
	if events, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.seek", SeekMS: 1001}, cause, 3); err != nil || !rejected || len(events) != 0 || snapshot.MediaStates[0].GetActive().Playback.GetPlaying().PositionAtReferenceMs != 0 {
		t.Fatalf("invalid seek mutated: %#v %v %v", events, rejected, err)
	}
	events, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.stop"}, cause, 3)
	if err != nil || rejected || len(events) != 1 || events[0].GetMediaStopped().HeldPositionMs != 250 {
		t.Fatalf("loop stop: %#v %v %v", events, rejected, err)
	}
}

func TestV2MediaInactiveGroupCannotStart(t *testing.T) {
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "group", GroupID: "other"}}
	events, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, &presentationv2.RuntimeRunCause{CueId: "cue"}, 3)
	if err != nil || !rejected || len(events) != 0 || snapshot.LastAllocatedRunSequence != 0 {
		t.Fatalf("inactive Group: %#v %v %v", events, rejected, err)
	}
}

func TestV2MediaMalformedStoppedStateFailsClosed(t *testing.T) {
	snapshot := mediaTestSnapshot()
	snapshot.MediaStates[0].State = nil
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "presentation"}}
	for _, kind := range []string{"media.seek", "media.pause", "media.play"} {
		_, _, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: kind, SeekMS: 5}, &presentationv2.RuntimeRunCause{CueId: "cue"}, 3)
		if err == nil {
			t.Fatalf("%s accepted malformed Media state", kind)
		}
		if snapshot.MediaStates[0].State != nil || snapshot.LastAllocatedRunSequence != 0 {
			t.Fatalf("%s mutated malformed state", kind)
		}
	}
}

func TestV2MediaDueReportsCorruptActiveRun(t *testing.T) {
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "presentation"}}
	if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, &presentationv2.RuntimeRunCause{CueId: "cue"}, 3); err != nil || rejected {
		t.Fatalf("play: %v %v", rejected, err)
	}
	snapshot.ActiveRuns[0].GetMedia().Playback.GetPlaying().PositionAtReferenceMs = -1
	_, _, _, err := nextV2MediaDue(snapshot, map[string]v2MediaSpec{"video": spec}, 1000)
	if err == nil {
		t.Fatal("corrupt playback must be a Runtime fault")
	}
}

func TestV2MediaDueReportsUnknownSpecAndOverdueRun(t *testing.T) {
	snapshot := mediaTestSnapshot()
	spec := v2MediaSpec{SurfaceID: "video", DurationMS: 1000, Owner: v2Owner{Kind: "presentation"}}
	if _, rejected, err := applyV2MediaCommand(snapshot, spec, v2MediaCommand{Kind: "media.play"}, &presentationv2.RuntimeRunCause{CueId: "cue"}, 3); err != nil || rejected {
		t.Fatalf("play: %v %v", rejected, err)
	}
	if _, _, _, err := nextV2MediaDue(snapshot, nil, 1000); err == nil {
		t.Fatal("unknown Media spec must fault")
	}
	snapshot.Clock.RuntimeTimeMs = 1001
	if _, _, _, err := nextV2MediaDue(snapshot, map[string]v2MediaSpec{"video": spec}, 1001); err == nil {
		t.Fatal("overdue Media Run must fault")
	}
}
