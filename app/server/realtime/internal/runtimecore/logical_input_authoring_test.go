package runtimecore

import (
	"os"
	"testing"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestLogicalInputFromAuthoringBuild(t *testing.T) {
	definition, err := os.ReadFile("../../../../../packages/unframe/cli/test/fixtures/logical-input-project/definition.json")
	if err != nil {
		t.Fatal(err)
	}
	core, err := newV3RegressionSession(definition)
	if err != nil {
		t.Fatal(err)
	}
	ready := v3Acknowledge(t, core)
	if core.Snapshot().Clock.GetRunning() == nil {
		t.Fatal("expected running runtime")
	}
	presenter := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := func(id, name string) *realtimev2.LogicalInputCommand {
		return &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID(id), CommandEpoch: ready.CommandEpoch, InputContext: ready.InputContext, LogicalEventName: name}
	}
	before := core.Snapshot()
	outcome, _, err := core.LogicalInput(presenter, command("undeclared", "presenter.unknown"))
	if err != nil || outcome.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_UNAVAILABLE || core.Snapshot().Progression.CurrentStepId != before.Progression.CurrentStepId || core.Snapshot().Variables[0].GetValue().GetNumberValue() != 0 {
		t.Fatalf("undeclared outcome=%v error=%v", outcome, err)
	}
	viewer := session.Identity{Role: session.RoleViewer, ParticipantID: "viewer"}
	if _, _, err := core.LogicalInput(viewer, command("viewer", "presenter.next")); err != ErrV2PresenterRequired || core.Snapshot().Progression.CurrentStepId != before.Progression.CurrentStepId || core.Snapshot().Variables[0].GetValue().GetNumberValue() != 0 {
		t.Fatalf("viewer error=%v", err)
	}
	outcome, _, err = core.LogicalInput(presenter, command("next", "presenter.next"))
	if err != nil || outcome.GetAccepted().GetCueCommitted().GetCueId() != "open" {
		t.Fatalf("presenter outcome=%v error=%v", outcome, err)
	}
	snapshot := core.Snapshot()
	if snapshot.Progression.CurrentStepId != "done" || len(snapshot.Variables) != 1 || snapshot.Variables[0].GetVariableId() != "count" || snapshot.Variables[0].GetValue().GetNumberValue() != 2 {
		t.Fatalf("step or action not applied: %v", snapshot)
	}
}
