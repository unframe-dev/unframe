package grpc

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"sync"
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

func TestV2StateReadyAfterVisibleConnectedBeforeSendReturns(t *testing.T) {
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
	gate := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(gate) })
	server := grpcgo.NewServer(grpcgo.StreamInterceptor(func(srv any, stream grpcgo.ServerStream, info *grpcgo.StreamServerInfo, handler grpcgo.StreamHandler) error {
		if info.FullMethod == "/unframe.realtime.v2.RealtimeServiceV2/ConnectState" {
			return handler(srv, &stateConnectedSendGate{ServerStream: stream, gate: gate})
		}
		return handler(srv, stream)
	}))
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

	cut := snapshotItem.GetConnectionSnapshot()
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: cut.ReliableSequence, PresentationOriginVersion: cut.Fence.PresentationOriginVersion}}}); err != nil {
		t.Fatal(err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_LogicalInput{LogicalInput: &realtimev2.LogicalInputCommand{ClientEventId: "after-ready", LogicalEventName: "next", PresentationOriginVersion: cut.Fence.PresentationOriginVersion}}}); err != nil {
		t.Fatal(err)
	}
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatalf("Control rejected StateReady immediately after StateConnected: %v", err)
		}
		if item.GetCommandOutcome() != nil {
			if item.GetCommandOutcome().GetAccepted() == nil {
				t.Fatalf("command after StateReady was not accepted: %v", item.GetCommandOutcome())
			}
			break
		}
	}
	release.Do(func() { close(gate) })
	frame, err := state.Recv()
	if err != nil || frame.GetStateFrame().GetKind() != realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME {
		t.Fatalf("keyframe after immediate StateReady = %v, error = %v", frame, err)
	}
	if err := state.CloseSend(); err != nil {
		t.Fatal(err)
	}
	fresh, err := control.Recv()
	for err == nil && fresh.GetStateConnectionNonce() == nil {
		fresh, err = control.Recv()
	}
	if err != nil || fresh.GetStateConnectionNonce() == nil {
		t.Fatalf("State-only disconnect did not issue a fresh nonce: item=%v error=%v", fresh, err)
	}
	if bytes.Equal(fresh.GetStateConnectionNonce().Nonce, nonceItem.GetStateConnectionNonce().Nonce) {
		t.Fatal("State-only disconnect reused the consumed nonce")
	}
	reconnected, err := client.ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := reconnected.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connectedItem.GetConnected().ConnectionId, StateConnectionNonce: fresh.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	if item, err := reconnected.Recv(); err != nil || item.GetConnected() == nil {
		t.Fatalf("reattachment connected=%v error=%v", item, err)
	}
	frames := make(chan *realtimev2.StateServerItem, 1)
	go func() { item, _ := reconnected.Recv(); frames <- item }()
	select {
	case item := <-frames:
		t.Fatalf("reattachment sent frame before renewed StateReady: %v", item)
	case <-time.After(50 * time.Millisecond):
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: cut.ReliableSequence, PresentationOriginVersion: cut.Fence.PresentationOriginVersion}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case item := <-frames:
		if item.GetStateFrame() == nil {
			t.Fatalf("reattachment frame=%v", item)
		}
	case <-ctx.Done():
		t.Fatal("reattachment failed after renewed StateReady")
	}
}

type stateConnectedSendGate struct {
	grpcgo.ServerStream
	gate <-chan struct{}
}

func (s *stateConnectedSendGate) SendMsg(message any) error {
	if err := s.ServerStream.SendMsg(message); err != nil {
		return err
	}
	item, ok := message.(*realtimev2.StateServerItem)
	if ok && item.GetConnected() != nil {
		select {
		case <-s.gate:
		case <-s.Context().Done():
			return s.Context().Err()
		}
	}
	return nil
}
