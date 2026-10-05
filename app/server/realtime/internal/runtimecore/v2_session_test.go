package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

type failingV2Checkpoint struct{}

func (failingV2Checkpoint) WriteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope) error {
	return errors.New("callback unavailable")
}

type recordingV2Checkpoint struct {
	envelope *realtimev2.DurableCheckpointEnvelope
}

func (r *recordingV2Checkpoint) WriteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope) error {
	r.envelope = envelope
	return nil
}

type recordingV2Completion struct {
	envelope *realtimev2.DurableCheckpointEnvelope
}

type failingV2Completion struct{}

func (failingV2Completion) CompleteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope, string, string, []V2Participant) error {
	return errors.New("completion unavailable")
}

func (r *recordingV2Completion) CompleteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope, _, _ string, _ []V2Participant) error {
	r.envelope = envelope
	return nil
}

func TestV2RuntimeControlPersistsPauseResumeAndCompletion(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	writer := &recordingV2Checkpoint{}
	completion := &recordingV2Completion{}
	if err := core.ConfigureDurability(writer, metadata, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err != nil {
		t.Fatal(err)
	}
	core.ConfigureCompletion(completion)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, events, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}); err != nil || len(events) != 1 || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE {
		t.Fatalf("pause events=%#v error=%v", events, err)
	}
	allowResume := false
	core.ConfigureResumeValidation(func(context.Context) error {
		if !allowResume {
			return errors.New("publication unavailable")
		}
		return nil
	})
	if _, events, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME}); err == nil || len(events) != 0 || core.Snapshot().Clock.GetPaused() == nil {
		t.Fatalf("unverified resume events=%#v error=%v", events, err)
	}
	allowResume = true
	if _, events, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME}); err != nil || len(events) != 1 || core.Snapshot().Clock.GetRunning() == nil {
		t.Fatalf("resume events=%#v error=%v", events, err)
	}
	if _, events, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "end", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END}); err != nil || len(events) != 2 || completion.envelope == nil || completion.envelope.ReliableSequence != core.Snapshot().ReliableSequence || core.Snapshot().Clock.GetTerminating() == nil {
		t.Fatalf("end events=%#v completion=%#v error=%v", events, completion.envelope, err)
	}
}

func TestV2CompletionFailurePausesWithoutPublishingEnd(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err != nil {
		t.Fatal(err)
	}
	core.ConfigureCompletion(failingV2Completion{})
	_, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "end-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END})
	if err == nil || len(events) != 0 || core.Snapshot().ReliableSequence != 0 || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED {
		t.Fatalf("failed completion events=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
}

func TestV2CueNextEndCompletesDurably(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"finish","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"finish"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"end"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	completion := &recordingV2Completion{}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err != nil {
		t.Fatal(err)
	}
	core.ConfigureCompletion(completion)
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "finish-1", LogicalEventName: "finish"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || events[0].GetLogicalInputAccepted() == nil || events[1].GetCueAccepted() == nil || events[2].GetRuntimeStatusChanged().GetTerminating() == nil || events[3].GetPresentationEnded() == nil || completion.envelope == nil || core.Snapshot().Clock.GetTerminating() == nil {
		t.Fatalf("end events=%#v completion=%#v snapshot=%#v", events, completion.envelope, core.Snapshot())
	}
}

func TestV2RuntimeControlEndClearsActiveSurfaceTransition(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"surface.setState","surfaceId":"surface","stateId":"second","transition":{"kind":"crossfade","durationMilliseconds":100,"easing":"linear","completion":"blocking"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	completion := &recordingV2Completion{}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	core.ConfigureCompletion(completion)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "next-1", LogicalEventName: "next"}); err != nil {
		t.Fatal(err)
	}
	if core.Snapshot().SurfaceStates[0].TransitionRunId == nil {
		t.Fatal("transition was not started")
	}
	if _, _, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "end-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END}); err != nil {
		t.Fatal(err)
	}
	cut := core.Snapshot()
	if cut.Clock.GetTerminating() == nil || len(cut.ActiveRuns) != 0 || cut.SurfaceStates[0].TransitionRunId != nil || completion.envelope == nil {
		t.Fatalf("end left active transition: %#v", cut)
	}
}

func TestV2AdvanceToOrdersCompletionsByDeadlineAndKind(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":50,"tracks":[]}}}}`)
	for _, test := range []struct {
		name                                             string
		timelineStarted, surfaceStarted, surfaceDuration uint64
		wantFirst                                        string
		wantTime                                         uint64
	}{
		{"different deadlines", 0, 0, 100, "timeline", 50},
		{"same deadline surface first", 50, 0, 50, "surface", 50},
	} {
		t.Run(test.name, func(t *testing.T) {
			core, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			timelineID := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}
			surfaceID := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 2}
			core.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{
				{RunId: timelineID, StartedAtRuntimeTimeMs: test.timelineStarted, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "fade"}}},
				{RunId: surfaceID, StartedAtRuntimeTimeMs: test.surfaceStarted, Run: &realtimev2.RuntimeRunSnapshot_SurfaceTransition{SurfaceTransition: &realtimev2.SurfaceTransitionRunSnapshot{SurfaceId: "surface", FromStateId: "first", ToStateId: "second", DurationMs: test.surfaceDuration}}},
			}
			core.snapshot.SurfaceStates[0].StateId = "second"
			core.snapshot.SurfaceStates[0].TransitionRunId = surfaceID
			events, err := core.AdvanceTo(context.Background(), 120)
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 2 || events[0].OccurredAtRuntimeTimeMs != test.wantTime {
				t.Fatalf("events=%#v", events)
			}
			if test.wantFirst == "surface" && events[0].GetSurfaceTransitionCompleted() == nil || test.wantFirst == "timeline" && events[0].GetTimelineCompleted() == nil {
				t.Fatalf("first event=%#v", events[0])
			}
		})
	}
}

func TestV2AdvanceToStopsAtBlockingEndBeforeLaterRunDeadline(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":50,"tracks":[]}}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	completion := &recordingV2Completion{}
	core.ConfigureCompletion(completion)
	timelineID := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}
	surfaceID := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 2}
	core.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{
		{RunId: timelineID, StartedAtRuntimeTimeMs: 0, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "fade"}}},
		{RunId: surfaceID, StartedAtRuntimeTimeMs: 0, Run: &realtimev2.RuntimeRunSnapshot_SurfaceTransition{SurfaceTransition: &realtimev2.SurfaceTransitionRunSnapshot{SurfaceId: "surface", FromStateId: "first", ToStateId: "second", DurationMs: 100}}},
	}
	core.snapshot.SurfaceStates[0].StateId = "second"
	core.snapshot.SurfaceStates[0].TransitionRunId = surfaceID
	core.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: []*presentationv2.RuntimeRunId{timelineID}, PendingNext: &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_End{End: &realtimev2.EndPresentation{}}}}}
	events, err := core.AdvanceTo(context.Background(), 120)
	if err != nil {
		t.Fatal(err)
	}
	if completion.envelope == nil || core.Snapshot().Clock.RuntimeTimeMs != 50 || len(core.Snapshot().ActiveRuns) != 0 {
		t.Fatalf("end cut=%#v completion=%#v", core.Snapshot(), completion.envelope)
	}
	for _, event := range events {
		if event.GetSurfaceTransitionCompleted() != nil {
			t.Fatalf("later Run completed after end: %#v", events)
		}
	}
}

func TestV2TimerFiresAtDeadlineAndRearmsOnStepEntry(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"first-timer","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":10},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[{"id":"second-timer","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":5},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	if len(core.Snapshot().StepExecution.Timers) != 1 || core.Snapshot().StepExecution.Timers[0].DeadlineRuntimeTimeMs != 10 {
		t.Fatal("initial timer not armed")
	}
	events, err := core.AdvanceTo(context.Background(), 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].GetCueAccepted().CueId != "first-timer" || events[0].OccurredAtRuntimeTimeMs != 10 || events[1].GetStepEntered().StepId != "second" || events[2].GetCueAccepted().CueId != "second-timer" || events[2].OccurredAtRuntimeTimeMs != 15 {
		t.Fatalf("timer events=%#v", events)
	}
	cut := core.Snapshot()
	if cut.Progression.CurrentStepId != "second" || len(cut.StepExecution.Timers) != 1 || !cut.StepExecution.Timers[0].Fired || cut.StepExecution.Timers[0].DeadlineRuntimeTimeMs != 15 {
		t.Fatalf("timer state=%#v", cut.StepExecution)
	}
}

func TestV2TimerDueWithBlockingRunFollowsCompletionOrder(t *testing.T) {
	base := `{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"timer","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":10},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":10,"tracks":[]}}}}`
	for _, after := range []uint64{5, 10} {
		t.Run(fmt.Sprintf("timer-at-%d", after), func(t *testing.T) {
			definition := json.RawMessage(strings.Replace(base, `"afterMilliseconds":10`, fmt.Sprintf(`"afterMilliseconds":%d`, after), 1))
			core, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			id := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}
			core.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: id, StartedAtRuntimeTimeMs: 0, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "fade"}}}}
			core.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: []*presentationv2.RuntimeRunId{id}, PendingNext: &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Stay{Stay: &realtimev2.StayOnStep{}}}}}
			events, err := core.AdvanceTo(context.Background(), 10)
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if after == 10 {
				want = 2
			}
			if len(events) != want || events[0].GetTimelineCompleted() == nil || after == 10 && events[1].GetCueAccepted() == nil || !core.Snapshot().StepExecution.Timers[0].Fired {
				t.Fatalf("timer at %d events=%#v snapshot=%#v", after, events, core.Snapshot())
			}
		})
	}
}

func TestV2TimerDrainResetsMicrostepCountAtEachDeadline(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"loop","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":1},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"start"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	events, err := core.AdvanceTo(context.Background(), 1025)
	if err != nil {
		t.Fatal(err)
	}
	cut := core.Snapshot()
	if len(events) != 2050 || cut.Clock.GetRunning() == nil || cut.Clock.RuntimeTimeMs != 1025 || cut.Progression.StepEntryEpoch != 1026 || events[len(events)-1].GetStepEntered() == nil {
		t.Fatalf("microstep cut=%#v events=%d", cut, len(events))
	}
}

func TestV2TimerDrainStopsAtSameDeadlineMicrostepLimit(t *testing.T) {
	cues := make([]string, 1024)
	for i := range cues {
		cues[i] = fmt.Sprintf(`{"id":"timer-%04d","priority":1,"order":%d,"trigger":{"kind":"timer","afterMilliseconds":1},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}`, i, i)
	}
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[` + strings.Join(cues, ",") + `]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":1,"tracks":[]}}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	core.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "fade"}}}}
	events, err := core.AdvanceTo(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	cut := core.Snapshot()
	if len(events) != 1025 || cut.Clock.GetPaused() == nil || cut.Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_MICROSTEP_LIMIT_EXCEEDED || cut.Clock.RuntimeTimeMs != 1 || events[len(events)-1].GetRuntimeStatusChanged() == nil {
		t.Fatalf("same-deadline events=%d cut=%#v", len(events), cut)
	}
}

func TestV2SessionRestoresDurableCutAndRejectsUnavailableReplay(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	if _, _, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"}); err != nil {
		t.Fatal(err)
	}
	if writer.envelope == nil || writer.envelope.ReliableSequence != 2 || writer.envelope.CheckpointSequence != 1 {
		t.Fatalf("checkpoint = %#v", writer.envelope)
	}
	recovered, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	if err := recovered.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	if err := recovered.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	if recovered.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED {
		t.Fatal("recovered runtime is not paused")
	}
	if _, err := recovered.Replay(0); err != ErrV2ReplayUnavailable {
		t.Fatalf("replay gap = %v", err)
	}
}

func TestV2SessionDoesNotPublishMutationWhenCheckpointFails(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(failingV2Checkpoint{}, metadata, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err == nil || len(events) != 0 || core.Snapshot().ReliableSequence != 0 || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED {
		t.Fatalf("checkpoint failure produced events %#v, sequence %d, error %v", events, core.Snapshot().ReliableSequence, err)
	}
	second, extra, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-2", LogicalEventName: "next"})
	if !errors.Is(err, ErrV2PersistenceUnavailable) || len(extra) != 0 || second != nil {
		t.Fatalf("fault gate outcome=%#v events=%#v error=%v", second, extra, err)
	}
}

func TestV2AdvanceToInvariantFaultPausesClockWithoutPublishing(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	core.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "missing"}}}}
	_, err = core.AdvanceTo(context.Background(), 100)
	if err == nil || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION || core.Snapshot().ReliableSequence != 0 {
		t.Fatalf("invariant fault err=%v cut=%#v", err, core.Snapshot())
	}
	_, resumed, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})
	if err == nil || len(resumed) != 0 || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().ReliableSequence != 0 {
		t.Fatalf("invalid runtime resumed: events=%#v cut=%#v err=%v", resumed, core.Snapshot(), err)
	}
}

func TestV2WallClockOverflowPrivatelyPausesAndClosesInput(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	core.snapshot.Clock.RuntimeTimeMs = math.MaxUint64 - 1
	start := core.lastTick
	_, err = core.AdvanceFromWall(context.Background(), start.Add(2*time.Millisecond))
	if err == nil || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION || core.FaultGeneration() != 1 || core.Snapshot().ReliableSequence != 0 {
		t.Fatalf("overflow err=%v cut=%#v generation=%d", err, core.Snapshot(), core.FaultGeneration())
	}
	result, _, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "after-overflow", LogicalEventName: "next"})
	if err != nil || result.GetRejected().Reason != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_NOT_ACCEPTING_INPUT {
		t.Fatalf("fault input result=%#v err=%v", result, err)
	}
}

func TestV2ResumeRejectsMissingOwnedNodeWithOrWithoutDurability(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"panel":{"id":"panel","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	for _, durable := range []bool{false, true} {
		t.Run(fmt.Sprintf("durable-%t", durable), func(t *testing.T) {
			core, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			if durable {
				metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
				if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
					t.Fatal(err)
				}
			}
			core.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION}}
			core.snapshot.NodeStates = nil
			_, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})
			if err == nil || len(events) != 0 || core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().ReliableSequence != 0 {
				t.Fatalf("missing node resumed events=%#v err=%v", events, err)
			}
		})
	}
}

func TestV2ResumeRejectsRecoveryGapWithoutContiguousLog(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	core.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_RECOVERY_GAP}}
	_, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-gap", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})
	if err == nil || len(events) != 0 || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_RECOVERY_GAP || core.Snapshot().ReliableSequence != 0 {
		t.Fatalf("recovery gap resumed events=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
}

func TestV2LeaseExpiryStopsClockAndPresenterInput(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	core.PauseLeaseExpired()
	cut := core.Snapshot()
	if cut.Clock.GetPaused() == nil || cut.Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED || cut.ReliableSequence != 0 {
		t.Fatalf("lease pause cut=%#v", cut)
	}
	if _, err := core.AdvanceTo(context.Background(), 100); err != nil || core.Snapshot().Clock.RuntimeTimeMs != 0 {
		t.Fatalf("lease pause clock err=%v cut=%#v", err, core.Snapshot())
	}
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "next-1", LogicalEventName: "next"})
	if err != nil || len(events) != 0 || outcome.GetRejected() == nil || outcome.GetRejected().Reason != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_NOT_ACCEPTING_INPUT {
		t.Fatalf("lease input outcome=%#v events=%#v err=%v", outcome, events, err)
	}
}

func TestV2SessionPresenceIsAtomicWithConnectionCutAndPresenterPause(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter}
	if err := core.JoinParticipant(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
	cut, presence, _, disconnect := core.SnapshotPresenceAndSubscribe()
	defer disconnect()
	if cut.ReliableSequence != 1 || len(presence.Participants) != 1 || !presence.Participants[0].Connected {
		t.Fatalf("cut=%#v presence=%#v", cut, presence)
	}
	if err := core.LeaveParticipant(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
	if core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_PRESENTER_DISCONNECTED {
		t.Fatalf("snapshot=%#v", core.Snapshot())
	}
}

func TestV2SessionExecutesLogicalInputAndNextStep(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next","actor":{"kind":"presenter"}},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	cut, deliveries, disconnect := core.SnapshotAndSubscribe()
	defer disconnect()
	if cut.ReliableSequence != 0 {
		t.Fatalf("initial cut sequence = %d", cut.ReliableSequence)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	outcome, events, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.GetAccepted().GetCueCommitted().GetCueId() != "cue-next" || outcome.GetAccepted().ReliableSequence != 1 || len(events) != 3 || events[0].GetLogicalInputAccepted() == nil || events[1].GetCueAccepted() == nil || events[2].GetStepEntered().StepId != "second" {
		t.Fatalf("outcome = %#v, events = %#v", outcome, events)
	}
	for sequence := uint64(1); sequence <= 3; sequence++ {
		if event := <-deliveries; event == nil || event.Sequence != sequence {
			t.Fatalf("delivery sequence = %#v, want %d", event, sequence)
		}
	}
	snapshot := core.Snapshot()
	if snapshot.Progression.CurrentStepId != "second" || snapshot.Progression.StepEntryEpoch != 2 || snapshot.ReliableSequence != 3 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	repeated, extra, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil || len(extra) != 0 || repeated.GetAccepted().ReliableSequence != 1 || core.Snapshot().ReliableSequence != 3 {
		t.Fatalf("duplicate outcome = %#v, events = %#v, error = %v", repeated, extra, err)
	}
	replay, err := core.Replay(1)
	if err != nil || len(replay) != 2 || replay[0].Sequence != 2 || replay[1].Sequence != 3 {
		t.Fatalf("replay after 1 = %#v, error = %v", replay, err)
	}
}

func TestV2SessionCommitsImmediateActionInDurableEventOrder(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"variable.set","variableId":"score","value":{"kind":"literal","value":2}}],"next":{"kind":"stay"}}]}}}},"variables":{"score":{"id":"score","type":"number","owner":{"kind":"presentation"},"initialValue":1}},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.GetAccepted().GetCueCommitted() == nil || len(events) != 3 || events[0].Sequence != 1 || events[1].GetCueAccepted() == nil || events[2].GetVariableChanged().GetState().GetValue().GetNumberValue() != 2 || writer.envelope.ReliableSequence != 3 {
		t.Fatalf("outcome=%#v events=%#v checkpoint=%#v", outcome, events, writer.envelope)
	}
}

func TestV2SessionStartsBlockingTimelineAndDefersStep(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"panel":{"id":"panel","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":0}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"fade","completion":"blocking","conflict":"reject"}],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"panel","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[2].GetTimelineStarted() == nil || core.Snapshot().Progression.GetTransitioning() == nil || core.Snapshot().Progression.CurrentStepId != "start" {
		t.Fatalf("events=%#v snapshot=%#v", events, core.Snapshot())
	}
	completed, err := core.AdvanceTo(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(completed) != 3 || completed[0].GetTimelineCompleted() == nil || completed[1].GetNodeStateCommitted().GetState().Opacity != 1 || completed[2].GetStepEntered().StepId != "second" || len(core.Snapshot().ActiveRuns) != 0 || core.Snapshot().Progression.GetStable() == nil || writer.envelope.ReliableSequence != 6 {
		t.Fatalf("completion=%#v snapshot=%#v checkpoint=%#v", completed, core.Snapshot(), writer.envelope)
	}
}

func TestV2SessionSurfaceCrossfadeCompletesAtRuntimeDeadline(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"surface.setState","surfaceId":"surface","stateId":"second","transition":{"kind":"crossfade","durationMilliseconds":100,"easing":"linear","completion":"blocking"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil || len(events) != 3 || events[2].GetSurfaceTransitionStarted() == nil || core.Snapshot().SurfaceStates[0].StateId != "second" || core.Snapshot().SurfaceStates[0].TransitionRunId == nil {
		t.Fatalf("start events=%#v snapshot=%#v error=%v", events, core.Snapshot(), err)
	}
	completed, err := core.AdvanceTo(context.Background(), 100)
	if err != nil || len(completed) != 1 || completed[0].GetSurfaceTransitionCompleted() == nil || core.Snapshot().SurfaceStates[0].TransitionRunId != nil {
		t.Fatalf("completion=%#v snapshot=%#v error=%v", completed, core.Snapshot(), err)
	}
}

func TestV2SurfaceSameStateCrossfadeRejectsBatchButAcceptsInput(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"surface.setState","surfaceId":"surface","stateId":"first","transition":{"kind":"crossfade","durationMilliseconds":100,"easing":"linear","completion":"blocking"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil || outcome.GetAccepted().GetCueBatchRejected().Reason != realtimev2.CueRejectionReason_CUE_REJECTION_REASON_SAME_STATE_CROSSFADE || len(events) != 1 || core.Snapshot().ReliableSequence != 1 {
		t.Fatalf("outcome=%#v events=%#v error=%v", outcome, events, err)
	}
}

func TestV2SessionGroupTransitionReplacesOwnedState(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"old":{"id":"old","kind":"container","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"new":{"id":"new","kind":"container","owner":{"kind":"group","groupId":"next"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"group","groupId":"next"}}]}}},"next":{"id":"next","initialStepId":"start-next","steps":{"start-next":{"id":"start-next","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "click-1", LogicalEventName: "next"})
	if err != nil || outcome.GetAccepted().GetCueCommitted() == nil || len(events) != 5 || events[2].GetGroupExited() == nil || events[3].GetGroupEntered() == nil || events[4].GetStepEntered() == nil {
		t.Fatalf("outcome=%#v events=%#v error=%v", outcome, events, err)
	}
	if len(events[3].GetGroupEntered().Initialization.NodeStates) != 1 || events[3].GetGroupEntered().Initialization.NodeStates[0].NodeId != "new" || core.Snapshot().Progression.CurrentGroupId != "next" || len(core.Snapshot().NodeStates) != 1 || core.Snapshot().NodeStates[0].NodeId != "new" {
		t.Fatalf("group transition events=%#v snapshot=%#v", events, core.Snapshot())
	}
}

func TestV2SessionExecutesSurfaceInteraction(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"state","states":{"state":{"enabledInteractionIds":["tap"]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-tap","priority":1,"order":0,"trigger":{"kind":"surfaceInteraction","surfaceId":"surface","interactionId":"tap","actor":{"kind":"presenter"}},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	outcome, events, err := core.SurfaceInteraction(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.SurfaceInteractionCommand{ClientEventId: "tap-1", SurfaceId: "surface", InteractionId: "tap"})
	if err != nil || outcome.GetAccepted().GetCueCommitted().GetCueId() != "cue-tap" || len(events) != 2 || events[0].GetSurfaceInteractionAccepted() == nil {
		t.Fatalf("outcome = %#v, events = %#v, error = %v", outcome, events, err)
	}
}

func TestV2SurfaceInteractionRejectsHiddenHostOrAncestor(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"parent":{"id":"parent","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"node","nodeId":"parent"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"state","states":{"state":{"enabledInteractionIds":["tap"]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-tap","priority":1,"order":0,"trigger":{"kind":"surfaceInteraction","surfaceId":"surface","interactionId":"tap"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	for _, hidden := range []string{"host", "parent"} {
		t.Run(hidden, func(t *testing.T) {
			core, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			for _, state := range core.snapshot.NodeStates {
				if state.NodeId == hidden {
					state.Visible = false
				}
			}
			outcome, events, err := core.SurfaceInteraction(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.SurfaceInteractionCommand{ClientEventId: "tap-1", SurfaceId: "surface", InteractionId: "tap"})
			if err != nil || outcome.GetRejected() == nil || outcome.GetRejected().Reason != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INTERACTION_UNAVAILABLE || len(events) != 0 || core.Snapshot().ReliableSequence != 0 {
				t.Fatalf("hidden %s accepted: outcome=%#v events=%#v err=%v", hidden, outcome, events, err)
			}
		})
	}
}
