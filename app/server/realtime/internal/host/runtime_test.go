package host

import (
	"context"
	"errors"
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
