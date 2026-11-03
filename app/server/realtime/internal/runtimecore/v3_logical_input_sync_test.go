package runtimecore

import (
	"encoding/json"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"slices"
	"strings"
	"testing"
)

func TestV3ResumePublishesLogicalInputsAtCommittedCut(t *testing.T) {
	core, writer := reviewSession(t)
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	var cue v2Cue
	if err := json.Unmarshal([]byte(`{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`), &cue); err != nil {
		t.Fatal(err)
	}
	step.Cues = []v2Cue{cue}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	pausedBefore, pauseSub, closePauseSub := core.SnapshotAndSubscribe()
	pauseEvents := v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	assertLogicalInputCut(t, core, pauseEvents, nil)
	pauseReplay, err := core.Replay(pausedBefore.ReliableSequence)
	if err != nil || len(pauseReplay) != len(pauseEvents) {
		t.Fatal("pause replay differs")
	}
	for i, e := range pauseEvents {
		if !proto.Equal(e, pauseReplay[i]) {
			t.Fatal("pause replay mismatch")
		}
		select {
		case got := <-pauseSub:
			if !proto.Equal(got, e) {
				t.Fatal("pause subscriber mismatch")
			}
		default:
			t.Fatal("pause subscription missing")
		}
	}
	closePauseSub()
	before, sub, closeSub := core.SnapshotAndSubscribe()
	defer closeSub()
	events := v3FrozenControl(t, core, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	assertLogicalInputCut(t, core, events, []string{"next"})
	replay, err := core.Replay(before.ReliableSequence)
	if err != nil {
		t.Fatal(err)
	}
	if len(replay) != len(events) {
		t.Fatalf("returned=%d replay=%d", len(events), len(replay))
	}
	for i, e := range events {
		if !proto.Equal(e, replay[i]) {
			t.Fatal("replay mismatch")
		}
		select {
		case got := <-sub:
			if !proto.Equal(e, got) {
				t.Fatal("subscription mismatch")
			}
		default:
			t.Fatal("missing subscription event")
		}
	}
	flushV2(t, core)
	persisted := &realtimev2.CanonicalRuntimeSnapshot{}
	if err := proto.Unmarshal(writer.envelope.CanonicalSnapshotPayload, persisted); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(persisted, core.Snapshot()) || !slices.Equal(core.EnabledLogicalInputs(persisted), []string{"next"}) {
		t.Fatal("checkpoint differs from published cut")
	}
	required := core.InputSynchronization()
	if required.ReliableSequence != core.Snapshot().ReliableSequence {
		t.Fatal("synchronization excludes availability update")
	}
	ready := v3Acknowledge(t, core)
	if ready.ReliableSequence != required.ReliableSequence {
		t.Fatal("READY cut mismatch")
	}
}
func assertLogicalInputCut(t *testing.T, core *V2Session, events []*realtimev2.ProjectedReliableEvent, want []string) {
	t.Helper()
	if len(events) == 0 {
		t.Fatal("missing events")
	}
	last := events[len(events)-1]
	view := last.GetRuntimeViewReplaced().GetRuntimeView()
	if view == nil || !slices.Equal(view.EnabledLogicalInputs, want) || view.BaseReliableSequence != last.Sequence || last.Sequence != core.Snapshot().ReliableSequence {
		t.Fatalf("availability cut: events=%v snapshot=%v", events, core.Snapshot())
	}
	if !slices.Equal(view.EnabledLogicalInputs, core.EnabledLogicalInputs(core.Snapshot())) {
		t.Fatal("canonical input mismatch")
	}
}

func TestV3LogicalInputChangesPublishCanonicalAvailability(t *testing.T) {
	for _, tc := range []struct {
		name, cues, action string
		want               []string
	}{
		{"consumed", `[{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]`, "next", nil},
		{"guard-enabled", `[{"id":"toggle","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"toggle"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"variable.set","variableId":"flag","value":{"kind":"literal","value":true}}],"next":{"kind":"stay"}},{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"guard":{"kind":"compare","left":{"kind":"variable","variableId":"flag"},"operator":"eq","right":true},"actions":[],"next":{"kind":"stay"}}]`, "toggle", []string{"next", "toggle"}},
		{"guard-disabled", `[{"id":"toggle","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"toggle"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"variable.set","variableId":"flag","value":{"kind":"literal","value":true}}],"next":{"kind":"stay"}},{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"guard":{"kind":"compare","left":{"kind":"variable","variableId":"flag"},"operator":"eq","right":false},"actions":[],"next":{"kind":"stay"}}]`, "toggle", []string{"toggle"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := strings.Replace(reviewDefinition, `"cues":[]`, `"cues":`+tc.cues, 1)
			raw = strings.Replace(raw, `"variables":{}`, `"variables":{"flag":{"id":"flag","type":"boolean","owner":{"kind":"presentation"},"initialValue":false}}`, 1)
			core, err := newV3RegressionSession(json.RawMessage(raw))
			if err != nil {
				t.Fatal(err)
			}
			freezeV2WallClock(core)
			before := core.Snapshot()
			_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "change", LogicalEventName: tc.action}))
			if err != nil {
				t.Fatal(err)
			}
			assertLogicalInputCut(t, core, events, tc.want)
			replay, err := core.Replay(before.ReliableSequence)
			if err != nil || len(replay) != len(events) {
				t.Fatalf("replay %v %v", replay, err)
			}
			for i, e := range events {
				if !proto.Equal(e, replay[i]) {
					t.Fatal("replay differs from return")
				}
			}
		})
	}
}

func TestV3StepEntryPublishesNewLogicalInputsAndBindsSynchronization(t *testing.T) {
	raw := strings.Replace(reviewDefinition, `"start":{"id":"start","cues":[]}`, `"start":{"id":"start","cues":[{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[{"id":"back","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"back"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}`, 1)
	core, err := newV3RegressionSession(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"}))
	if err != nil {
		t.Fatal(err)
	}
	assertLogicalInputCut(t, core, events, []string{"back"})
	if core.InputSynchronization().ReliableSequence != events[len(events)-1].Sequence {
		t.Fatal("step synchronization excludes inputs")
	}
	v3Acknowledge(t, core)
}
