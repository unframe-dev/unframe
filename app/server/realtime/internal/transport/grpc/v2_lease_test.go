package grpc

import (
	"context"
	"encoding/json"
	"io"
	"sync"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type v2LeaseStream[In, Out any] struct {
	grpcgo.ServerStream
	ctx     context.Context
	receive func() (*In, error)
	send    func(*Out) error
}

func (s *v2LeaseStream[In, Out]) Context() context.Context { return s.ctx }
func (s *v2LeaseStream[In, Out]) Recv() (*In, error)       { return s.receive() }
func (s *v2LeaseStream[In, Out]) Send(item *Out) error     { return s.send(item) }
func (s *v2LeaseStream[In, Out]) SetTrailer(_ metadata.MD) {}

func TestV2HandshakeStopsAtLeaseDeadline(t *testing.T) {
	for _, state := range []bool{false, true} {
		t.Run(map[bool]string{false: "Control", true: "State"}[state], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			deadline := time.Now().Add(30 * time.Millisecond)
			service := &V2Service{identities: testIdentityResolver{session.Identity{ProtocolVersion: 2}}, assignments: deadlineAssignment{deadline: deadline}}
			done := make(chan error, 1)
			if state {
				stream := &v2LeaseStream[realtimev2.StateClientItem, realtimev2.StateServerItem]{ctx: ctx, receive: func() (*realtimev2.StateClientItem, error) { <-ctx.Done(); return nil, ctx.Err() }}
				go func() { done <- service.ConnectState(stream) }()
			} else {
				stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) { <-ctx.Done(); return nil, ctx.Err() }}
				go func() { done <- service.ConnectControl(stream) }()
			}
			select {
			case err := <-done:
				if status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("error=%v", err)
				}
			case <-time.After(250 * time.Millisecond):
				t.Fatal("handshake outlived assignment lease")
			}
		})
	}
}

var _ AssignmentAuthorizer = deadlineAssignment{}

func newV2LeaseTestService(t *testing.T, assignments AssignmentAuthorizer) (*V2Service, *deliveryv2.ProjectionProfileDescriptor) {
	t.Helper()
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 2}
	service, err := NewV2Service(runtime, bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "presenter", Profile: profile}}, testIdentityResolver{identity}, assignments)
	if err != nil {
		t.Fatal(err)
	}

	return service, profile
}

func TestV2BlockedReliableSendStopsAtLeaseDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service, profile := newV2LeaseTestService(t, deadlineAssignment{deadline: time.Now().Add(200 * time.Millisecond)})
	inputs := make(chan *realtimev2.ControlClientItem, 2)
	inputs <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}
	blocked := make(chan struct{})
	var once sync.Once
	stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
		select {
		case item := <-inputs:
			return item, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, send: func(item *realtimev2.ControlServerItem) error {
		if item.GetStateConnectionNonce() != nil {
			inputs <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_LogicalInput{LogicalInput: &realtimev2.LogicalInputCommand{ClientEventId: "blocked-send", LogicalEventName: "next"}}}
		}
		if item.GetReliableEvent() != nil {
			once.Do(func() { close(blocked) })
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}}
	done := make(chan error, 1)
	go func() { done <- service.ConnectControl(stream) }()
	select {
	case <-blocked:
	case <-time.After(time.Second):
		t.Fatal("reliable event did not reach send")
	}
	select {
	case err := <-done:
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("error=%v", err)
		}
	case <-time.After(400 * time.Millisecond):
		t.Fatal("blocked reliable send outlived lease")
	}
}

func TestV2DisconnectEvictsExpiredResumeCredentials(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	service.resumeRecords["expired"] = v2ResumeRecord{expiresAt: time.Now().Add(-time.Second)}
	service.resumeRecords["live"] = v2ResumeRecord{expiresAt: time.Now().Add(time.Minute)}
	first := true
	stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
		if first {
			first = false
			return &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}, nil
		}
		return nil, io.EOF
	}, send: func(*realtimev2.ControlServerItem) error { return nil }}
	if err := service.ConnectControl(stream); err != nil {
		t.Fatal(err)
	}
	if _, exists := service.resumeRecords["expired"]; exists {
		t.Fatal("disconnect retained expired resume credential")
	}
	if _, exists := service.resumeRecords["live"]; !exists {
		t.Fatal("disconnect removed live resume credential")
	}
	if len(service.resumeRecords) != 2 {
		t.Fatalf("resume credential count=%d", len(service.resumeRecords))
	}
}

func TestV2HandshakeRechecksLeaseAfterReceive(t *testing.T) {
	for _, state := range []bool{false, true} {
		t.Run(map[bool]string{false: "Control", true: "State"}[state], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			lease := &renewableDeadlineAssignment{initialDuration: time.Hour}
			service, profile := newV2LeaseTestService(t, lease)
			var err error
			if state {
				stream := &v2LeaseStream[realtimev2.StateClientItem, realtimev2.StateServerItem]{ctx: ctx, receive: func() (*realtimev2.StateClientItem, error) {
					lease.renew(-time.Second)
					return &realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: "connection-1", StateConnectionNonce: make([]byte, 32)}}}, nil
				}, send: func(*realtimev2.StateServerItem) error { return nil }}
				err = service.ConnectState(stream)
			} else {
				received := false
				stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
					if received {
						return nil, io.EOF
					}
					received = true
					lease.renew(-time.Second)
					return &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}, nil
				}, send: func(*realtimev2.ControlServerItem) error { return nil }}
				err = service.ConnectControl(stream)
			}
			if status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("post-receive lease error=%v", err)
			}
		})
	}
}

func TestV2StateStopsAtLeaseDeadline(t *testing.T) {
	for _, stage := range []string{"connected_send", "ready_wait", "frame_send"} {
		t.Run(stage, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			service, profile := newV2LeaseTestService(t, deadlineAssignment{deadline: time.Now().Add(100 * time.Millisecond)})
			identity, _ := service.identities.Resolve(ctx)
			control := &v2Control{identity: identity, profile: profile, fence: &presentationv2.RuntimeProjectionFence{}, ready: make(chan struct{}), done: make(chan struct{}), stateDetached: make(chan struct{}, 1), faultGeneration: service.runtime.FaultGeneration()}
			if stage == "frame_send" {
				close(control.ready)
			}
			service.controls["connection-1"] = control
			nonce, err := service.nonces.Issue("connection-1", identity.ParticipantID)
			if err != nil {
				t.Fatal(err)
			}
			first := true
			reached := make(chan struct{})
			var once sync.Once
			stream := &v2LeaseStream[realtimev2.StateClientItem, realtimev2.StateServerItem]{ctx: ctx, receive: func() (*realtimev2.StateClientItem, error) {
				if !first {
					<-ctx.Done()
					return nil, ctx.Err()
				}
				first = false
				return &realtimev2.StateClientItem{Item: &realtimev2.StateClientItem_Handshake{Handshake: &realtimev2.StateHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities, ConnectionId: "connection-1", StateConnectionNonce: nonce}}}, nil
			}, send: func(item *realtimev2.StateServerItem) error {
				if (stage == "connected_send" && item.GetConnected() != nil) || (stage == "frame_send" && item.GetStateFrame() != nil) {
					once.Do(func() { close(reached) })
					<-ctx.Done()
					return ctx.Err()
				}
				if stage == "ready_wait" && item.GetConnected() != nil {
					once.Do(func() { close(reached) })
				}
				return nil
			}}
			done := make(chan error, 1)
			go func() { done <- service.ConnectState(stream) }()
			select {
			case <-reached:
			case <-time.After(time.Second):
				t.Fatal("state did not reach blocked stage")
			}
			select {
			case err := <-done:
				if status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("lease error=%v", err)
				}
			case <-time.After(300 * time.Millisecond):
				t.Fatal("state outlived assignment lease")
			}
		})
	}
}

func TestV2HandshakeUsesRenewedLeaseDeadline(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	initialized := make(chan struct{})
	lease := &renewableDeadlineAssignment{initialDuration: 100 * time.Millisecond, initialized: initialized}
	service := &V2Service{identities: testIdentityResolver{session.Identity{ProtocolVersion: 2}}, assignments: lease}
	stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) { <-ctx.Done(); return nil, ctx.Err() }}
	done := make(chan error, 1)
	go func() { done <- service.ConnectControl(stream) }()
	<-initialized
	original := lease.currentDeadline()
	lease.renew(300 * time.Millisecond)
	select {
	case err := <-done:
		t.Fatalf("handshake ended before renewed deadline: %v", err)
	case <-time.After(time.Until(original) + 50*time.Millisecond):
	}
	select {
	case err := <-done:
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("renewed lease error=%v", err)
		}
	case <-time.After(400 * time.Millisecond):
		t.Fatal("handshake outlived renewed lease")
	}
}
