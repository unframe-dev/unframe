package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestV3SharedPresenterCueConformance(t *testing.T) {
	raw, err := os.ReadFile("../../../../../packages/contracts/presentation/fixtures/presenter-cue-conformance.json")
	if err != nil {
		t.Fatal(err)
	}
	type expectedState struct {
		CueIDs         []string `json:"cueIds"`
		Count          float64  `json:"count"`
		StepID         string   `json:"stepId"`
		StepEntryEpoch uint64   `json:"stepEntryEpoch"`
		ActiveRunCount int      `json:"activeRunCount"`
		RuntimeTimeMs  uint64   `json:"runtimeTimeMs"`
	}
	var fixture struct {
		Definition json.RawMessage `json:"definition"`
		Trace      []struct {
			Operation struct {
				Kind            string `json:"kind"`
				Action          string `json:"action"`
				ToRuntimeTimeMs uint64 `json:"toRuntimeTimeMs"`
			} `json:"operation"`
			Expected expectedState `json:"expected"`
		} `json:"trace"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	core, err := NewV2Session(fixture.Definition)
	if err != nil {
		t.Fatal(err)
	}
	base, _ := reviewSession(t)
	catalog, err := BuildV2CanonicalCatalog(fixture.Definition)
	if err != nil {
		t.Fatal(err)
	}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, base.checkpointMetadata, catalog); err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if err := core.JoinParticipant(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	for index, row := range fixture.Trace {
		sync := v3Acknowledge(t, core)
		id := v3TestEventID(fmt.Sprintf("conformance-%d", index))
		var events []*realtime.ProjectedReliableEvent
		switch row.Operation.Kind {
		case "gesture":
			_, events, err = core.GestureInputContext(context.Background(), identity, &realtime.GestureInputCommand{ClientEventId: id, CommandEpoch: sync.CommandEpoch, InputContext: sync.InputContext, Gesture: 1})
		case "zoneEdge":
			_, events, err = core.ZoneInputContext(context.Background(), identity, &realtime.ZoneInputCommand{ClientEventId: id, CommandEpoch: sync.CommandEpoch, InputContext: sync.InputContext, ZoneId: "stage", Edge: 1})
		case "logicalInput":
			_, events, err = core.LogicalInput(identity, &realtime.LogicalInputCommand{ClientEventId: id, CommandEpoch: sync.CommandEpoch, InputContext: sync.InputContext, LogicalEventName: row.Operation.Action})
		case "advance":
			events, err = core.AdvanceTo(context.Background(), row.Operation.ToRuntimeTimeMs)
		default:
			t.Fatalf("unknown operation %q", row.Operation.Kind)
		}
		if err != nil {
			t.Fatalf("trace row %d: %v", index, err)
		}
		snapshot := core.Snapshot()
		actual := expectedState{CueIDs: []string{}, StepID: snapshot.Progression.CurrentStepId, StepEntryEpoch: snapshot.Progression.StepEntryEpoch, ActiveRunCount: len(snapshot.ActiveRuns), RuntimeTimeMs: snapshot.Clock.RuntimeTimeMs}
		for _, event := range events {
			if cue := event.GetCueAccepted(); cue != nil {
				actual.CueIDs = append(actual.CueIDs, cue.CueId)
			}
		}
		for _, variable := range snapshot.Variables {
			if variable.VariableId == "count" {
				actual.Count = variable.Value.GetNumberValue()
			}
		}
		if !reflect.DeepEqual(actual, row.Expected) {
			t.Fatalf("trace row %d (%s): got %+v, want %+v", index, row.Operation.Kind, actual, row.Expected)
		}
	}
}
