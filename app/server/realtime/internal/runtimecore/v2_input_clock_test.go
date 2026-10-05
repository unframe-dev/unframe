package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func TestV2InputDrainsDueTimerBeforeCueSelection(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"timeout","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":10},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"second"}},{"id":"old-input","priority":1,"order":1,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]},"second":{"id":"second","cues":[{"id":"new-input","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	s, err := NewV2Session(raw)
	if err != nil {
		t.Fatal(err)
	}
	s.lastTick = time.Now().Add(-20 * time.Millisecond)
	out, events, err := s.LogicalInput(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 3 || events[0].Sequence >= out.GetAccepted().ReliableSequence {
		t.Fatalf("due events must precede input: %v", events)
	}
	if got := out.GetAccepted().GetCueCommitted().GetCueId(); got != "new-input" {
		t.Fatalf("due timer deadline=10ms, elapsed>=20ms; selected=%s, step=%s, runtimeTime=%d", got, s.snapshot.Progression.CurrentStepId, s.snapshot.Clock.RuntimeTimeMs)
	}
	before := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	s.lastTick = time.Now().Add(-time.Second)
	duplicate, repeatEvents, err := s.LogicalInput(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"})
	if err != nil || len(repeatEvents) != 0 || !proto.Equal(duplicate, out) || !proto.Equal(before, s.snapshot) {
		t.Fatalf("duplicate advanced runtime: outcome=%v events=%v err=%v", duplicate, repeatEvents, err)
	}
}

func TestV2InputDrainsBlockingCompletionBeforeCueSelection(t *testing.T) {
	s, err := NewV2Session(json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]},"second":{"id":"second","cues":[{"id":"new-input","trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":10,"tracks":[]}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	id := &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}
	s.snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: id, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "fade"}}}}
	s.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: []*presentationv2.RuntimeRunId{id}, PendingNext: &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Step{Step: &realtimev2.NextStep{StepId: "second"}}}}}
	s.lastTick = time.Now().Add(-20 * time.Millisecond)
	outcome, events, err := s.LogicalInput(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"})
	if err != nil || outcome.GetAccepted().GetCueCommitted().GetCueId() != "new-input" || len(events) < 3 || events[0].GetTimelineCompleted() == nil {
		t.Fatalf("completion must precede selection: outcome=%v events=%v err=%v", outcome, events, err)
	}
}

func TestV2InputRechecksStatusAfterDueTimer(t *testing.T) {
	for _, tc := range []struct {
		name, next, actions                string
		paused, terminating, transitioning bool
	}{
		{name: "microstep pause", next: `{"kind":"step","stepId":"start"}`, actions: `[]`, paused: true},
		{name: "termination", next: `{"kind":"end"}`, actions: `[]`, terminating: true},
		{name: "blocking run", next: `{"kind":"stay"}`, actions: `[{"kind":"timeline.play","timelineId":"fade","completion":"blocking"}]`, transitioning: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"timeout","trigger":{"kind":"timer","afterMilliseconds":1},"firePolicy":{"kind":"oncePerStepEntry"},"actions":` + tc.actions + `,"next":` + tc.next + `}]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":100000,"tracks":[]}}}}`)
			if tc.paused {
				var definition map[string]any
				if err := json.Unmarshal(raw, &definition); err != nil {
					t.Fatal(err)
				}
				cues := make([]any, 1025)
				for i := range cues {
					cues[i] = map[string]any{"id": fmt.Sprintf("timer-%04d", i), "priority": 1, "order": i, "trigger": map[string]any{"kind": "timer", "afterMilliseconds": 1}, "firePolicy": map[string]any{"kind": "oncePerStepEntry"}, "next": map[string]any{"kind": "stay"}}
				}
				definition["flow"].(map[string]any)["groups"].(map[string]any)["intro"].(map[string]any)["steps"].(map[string]any)["start"].(map[string]any)["cues"] = cues
				raw, _ = json.Marshal(definition)
			}
			s, err := NewV2Session(raw)
			if err != nil {
				t.Fatal(err)
			}
			if tc.terminating || tc.transitioning {
				base, _ := reviewSession(t)
				s.checkpointMetadata = base.checkpointMetadata
				s.completionWriter = &recordingV2Completion{}
				s.checkpointCatalog = base.checkpointCatalog
				if tc.terminating {
					s.checkpointWriter = failingV2Checkpoint{}
				}
			}
			s.lastTick = time.Now().Add(-20 * time.Millisecond)
			out, events, err := s.LogicalInput(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"})
			if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_NOT_ACCEPTING_INPUT {
				t.Fatalf("status after drain: outcome=%v events=%v err=%v", out, events, err)
			}
			if len(events) == 0 || tc.paused && s.snapshot.Clock.GetPaused() == nil || tc.terminating && s.snapshot.Clock.GetTerminating() == nil || tc.transitioning && s.snapshot.Progression.GetTransitioning() == nil {
				t.Fatalf("missing due mutation: snapshot=%v events=%v", s.snapshot, events)
			}
		})
	}
}

func TestV2InputDuePersistenceFailureDoesNotAcceptInput(t *testing.T) {
	s, _ := reviewSession(t)
	var cue v2Cue
	if err := json.Unmarshal([]byte(`{"id":"timeout","trigger":{"kind":"timer","afterMilliseconds":10},"firePolicy":{"kind":"oncePerStepEntry"},"next":{"kind":"stay"}}`), &cue); err != nil {
		t.Fatal(err)
	}
	group := s.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	step.Cues = []v2Cue{cue}
	group.Steps["start"] = step
	s.definition.Flow.Groups["intro"] = group
	if _, err := s.enterV2Step("start"); err != nil {
		t.Fatal(err)
	}
	s.checkpointWriter = failingV2Checkpoint{}
	s.lastTick = time.Now().Add(-20 * time.Millisecond)
	out, events, err := s.LogicalInput(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"})
	if !errors.Is(err, ErrV2PersistenceUnavailable) || out != nil || len(events) != 0 || s.snapshot.Clock.GetPaused().GetReason() != realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED || s.snapshot.ReliableSequence != 0 || len(s.outcomes) != 0 {
		t.Fatalf("failed due commit accepted input: outcome=%v events=%v err=%v snapshot=%v", out, events, err, s.snapshot)
	}
}

func TestV2WallClockKeepsFractionalMilliseconds(t *testing.T) {
	s, err := NewV2Session(json.RawMessage(reviewDefinition))
	if err != nil {
		t.Fatal(err)
	}
	base := s.lastTick
	for _, offset := range []time.Duration{1500 * time.Microsecond, 3000 * time.Microsecond} {
		if _, err := s.AdvanceFromWall(context.Background(), base.Add(offset)); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.Snapshot().Clock.RuntimeTimeMs; got != 3 {
		t.Fatalf("fractional milliseconds were lost: got=%d want=3", got)
	}
}
