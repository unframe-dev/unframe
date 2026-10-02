package grpc

import (
	"context"
	"encoding/json"
	"net"
	"sync/atomic"
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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type revocableV2TrackingAssignment struct {
	allowAllAssignment
	revoked atomic.Bool
}

func (a *revocableV2TrackingAssignment) AllowCommand(assignment.AssignmentClaim) error {
	if a.revoked.Load() {
		return assignment.ErrLeaseExpired
	}
	return nil
}

func TestV2StateRejectsTrackingBeforeReady(t *testing.T)           { runV2TrackingGateTest(t, false) }
func TestV2StateRejectsTrackingAfterAssignmentRevoke(t *testing.T) { runV2TrackingGateTest(t, true) }

func runV2TrackingGateTest(t *testing.T, readyThenRevoke bool) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","stage":{"zones":{"zone":{"id":"zone","owner":{"kind":"presentation"},"center":[0,0,0],"size":[2,2,2]}}},"scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"enter","priority":1,"order":0,"trigger":{"kind":"zoneEdge","subject":{"kind":"participant","owner":{"kind":"presenter"}},"zoneId":"zone","edge":"enter"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT_V2}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	guard := &revocableV2TrackingAssignment{}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "presenter", Profile: profile}}, testIdentityResolver{identity}, guard)
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1 << 20)
	server := grpcgo.NewServer()
	realtimev2.RegisterRealtimeServiceV2Server(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := grpcgo.NewClient("passthrough:///tracking-ready", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
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
	snapshotItem, err := control.Recv()
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
	cut := runtime.Snapshot().ReliableSequence
	if readyThenRevoke {
		snapshot := snapshotItem.GetConnectionSnapshot()
		if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: snapshot.ReliableSequence, PresentationOriginVersion: snapshot.Snapshot.RuntimeView.PresentationOrigin.Version}}}); err != nil {
			t.Fatal(err)
		}
		if _, err := state.Recv(); err != nil {
			t.Fatal(err)
		}
	}
	pose := &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}
	if readyThenRevoke {
		outside := &presentationv2.Pose{Position: &presentationv2.Vector3{X: 2}, Rotation: &presentationv2.Quaternion{W: 1}}
		seed := &realtimev2.TrackingFrame{FrameSequence: 1, PresentationFromQuestLocal: pose, Samples: []*realtimev2.TrackedPoseSample{{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: outside, PositionAvailable: true, RotationAvailable: true}}}
		if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_TrackingFrame{TrackingFrame: seed}}); err != nil {
			t.Fatal(err)
		}
		guard.revoked.Store(true)
	}
	sequence := uint64(1)
	if readyThenRevoke {
		sequence = 2
	}
	frame := &realtimev2.TrackingFrame{FrameSequence: sequence, PresentationFromQuestLocal: pose, Samples: []*realtimev2.TrackedPoseSample{{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: pose, PositionAvailable: true, RotationAvailable: true}}}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_TrackingFrame{TrackingFrame: frame}}); err != nil {
		t.Fatal(err)
	}
	_, err = state.Recv()
	want := codes.InvalidArgument
	if readyThenRevoke {
		want = codes.FailedPrecondition
	}
	if status.Code(err) != want || runtime.Snapshot().ReliableSequence != cut {
		t.Fatalf("pre-ready tracking error=%v cut=%#v", err, runtime.Snapshot())
	}
	wantReason := "handshake_order_invalid"
	if readyThenRevoke {
		wantReason = "assignment_lease_expired"
	}
	if reason := state.Trailer().Get("unframe-reason"); len(reason) != 1 || reason[0] != wantReason {
		t.Fatalf("reason=%v", reason)
	}
}
