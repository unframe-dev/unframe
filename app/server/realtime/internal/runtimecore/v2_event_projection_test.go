package runtimecore

import (
	"testing"

	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func TestV2EventProjectionHidesPrivateResourcesAndFiltersGroupInitialization(t *testing.T) {
	profile := &deliveryv2.ProjectionProfileDescriptor{RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}, VisibleNodeIds: []string{"public-node"}}
	private := &realtimev2.ProjectedReliableEvent{Sequence: 1, Payload: &realtimev2.ProjectedReliableEvent_VariableChanged{VariableChanged: &realtimev2.VariableChanged{State: &realtimev2.VariableState{VariableId: "private-variable"}}}}
	if projected, visible := ProjectV2ReliableEvent(private, profile); visible || projected != nil {
		t.Fatalf("private event projected %#v", projected)
	}
	group := &realtimev2.ProjectedReliableEvent{Sequence: 2, Payload: &realtimev2.ProjectedReliableEvent_GroupEntered{GroupEntered: &realtimev2.GroupEntered{GroupId: "group", GroupEntryEpoch: 1, Initialization: &realtimev2.GroupRuntimeInitialization{NodeStates: []*realtimev2.NodeRuntimeState{{NodeId: "public-node"}, {NodeId: "private-node"}}, Variables: []*realtimev2.VariableState{{VariableId: "private-variable"}}}}}}
	projected, visible := ProjectV2ReliableEvent(group, profile)
	if !visible || len(projected.GetGroupEntered().Initialization.NodeStates) != 1 || len(projected.GetGroupEntered().Initialization.Variables) != 0 || len(group.GetGroupEntered().Initialization.NodeStates) != 2 {
		t.Fatalf("group projection=%#v original=%#v", projected, group)
	}
}

func TestV2MediaStoppedSeekProjectionUsesSurfaceVisibility(t *testing.T) {
	profile := &deliveryv2.ProjectionProfileDescriptor{RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}, VisibleSurfaceIds: []string{"visible"}}
	for _, tc := range []struct {
		id      string
		visible bool
	}{{"visible", true}, {"private", false}} {
		event := &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_MediaStoppedSeeked{MediaStoppedSeeked: &realtimev2.MediaStoppedSeeked{SurfaceId: tc.id, HeldPositionMs: 500}}}
		projected, visible := ProjectV2ReliableEvent(event, profile)
		if visible != tc.visible || (projected != nil) != tc.visible {
			t.Fatalf("surface %s projected=%v visible=%v", tc.id, projected, visible)
		}
	}
}
