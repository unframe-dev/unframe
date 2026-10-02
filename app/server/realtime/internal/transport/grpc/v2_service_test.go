package grpc

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type v2TestProjection struct {
	value persistencehttp.RuntimeProjection
}

func TestV2KeyframeOmitsOnlyTimelineOwnedNodeComponents(t *testing.T) {
	node := &realtimev2.NodeRuntimeState{NodeId: "actor", Active: true, Visible: true, Opacity: 0.6, Transform: &presentationv2.Transform{Position: &presentationv2.Vector3{X: 1}, Rotation: &presentationv2.Quaternion{W: 1}, Scale: &presentationv2.Vector3{X: 1, Y: 1, Z: 1}}}
	patch := v2KeyframeNodePatch(node, map[string]bool{"opacity": true, "transform.position": true})
	if patch.Active == nil || patch.Visible == nil || patch.Opacity != nil || patch.Transform == nil || patch.Transform.Position != nil || patch.Transform.Rotation == nil || patch.Transform.Scale == nil {
		t.Fatalf("partial keyframe patch=%#v", patch)
	}
	if err := protocolv2.ValidateMessage(patch); err != nil {
		t.Fatalf("partial keyframe admission: %v", err)
	}
}

func (p v2TestProjection) Projection(context.Context, persistencehttp.ProjectionRequest) (persistencehttp.RuntimeProjection, error) {
	return p.value, nil
}

func TestV2ServiceLiveControlStateNonceAndReady(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V2}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "presenter", Profile: profile}}, testIdentityResolver{identity}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1024 * 1024)
	server := grpcgo.NewServer()
	realtimev2.RegisterRealtimeServiceV2Server(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, err := grpcgo.NewClient("passthrough:///v2", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := realtimev2.NewRealtimeServiceV2Client(connection)
	control, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	handshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: handshake}}); err != nil {
		t.Fatal(err)
	}
	connectedItem, err := control.Recv()
	if err != nil || connectedItem.GetConnected() == nil {
		t.Fatalf("connected item = %#v, error = %v", connectedItem, err)
	}
	snapshotItem, err := control.Recv()
	if err != nil || snapshotItem.GetConnectionSnapshot() == nil {
		t.Fatalf("snapshot item = %#v, error = %v", snapshotItem, err)
	}
	nonceItem, err := control.Recv()
	if err != nil || len(nonceItem.GetStateConnectionNonce().GetNonce()) != 32 {
		t.Fatalf("nonce item = %#v, error = %v", nonceItem, err)
	}
	state, err := client.ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connectedItem.GetConnected().ConnectionId, StateConnectionNonce: nonceItem.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	stateConnected, err := state.Recv()
	if err != nil || stateConnected.GetConnected() == nil {
		t.Fatalf("state connected = %#v, error = %v", stateConnected, err)
	}
	if _, _, err := runtime.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "concurrent-1", LogicalEventName: "next"}); err != nil {
		t.Fatal(err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: snapshotItem.GetConnectionSnapshot().ReliableSequence, PresentationOriginVersion: snapshotItem.GetConnectionSnapshot().Snapshot.RuntimeView.PresentationOrigin.Version}}}); err != nil {
		t.Fatal(err)
	}
	frame, err := state.Recv()
	if err != nil || frame.GetStateFrame().GetKind() != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME {
		t.Fatalf("state keyframe = %#v, error = %v", frame, err)
	}
	pose := &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}
	tracking := &realtimev2.TrackingFrame{FrameSequence: 1, PresentationFromQuestLocal: pose, Samples: []*realtimev2.TrackedPoseSample{{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: pose, PositionAvailable: true, RotationAvailable: true}}}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_TrackingFrame{TrackingFrame: tracking}}); err != nil {
		t.Fatal(err)
	}
	if next, err := state.Recv(); err != nil || next.GetStateFrame() == nil {
		t.Fatalf("tracking ingress closed state: next=%#v err=%v", next, err)
	}
	if err := control.CloseSend(); err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := control.Recv(); err != nil {
			break
		}
	}
	resumeControl, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	resumeHandshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, Resume: &realtimev2.ResumeCursor{PriorConnectionId: connectedItem.GetConnected().ConnectionId, AppliedReliableSequence: snapshotItem.GetConnectionSnapshot().ReliableSequence, Fence: snapshotItem.GetConnectionSnapshot().Fence}}
	if err := resumeControl.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: resumeHandshake}}); err != nil {
		t.Fatal(err)
	}
	resumeConnected, err := resumeControl.Recv()
	if err != nil || resumeConnected.GetConnected() == nil {
		t.Fatalf("resume connected=%#v error=%v", resumeConnected, err)
	}
	seenReplay := false
	for {
		item, err := resumeControl.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if item.GetConnectionSnapshot() != nil {
			t.Fatal("resume mixed replay with snapshot")
		}
		if item.GetReliableEvent() != nil {
			seenReplay = true
		}
		if item.GetStateConnectionNonce() != nil {
			break
		}
	}
	if !seenReplay {
		t.Fatal("resume omitted reliable replay")
	}
}

func TestV2ServiceViewerReceivesProjectionAdvanceWithoutPrivateVariable(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"variable.set","variableId":"private-score","value":{"kind":"literal","value":2}}],"next":{"kind":"stay"}}]}}}},"variables":{"private-score":{"id":"private-score","type":"number","owner":{"kind":"presentation"},"initialValue":1}},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "viewer-profile", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_VIEWER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V2}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "viewer", Profile: profile}}, testIdentityResolver{identity}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1024 * 1024)
	server := grpcgo.NewServer()
	realtimev2.RegisterRealtimeServiceV2Server(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, err := grpcgo.NewClient("passthrough:///viewer-v2", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	control, err := realtimev2.NewRealtimeServiceV2Client(connection).ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}); err != nil {
		t.Fatal(err)
	}
	connected, err := control.Recv()
	if err != nil || connected.GetConnected() == nil {
		t.Fatalf("connected=%#v error=%v", connected, err)
	}
	snapshot, err := control.Recv()
	if err != nil || snapshot.GetConnectionSnapshot() == nil {
		t.Fatalf("snapshot=%#v error=%v", snapshot, err)
	}
	nonce, err := control.Recv()
	if err != nil || nonce.GetStateConnectionNonce() == nil {
		t.Fatalf("nonce=%#v error=%v", nonce, err)
	}
	presenter := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for _, id := range []string{"first", "second"} {
		if _, _, err := runtime.LogicalInput(presenter, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: "next"}); err != nil {
			t.Fatal(err)
		}
	}
	seenAdvance := false
	for i := 0; i < 5; i++ {
		item, err := control.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if item.GetReliableEvent().GetVariableChanged() != nil {
			t.Fatal("viewer received private variable")
		}
		if advance := item.GetProjectionAdvance(); advance != nil && advance.FromExclusive == 3 && advance.ThroughSequence == 4 {
			seenAdvance = true
		}
	}
	if !seenAdvance {
		t.Fatal("invisible event was not collapsed before the next visible event")
	}
	state, err := realtimev2.NewRealtimeServiceV2Client(connection).ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	if item, err := state.Recv(); err != nil || item.GetConnected() == nil {
		t.Fatalf("state connected=%#v error=%v", item, err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: snapshot.GetConnectionSnapshot().ReliableSequence, PresentationOriginVersion: snapshot.GetConnectionSnapshot().Fence.PresentationOriginVersion}}}); err != nil {
		t.Fatal(err)
	}
	frame, err := state.Recv()
	if err != nil || frame.GetStateFrame() == nil || frame.GetStateFrame().BaseReliableSequence != 6 {
		t.Fatalf("hidden-tail keyframe=%#v error=%v", frame, err)
	}
	if err := control.CloseSend(); err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := control.Recv(); err != nil {
			break
		}
	}
	resume, err := realtimev2.NewRealtimeServiceV2Client(connection).ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := resume.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, Resume: &realtimev2.ResumeCursor{PriorConnectionId: connected.GetConnected().ConnectionId, AppliedReliableSequence: 6, Fence: snapshot.GetConnectionSnapshot().Fence}}}}); err != nil {
		t.Fatal(err)
	}
	resumeConnected, err := resume.Recv()
	if err != nil || resumeConnected.GetConnected() == nil {
		t.Fatalf("resume connected=%#v error=%v", resumeConnected, err)
	}
	replayCut := uint64(6)
	for {
		item, err := resume.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if item.GetConnectionSnapshot() != nil {
			t.Fatal("resume sent a fresh snapshot")
		}
		if event := item.GetReliableEvent(); event != nil {
			replayCut = event.Sequence
			if event.GetVariableChanged() != nil {
				t.Fatal("resume leaked private variable")
			}
		}
		if item.GetStateConnectionNonce() != nil {
			nonce = item
			break
		}
	}
	if _, _, err := runtime.LogicalInput(presenter, &realtimev2.LogicalInputCommand{ClientEventId: "third", LogicalEventName: "next"}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if item, err := resume.Recv(); err != nil || item.GetReliableEvent() == nil {
			t.Fatalf("post-resume visible=%#v error=%v", item, err)
		}
	}
	resumeState, err := realtimev2.NewRealtimeServiceV2Client(connection).ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := resumeState.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: resumeConnected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	if item, err := resumeState.Recv(); err != nil || item.GetConnected() == nil {
		t.Fatalf("resume state connected=%#v error=%v", item, err)
	}
	if err := resume.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: replayCut, PresentationOriginVersion: snapshot.GetConnectionSnapshot().Fence.PresentationOriginVersion}}}); err != nil {
		t.Fatal(err)
	}
	resumeFrame, err := resumeState.Recv()
	if err != nil || resumeFrame.GetStateFrame() == nil || resumeFrame.GetStateFrame().BaseReliableSequence != replayCut+2 {
		t.Fatalf("resume hidden-tail keyframe=%#v replayCut=%d error=%v", resumeFrame, replayCut, err)
	}
}
