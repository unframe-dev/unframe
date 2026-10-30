package host

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	transport "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	persistence "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
)

type leaseResponse func(context.Context, persistence.BootstrapRequest) (persistence.RuntimeLease, error)

func (f leaseResponse) Lease(ctx context.Context, r persistence.BootstrapRequest) (persistence.RuntimeLease, error) {
	return f(ctx, r)
}
func TestCheckpointRejectionRevalidatesAssignmentWithoutPausingOnTransportFailure(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		revoked bool
	}{{"temporary", errors.New("offline"), false}, {"revoked", &persistence.ResponseError{StatusCode: 409}, true}, {"malformed", persistence.ErrInvalidBootstrap, true}} {
		t.Run(tc.name, func(t *testing.T) {
			a := hostAssignment()
			guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, Endpoint: a.Endpoint, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision, IssuedAt: a.IssuedAt, LeaseExpiresAt: time.Now().Add(time.Minute)}, nil)
			if err != nil {
				t.Fatal(err)
			}
			request := persistence.BootstrapRequest{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision}
			reader := leaseResponse(func(context.Context, persistence.BootstrapRequest) (persistence.RuntimeLease, error) {
				return persistence.RuntimeLease{}, tc.err
			})
			if err := verifySessionLease(context.Background(), reader, guard, request, persistence.BootstrapPublication{}); !errors.Is(err, tc.err) {
				t.Fatalf("verification=%v", err)
			}
			claim := assignment.AssignmentClaim{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision}
			if err := guard.AllowCommand(claim); (err != nil) != tc.revoked {
				t.Fatalf("authority changed incorrectly: %v", err)
			}
		})
	}
}

func TestHostReadinessTracksJWKSAvailability(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	checks := make(chan time.Time)
	results := make(chan bool, 2)
	calls := 0
	check := func(ctx context.Context) error {
		if _, ok := ctx.Deadline(); !ok {
			t.Error("readiness verification has no timeout")
		}
		calls++
		if calls == 1 {
			return errors.New("JWKS unavailable")
		}
		return nil
	}
	done := make(chan struct{})
	go func() { monitorHostReadiness(ctx, checks, check, func(ready bool) { results <- ready }); close(done) }()
	checks <- time.Now()
	if receive(t, results) {
		t.Fatal("JWKS outage advertised Host health")
	}
	checks <- time.Now()
	if !receive(t, results) {
		t.Fatal("JWKS recovery did not restore health")
	}
	cancel()
	receive(t, done)
}

type idlePersistence struct{}

func (idlePersistence) WriteCheckpoint(context.Context, *realtime.DurableCheckpointEnvelope) error {
	return nil
}
func (idlePersistence) CompleteCheckpoint(context.Context, *realtime.DurableCheckpointEnvelope, string, string, []runtimecore.V2Participant) error {
	return nil
}

type executionProbe struct{ result error }

func (p executionProbe) ConnectControl(grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]) error {
	return p.result
}
func (p executionProbe) ConnectState(grpcgo.BidiStreamingServer[realtime.StateClientItem, realtime.StateServerItem]) error {
	return p.result
}

type executionControlStream struct {
	grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]
	ctx context.Context
}

func (s executionControlStream) Context() context.Context { return s.ctx }

func servingExecution(t *testing.T, ctx context.Context, id string, router *transport.SessionRouter) (*runtimeExecution, context.Context, assignment.AssignmentClaim) {
	t.Helper()
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := runtimecore.NewV2Session(raw)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtime.DurableCheckpointEnvelope{SchemaVersion: 3, SessionId: id, RuntimeId: "host-1", RuntimeKind: realtime.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentation.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	if err := core.ConfigureDurability(idlePersistence{}, metadata, &presentation.ProjectedRuntimeCatalog{CatalogContractVersion: 3}); err != nil {
		t.Fatal(err)
	}
	core.ConfigureCompletion(idlePersistence{})
	a := hostAssignment()
	a.SessionID = id
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: id, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, Endpoint: a.Endpoint, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision, IssuedAt: a.IssuedAt, LeaseExpiresAt: a.LeaseExpiresAt}, nil)
	if err != nil {
		t.Fatal(err)
	}
	lifetime, stop := context.WithCancel(ctx)
	e := &runtimeExecution{assignment: a, guard: guard, runtime: core, router: router, cancel: stop, done: make(chan struct{})}
	claim := assignment.AssignmentClaim{SessionID: id, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: a.PresentationRevision}
	return e, lifetime, claim
}

func TestDurablyEndedRoomStopsItsExecutionAndKeepsOtherHostRoomsServing(t *testing.T) {
	router := transport.NewSessionRouter()
	global, cancel := context.WithCancel(context.Background())
	defer cancel()
	executions := make([]*runtimeExecution, 0, 2)
	claims := make([]assignment.AssignmentClaim, 0, 2)
	marker := errors.New("other room remains routed")
	for _, id := range []string{"ended-room", "other-room"} {
		e, lifetime, claim := servingExecution(t, global, id, router)
		if id == "ended-room" {
			identity := session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}
			if err := e.runtime.JoinParticipant(global, identity); err != nil {
				t.Fatal(err)
			}
			if err := e.runtime.LeaveParticipant(global, identity); err != nil {
				t.Fatal(err)
			}
			if _, err := e.runtime.AdvanceFromWall(global, time.Now().Add(10*time.Minute)); err != nil {
				t.Fatal(err)
			}
			if !e.runtime.DurablyEnded() {
				t.Fatal("room did not complete")
			}
		}
		router.Register(id, executionProbe{result: marker})
		executions = append(executions, e)
		claims = append(claims, claim)
		go e.run(lifetime, claim)
	}
	receive(t, executions[0].done)
	if err := executions[0].guard.AllowCommand(claims[0]); err == nil {
		t.Fatal("completed assignment not revoked")
	}
	select {
	case <-executions[1].done:
		t.Fatal("other execution stopped")
	default:
	}
	for _, id := range []string{"ended-room", "other-room"} {
		ctx := auth.ContextWithIdentity(global, session.Identity{SessionID: id, ProtocolVersion: 3})
		err := router.ConnectControl(executionControlStream{ctx: ctx})
		if id == "ended-room" && status.Code(err) != codes.Unavailable {
			t.Fatalf("ended room routed: %v", err)
		}
		if id == "other-room" && !errors.Is(err, marker) {
			t.Fatalf("other room not serving: %v", err)
		}
	}
	cancel()
	receive(t, executions[1].done)
}

func TestExplicitCompletionKeepsDelayedTerminalDeliveryAuthorized(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e, lifetime, claim := servingExecution(t, ctx, "explicit-end", transport.NewSessionRouter())
	presenter := session.Identity{ParticipantID: "presenter", Role: session.RolePresenter}
	if err := e.runtime.JoinParticipant(ctx, presenter); err != nil {
		t.Fatal(err)
	}
	_, _, events, stop, _ := e.runtime.SnapshotPresenceAndSubscribe()
	defer stop()
	command := &realtime.RuntimeControlCommand{ClientEventId: "1:00000000-0000-4000-8000-000000000001", CommandEpoch: 1, Kind: realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_END}
	if _, _, err := e.runtime.RuntimeControl(ctx, presenter, command); err != nil {
		t.Fatal(err)
	}
	if !e.runtime.DurablyEnded() {
		t.Fatal("explicit completion failed")
	}
	go e.run(lifetime, claim)
	select {
	case <-e.done:
		t.Fatal("explicit completion revoked delivery before queued events drained")
	case <-time.After(60 * time.Millisecond):
	}
	if err := e.guard.AllowReliableDelivery(claim); err != nil {
		t.Fatalf("delayed terminal sender rejected: %v", err)
	}
	if event := receive(t, events); event.GetRuntimeStatusChanged().GetTerminating() == nil {
		t.Fatalf("missing terminating event: %v", event)
	}
	if event := receive(t, events); event.GetPresentationEnded() == nil {
		t.Fatalf("missing ended event: %v", event)
	}
	cancel()
	receive(t, e.done)
}
