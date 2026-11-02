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
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type switchableV2Checkpoint struct{ fail atomic.Bool }

func (w *switchableV2Checkpoint) WriteCheckpoint(context.Context, *realtimev2.DurableCheckpointEnvelope) error {
	if w.fail.Load() {
		return errors.New("checkpoint unavailable")
	}
	return nil
}

func TestV2CheckpointFailureKeepsControlAndStateStreamsLive(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 2, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_INPUT_SYNCHRONIZATION, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_FROZEN_ANCHORS, presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_STEP_RESTORE}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 3}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 3}
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
	control, err := v3TestConnectControl(ctx, client)
	if err != nil {
		t.Fatal(err)
	}
	handshake := &realtimev2.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: profile.RequiredRuntimeCapabilities}
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
	if err := state.Send(&realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: connected.GetConnected().ConnectionId, StateConnectionNonce: nonce.GetStateConnectionNonce().Nonce}}}); err != nil {
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
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 1, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 3, Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	writer := &switchableV2Checkpoint{}
	v3TestReady(t, runtime, identity)
	if err := runtime.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	writer.fail.Store(true)
	_, events, err := v3TestLogicalInput(t, runtime, identity, "applied-input", "next")
	if err != nil || len(events) == 0 {
		t.Fatalf("input did not commit in memory: events=%v err=%v", events, err)
	}
	if err := runtime.FlushCheckpoint(ctx); err == nil {
		t.Fatal("unavailable checkpoint was reported as saved")
	}
	if runtime.Snapshot().Clock.GetRunning() == nil {
		t.Fatal("checkpoint failure paused progression")
	}
	wanted := runtime.Snapshot().ReliableSequence
	for {
		item, err := control.Recv()
		if err != nil {
			t.Fatalf("checkpoint failure closed control: %v", err)
		}
		if item.GetReliableEvent().GetSequence() >= wanted {
			break
		}
	}
	if item, err := state.Recv(); err != nil || item.GetStateFrame() == nil {
		t.Fatalf("checkpoint failure closed state: item=%v err=%v", item, err)
	}
	writer.fail.Store(false)
	if err := runtime.FlushCheckpoint(ctx); err != nil {
		t.Fatal(err)
	}
	saved := runtime.CheckpointStatus()
	if saved.SavedReliableSequence != runtime.Snapshot().ReliableSequence {
		t.Fatalf("checkpoint did not catch up: %+v", saved)
	}
}
