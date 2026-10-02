package runtimecore

import (
	"encoding/json"
	"testing"

	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
)

func TestV2ProjectSnapshotFiltersResourcesByTrustedProfile(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"node-a":{"id":"node-a","kind":"container","owner":{"kind":"presentation"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"node-b":{"id":"node-b","kind":"container","owner":{"kind":"presentation"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	snapshot, err := NewV2InitialSnapshot(definition)
	if err != nil {
		t.Fatal(err)
	}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", VisibleNodeIds: []string{"node-a"}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	view, err := ProjectV2Snapshot(snapshot, profile, 3, nil)
	if err != nil || len(view.NodeStates) != 1 || view.NodeStates[0].NodeId != "node-a" || view.ProjectionProfileId != "profile-1" {
		t.Fatalf("projected view = %#v, error = %v", view, err)
	}
}

func TestV2ProjectSnapshotOmitsPrivateBlockingRunReference(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	snapshot, err := NewV2InitialSnapshot(definition)
	if err != nil {
		t.Fatal(err)
	}
	id := &presentationv2.RuntimeRunId{AssignmentEpoch: 3, RunSequence: 1}
	snapshot.LastAllocatedRunSequence = 1
	snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: id, Completion: presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "private"}}}}
	snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Transitioning{Transitioning: &realtimev2.TransitioningProgression{BlockingRunIds: []*presentationv2.RuntimeRunId{id}, PendingNext: &realtimev2.ProgressionNext{Destination: &realtimev2.ProgressionNext_Stay{Stay: &realtimev2.StayOnStep{}}}}}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "viewer", RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	view, err := ProjectV2Snapshot(snapshot, profile, 3, nil)
	if err != nil || len(view.ActiveRuns) != 0 || len(view.Progression.GetTransitioning().BlockingRunIds) != 0 {
		t.Fatalf("private run projection=%#v error=%v", view, err)
	}
}
