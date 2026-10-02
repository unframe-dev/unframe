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
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

func TestV2AnchorFrameFollowsFreshTrackingBeforeSampleExpires(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"badge":{"id":"badge","kind":"container","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"anchor","target":"body","owner":{"kind":"presenter"},"followPosition":true,"followRotation":false},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"leave","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"leave"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"group","groupId":"out"}}]}}},"out":{"id":"out","initialStepId":"empty","steps":{"empty":{"id":"empty","cues":[]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := runtimecore.BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, VisibleNodeIds: []string{"badge"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V2}, RuntimeCatalog: catalog}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "presenter", Profile: profile}}, testIdentityResolver{identity}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1 << 20)
	server := grpcgo.NewServer()
	realtimev2.RegisterRealtimeServiceV2Server(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, err := grpcgo.NewClient("passthrough:///anchor-cadence", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := conn.Close(); err != nil {
			t.Errorf("close gRPC connection: %v", err)
		}
	})
	client := realtimev2.NewRealtimeServiceV2Client(conn)
	control, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}); err != nil {
		t.Fatal(err)
	}
	connected, err := control.Recv()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := control.Recv()
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := control.Recv()
	if err != nil {
		t.Fatal(err)
	}
	state, err := client.ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := state.Recv(); err != nil {
		t.Fatal(err)
	}
	cut := snapshot.GetConnectionSnapshot()
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: cut.ReliableSequence, PresentationOriginVersion: cut.Snapshot.RuntimeView.PresentationOrigin.Version}}}); err != nil {
		t.Fatal(err)
	}
	if first, err := state.Recv(); err != nil || len(first.GetStateFrame().GetAnchorBindings()) != 1 {
		t.Fatalf("initial anchor frame=%#v err=%v", first, err)
	}
	pose := &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}
	started := time.Now()
	for sequence := uint64(1); sequence <= 3; sequence++ {
		tracking := &realtimev2.TrackingFrame{FrameSequence: sequence, PresentationFromQuestLocal: pose, Samples: []*realtimev2.TrackedPoseSample{{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: pose, PositionAvailable: true, RotationAvailable: true}}}
		if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_TrackingFrame{TrackingFrame: tracking}}); err != nil {
			t.Fatal(err)
		}
		if sequence < 3 {
			time.Sleep(60 * time.Millisecond)
		}
	}
	result := make(chan *realtimev2.StateServerItem, 1)
	go func() { item, _ := state.Recv(); result <- item }()
	select {
	case item := <-result:
		frame := item.GetStateFrame()
		if frame == nil || len(frame.AnchorBindings) != 1 || frame.AnchorBindings[0].GetSample() == nil || time.Since(started) >= 450*time.Millisecond {
			t.Fatalf("fresh anchor frame=%#v elapsed=%v", item, time.Since(started))
		}
		observed := frame.AnchorBindings[0].GetSample().ObservedAtRuntimeMonotonicMs
		if produced := frame.ProducedAtRuntimeMonotonicMs; observed == 0 || produced < observed || produced-observed > 500 {
			t.Fatalf("anchor sample outside frame clock: observed=%d produced=%d", observed, produced)
		}
	case <-time.After(450 * time.Millisecond):
		t.Fatal("fresh tracking did not produce an anchor frame before sample expiry")
	}
	if _, _, err := runtime.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "leave-1", LogicalEventName: "leave"}); err != nil {
		t.Fatal(err)
	}
	target := runtime.Snapshot().ReliableSequence
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if event := item.GetReliableEvent(); event != nil && event.Sequence == target {
			break
		}
	}
	for {
		item, err := state.Recv()
		if err != nil {
			t.Fatal(err)
		}
		if len(item.GetStateFrame().GetAnchorBindings()) == 0 {
			break
		}
	}
	withoutAnchorAt := time.Now()
	if next, err := state.Recv(); err != nil || time.Since(withoutAnchorAt) < 750*time.Millisecond || len(next.GetStateFrame().GetAnchorBindings()) != 0 {
		t.Fatalf("non-anchor cadence did not return to one second: frame=%#v elapsed=%v err=%v", next, time.Since(withoutAnchorAt), err)
	}
}
