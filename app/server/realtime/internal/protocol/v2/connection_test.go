package protocolv2

import (
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func TestCapabilityNegotiation(t *testing.T) {
	handshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V2}}
	if err := NegotiateControl(handshake, handshake.SupportedCapabilities); err != nil {
		t.Fatal(err)
	}
	if err := NegotiateControl(handshake, []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_MODEL_CLIP_V2}); err == nil {
		t.Fatal("unsupported required capability admitted")
	}
	handshake.ProtocolVersion = "v1"
	if err := NegotiateControl(handshake, nil); err == nil {
		t.Fatal("protocol downgrade admitted")
	}
}

func TestProjectedViewRejectsUnreachableSurfaceState(t *testing.T) {
	canonical := snapshotFixture()
	view := &realtimev2.ParticipantRuntimeView{ProjectionProfileId: "profile", AssignmentEpoch: 1, BaseReliableSequence: 3, Progression: canonical.Progression, Clock: canonical.Clock, PresentationOrigin: canonical.PresentationOrigin, SurfaceStates: []*realtimev2.SurfaceRuntimeState{{SurfaceId: "surface", StateId: "state"}}}
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2, Surfaces: []*presentationv2.ProjectedSurfaceDefinition{{SurfaceId: "surface", HostNodeId: "host", ReachableStateIds: []string{"state"}, PhysicalSizeMeters: &presentationv2.Vector2{X: 1, Y: 1}, LogicalSize: &presentationv2.Vector2{X: 1, Y: 1}, Fit: presentationv2.SurfaceFit_SURFACE_FIT_CONTAIN, Owner: &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}}}}
	if err := ValidateProjectedView(view, catalog); err != nil {
		t.Fatal(err)
	}
	view.SurfaceStates[0].StateId = "unreachable"
	if err := ValidateProjectedView(view, catalog); err == nil {
		t.Fatal("unreachable Surface state admitted in connection snapshot")
	}
	view.SurfaceStates[0].StateId = "state"
	catalog.Timelines = []*presentationv2.ProjectedTimelineDefinition{{TimelineId: "timeline", DurationMs: 100, Owner: proto.Clone(catalog.Surfaces[0].Owner).(*presentationv2.ResourceOwner)}}
	view.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}, Owner: &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}, Cause: &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "event", GroupId: "group", GroupEntryEpoch: 1, StepId: "step", StepEntryEpoch: 1}, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, Run: &realtimev2.RuntimeRunSnapshot_Timeline{Timeline: &realtimev2.TimelineRunSnapshot{TimelineId: "timeline"}}}}
	if err := ValidateProjectedView(view, catalog); err != nil {
		t.Fatal(err)
	}
	view.ActiveRuns[0].GetTimeline().TimelineId = "unknown"
	if err := ValidateProjectedView(view, catalog); err == nil {
		t.Fatal("unknown projected Timeline run admitted")
	}
}
func connectionFixture(t *testing.T) *ConnectionCursor {
	t.Helper()
	canonical := snapshotFixture()
	fence := &presentationv2.RuntimeProjectionFence{SessionId: "session", Publication: publication(), AssignmentEpoch: 1, ProjectionProfileId: "profile", PresentationOriginVersion: 0}
	snapshot := &realtimev2.ConnectionSnapshotEnvelope{SchemaVersion: 2, ConnectionId: "connection", Fence: fence, ProjectionInstance: &presentationv2.ProjectionInstance{ProjectionProfileId: "profile", ParticipantId: "presenter", AssignmentEpoch: 1}, PresenceAtCut: &realtimev2.ProjectedPresenceState{}, ReliableSequence: 3, Snapshot: &realtimev2.ProjectedRuntimeSnapshot{ProjectionProfileId: "profile", AssignmentEpoch: 1, ReliableSequence: 3, RuntimeView: &realtimev2.ParticipantRuntimeView{ProjectionProfileId: "profile", AssignmentEpoch: 1, BaseReliableSequence: 3, Progression: canonical.Progression, Clock: canonical.Clock, PresentationOrigin: canonical.PresentationOrigin}}}
	invalidView := proto.Clone(snapshot).(*realtimev2.ConnectionSnapshotEnvelope)
	invalidView.Snapshot.RuntimeView.NodeStates = []*realtimev2.NodeRuntimeState{{NodeId: "hidden", Active: true, Visible: true, Opacity: 1, Transform: &presentationv2.Transform{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}, Scale: &presentationv2.Vector3{X: 1, Y: 1, Z: 1}}}}
	if _, err := NewConnectionCursor(invalidView, fence, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err == nil {
		t.Fatal("profile-external snapshot state admitted")
	}
	cursor, err := NewConnectionCursor(snapshot, fence, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2})
	if err != nil {
		t.Fatal(err)
	}
	bad := proto.Clone(snapshot).(*realtimev2.ConnectionSnapshotEnvelope)
	bad.Snapshot.RuntimeView.PresentationOrigin.Version = 1
	if _, err := NewConnectionCursor(bad, fence, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err == nil {
		t.Fatal("snapshot origin mismatch admitted")
	}
	return cursor
}
func TestResumePreservesReliableCutAcrossRejectedEvents(t *testing.T) {
	cursor := connectionFixture(t)
	event := &realtimev2.ProjectedReliableEvent{Sequence: 5, EventId: "event", Fence: cursor.Resume().Fence, Payload: &realtimev2.ProjectedReliableEvent_LogicalInputAccepted{LogicalInputAccepted: &realtimev2.LogicalInputAccepted{LogicalEventName: "next"}}}
	if err := cursor.ApplyReliable(event); err == nil {
		t.Fatal("reliable gap admitted")
	}
	if cursor.Resume().AppliedReliableSequence != 3 {
		t.Fatal("rejected event advanced cut")
	}
	if err := cursor.ApplyAdvance(&realtimev2.ProjectionAdvance{Fence: event.Fence, FromExclusive: 3, ThroughSequence: 4}); err != nil {
		t.Fatal(err)
	}
	if err := cursor.ApplyReliable(event); err != nil {
		t.Fatal(err)
	}
	if cursor.Resume().AppliedReliableSequence != 5 {
		t.Fatal("replay cursor did not advance")
	}
}
func TestStateDeltaGapRequiresKeyframe(t *testing.T) {
	cursor := connectionFixture(t)
	frame := &realtimev2.ElementStateFrame{Fence: cursor.Resume().Fence, FrameSequence: 1, BaseReliableSequence: 3, Kind: realtimev2.StateFrameKind_STATE_FRAME_KIND_DELTA}
	if err := cursor.AdmitState(frame); err == nil {
		t.Fatal("delta before keyframe admitted")
	}
	frame.Kind = realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME
	if err := cursor.AdmitState(frame); err != nil {
		t.Fatal(err)
	}
	frame.Kind = realtimev2.StateFrameKind_STATE_FRAME_KIND_DELTA
	frame.FrameSequence = 3
	if err := cursor.AdmitState(frame); err == nil {
		t.Fatal("delta gap admitted")
	}
	frame.Kind = realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME
	if err := cursor.AdmitState(frame); err != nil {
		t.Fatal(err)
	}
	frame.FrameSequence = 4
	frame.BaseReliableSequence = 4
	if err := cursor.AdmitState(frame); err == nil {
		t.Fatal("state ahead of applied Control admitted")
	}
}

func TestStateFrameCannotAddressProfileExternalNode(t *testing.T) {
	cursor := connectionFixture(t)
	yes := true
	opacity := 1.0
	frame := &realtimev2.ElementStateFrame{Fence: cursor.Resume().Fence, FrameSequence: 1, BaseReliableSequence: 3, Kind: realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME, Elements: []*realtimev2.ElementStatePatch{{ElementId: "hidden", Node: &realtimev2.NodeStatePatch{Active: &yes, Visible: &yes, Opacity: &opacity, Transform: &presentationv2.Transform{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}, Scale: &presentationv2.Vector3{X: 1, Y: 1, Z: 1}}}}}}
	if err := cursor.AdmitState(frame); err == nil {
		t.Fatal("State frame addresses hidden Node")
	}
	frame.Elements = nil
	if err := cursor.AdmitState(frame); err != nil {
		t.Fatal("rejected frame advanced sequence", err)
	}
}

func TestAnchorFrameCannotAddressProfileExternalNode(t *testing.T) {
	cursor := connectionFixture(t)
	frame := &realtimev2.ElementStateFrame{Fence: cursor.Resume().Fence, FrameSequence: 1, BaseReliableSequence: 3, Kind: realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME, AnchorBindings: []*realtimev2.ProjectedAnchorBindingPatch{{NodeId: "hidden", State: &realtimev2.ProjectedAnchorBindingPatch_Unavailable{Unavailable: &realtimev2.AnchorBindingUnavailable{}}}}}
	if err := cursor.AdmitState(frame); err == nil {
		t.Fatal("Anchor frame addresses hidden Node")
	}
}
