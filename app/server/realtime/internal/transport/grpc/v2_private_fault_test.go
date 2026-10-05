package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type switchableV2Checkpoint struct{ fail atomic.Bool }

func (w *switchableV2Checkpoint) WriteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope) error {
	if w.fail.Load() {
		return errors.New("checkpoint unavailable")
	}
	return nil
}

func TestV2PrivateCheckpointFaultClosesStreamsAndForcesFreshPausedSnapshot(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "presenter", Profile: profile}}, testIdentityResolver{identity}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1024 * 1024)
	server := grpcgo.NewServer()
	realtimev2.RegisterRealtimeServiceServer(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := grpcgo.NewClient("passthrough:///v2-fault", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := realtimev2.NewRealtimeServiceClient(connection)
	control, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	handshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: handshake}}); err != nil {
		t.Fatal(err)
	}
	connected, err := control.Recv()
	if err != nil || connected.GetConnected() == nil {
		t.Fatalf("connected=%v err=%v", connected, err)
	}
	cut, err := control.Recv()
	if err != nil || cut.GetConnectionSnapshot() == nil {
		t.Fatalf("snapshot=%v err=%v", cut, err)
	}
	nonce, err := control.Recv()
	if err != nil || nonce.GetStateConnectionNonce() == nil {
		t.Fatalf("nonce=%v err=%v", nonce, err)
	}
	state, err := client.ConnectState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}}); err != nil {
		t.Fatal(err)
	}
	if item, err := state.Recv(); err != nil || item.GetConnected() == nil {
		t.Fatalf("state connected=%v err=%v", item, err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_StateReady{StateReady: &realtimev2.StateReady{AppliedReliableSequence: cut.GetConnectionSnapshot().ReliableSequence, PresentationOriginVersion: cut.GetConnectionSnapshot().Snapshot.RuntimeView.PresentationOrigin.Version}}}); err != nil {
		t.Fatal(err)
	}
	if item, err := state.Recv(); err != nil || item.GetStateFrame() == nil {
		t.Fatalf("initial frame=%v err=%v", item, err)
	}
	catalog, err := runtimecore.BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 3, Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	writer := &switchableV2Checkpoint{}
	if err := runtime.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	writer.fail.Store(true)
	if _, _, err := runtime.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "fault-input", LogicalEventName: "next"}); err == nil {
		t.Fatal("checkpoint failure did not fault")
	}
	if _, err := control.Recv(); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("control fault=%v", err)
	}
	if reason := control.Trailer().Get("unframe-reason"); len(reason) != 1 || reason[0] != "runtime_snapshot_required" {
		t.Fatalf("control reason=%v", reason)
	}
	if _, err := state.Recv(); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("state fault=%v", err)
	}
	if reason := state.Trailer().Get("unframe-reason"); len(reason) != 1 || reason[0] != "runtime_snapshot_required" {
		t.Fatalf("state reason=%v", reason)
	}
	writer.fail.Store(false)
	resume, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	resumeHandshake := &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, Resume: &realtimev2.ResumeCursor{PriorConnectionId: connected.GetConnected().ConnectionId, AppliedReliableSequence: cut.GetConnectionSnapshot().ReliableSequence, Fence: cut.GetConnectionSnapshot().Fence}}
	if err := resume.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: resumeHandshake}}); err != nil {
		t.Fatal(err)
	}
	if item, err := resume.Recv(); err != nil || item.GetResyncRequired() == nil {
		t.Fatalf("stale resume=%v err=%v", item, err)
	}
	fresh, err := client.ConnectControl(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := fresh.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: handshake}}); err != nil {
		t.Fatal(err)
	}
	if item, err := fresh.Recv(); err != nil || item.GetConnected() == nil {
		t.Fatalf("fresh connected=%v err=%v", item, err)
	}
	paused, err := fresh.Recv()
	if err != nil || paused.GetConnectionSnapshot().Snapshot.RuntimeView.Clock.GetPaused() == nil {
		t.Fatalf("fresh paused=%v err=%v", paused, err)
	}
	if item, err := fresh.Recv(); err != nil || item.GetStateConnectionNonce() == nil {
		t.Fatalf("fresh nonce=%v err=%v", item, err)
	}
	if err := fresh.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_LogicalInput{LogicalInput: &realtimev2.LogicalInputCommand{LogicalEventName: "next"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.Recv(); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("malformed input status=%v", err)
	}
	if reason := fresh.Trailer().Get("unframe-reason"); len(reason) != 1 || reason[0] != "message_invalid" {
		t.Fatalf("malformed input reason=%v", reason)
	}
}
