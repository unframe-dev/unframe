package runtimecore

import (
	"context"
	"encoding/json"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestForceAdvanceSelectsFirstManualCueIgnoringGuard(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"s","steps":{"s":{"id":"s","cues":[{"id":"timer","trigger":{"kind":"timer","afterMilliseconds":60000},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}},{"id":"gesture","trigger":{"kind":"gesture","gesture":"circle","actor":{"kind":"presenter"}},"guard":{"kind":"compare","left":{"kind":"literal","value":true},"operator":"eq","right":false},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"done"}},{"id":"next","trigger":{"kind":"logicalInput","action":"next","actor":{"kind":"presenter"}},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]},"done":{"id":"done","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(raw)
	if err != nil {
		t.Fatal(err)
	}
	ready := v3Acknowledge(t, core)
	cmd := &realtime.ForceAdvanceCommand{ClientEventId: v3TestEventID("force"), CommandEpoch: ready.CommandEpoch, InputContext: ready.InputContext}
	presenter := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.ForceAdvanceContext(context.Background(), session.Identity{Role: session.RoleViewer, ParticipantID: "viewer"}, cmd); err != ErrV2PresenterRequired {
		t.Fatalf("viewer error: %v", err)
	}
	out, events, err := core.ForceAdvanceContext(context.Background(), presenter, cmd)
	if err != nil || out.GetAccepted().GetCueCommitted().GetCueId() != "gesture" || core.Snapshot().Progression.CurrentStepId != "done" || len(events) < 1 || events[0].GetForceAdvanceAccepted() == nil {
		t.Fatalf("out=%v events=%v err=%v", out, events, err)
	}
	repeat, events, err := core.ForceAdvanceContext(context.Background(), presenter, cmd)
	if err != nil || !proto.Equal(out, repeat) || len(events) != 0 {
		t.Fatalf("retry=%v events=%v err=%v", repeat, events, err)
	}
}

func TestForceAdvanceRejectsWhenNoManualCueExists(t *testing.T) {
	core, err := NewV2Session(json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"s","steps":{"s":{"id":"s","cues":[{"id":"timer","trigger":{"kind":"timer","afterMilliseconds":60000},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	ready := v3Acknowledge(t, core)
	command := &realtime.ForceAdvanceCommand{ClientEventId: v3TestEventID("force-empty"), CommandEpoch: ready.CommandEpoch, InputContext: ready.InputContext}
	outcome, _, err := core.ForceAdvanceContext(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, command)
	if err != nil || outcome.GetRejected().GetReason() != realtime.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_UNAVAILABLE {
		t.Fatalf("outcome=%v err=%v", outcome, err)
	}
}
