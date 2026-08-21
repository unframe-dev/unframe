package assignment

import (
	"errors"
	"testing"
	"time"
)

func TestRuntimeAssignmentValidateRequiresEveryField(t *testing.T) {
	t.Parallel()

	issuedAt := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	valid := RuntimeAssignment{
		SessionID:            "session-1",
		RuntimeID:            "runtime-1",
		RuntimeKind:          RuntimeKindCloud,
		Endpoint:             "runtime.example.test:443",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             issuedAt,
		LeaseExpiresAt:       issuedAt.Add(time.Minute),
	}

	tests := []struct {
		name       string
		assignment RuntimeAssignment
	}{
		{name: "session ID", assignment: RuntimeAssignment{RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "runtime ID", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "runtime kind", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "unknown runtime kind", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: RuntimeKind("unknown"), Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "endpoint", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "assignment epoch", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "presentation revision", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "issued at", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "lease expires at", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt}},
		{name: "lease expires at issue", assignment: RuntimeAssignment{SessionID: valid.SessionID, RuntimeID: valid.RuntimeID, RuntimeKind: valid.RuntimeKind, Endpoint: valid.Endpoint, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.IssuedAt}},
	}

	if err := valid.Validate(); err != nil {
		t.Fatalf("validate valid assignment: %v", err)
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.assignment.Validate(); !errors.Is(err, ErrInvalidAssignment) {
				t.Errorf("Validate() error = %v, want %v", err, ErrInvalidAssignment)
			}
		})
	}
}

func TestAssignmentGuardRejectsMismatchedRuntimeIdentityOrEpoch(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	claim := currentClaim()

	wrongRuntimeID := claim
	wrongRuntimeID.RuntimeID = "runtime-2"
	if err := guard.ValidateCurrent(wrongRuntimeID); !errors.Is(err, ErrAssignmentRuntimeIDMismatch) {
		t.Errorf("wrong runtime ID error = %v, want %v", err, ErrAssignmentRuntimeIDMismatch)
	}
	wrongRuntimeKind := claim
	wrongRuntimeKind.RuntimeKind = RuntimeKindVenueEdge
	if err := guard.ValidateCurrent(wrongRuntimeKind); !errors.Is(err, ErrAssignmentRuntimeKindMismatch) {
		t.Errorf("wrong runtime kind error = %v, want %v", err, ErrAssignmentRuntimeKindMismatch)
	}
	wrongEpoch := claim
	wrongEpoch.AssignmentEpoch++
	if err := guard.ValidateCurrent(wrongEpoch); !errors.Is(err, ErrAssignmentEpochMismatch) {
		t.Errorf("wrong epoch error = %v, want %v", err, ErrAssignmentEpochMismatch)
	}
	if err := guard.ValidateCurrent(claim); err != nil {
		t.Errorf("validate current assignment: %v", err)
	}
}

func TestAssignmentGuardRejectsWrongSessionOrPresentationRevision(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	claim := currentClaim()

	wrongSession := claim
	wrongSession.SessionID = "session-2"
	if err := guard.AllowNewConnection(wrongSession); !errors.Is(err, ErrAssignmentSessionMismatch) {
		t.Errorf("wrong session error = %v, want %v", err, ErrAssignmentSessionMismatch)
	}
	wrongRevision := claim
	wrongRevision.PresentationRevision++
	if err := guard.AllowCommand(wrongRevision); !errors.Is(err, ErrAssignmentRevisionMismatch) {
		t.Errorf("wrong revision error = %v, want %v", err, ErrAssignmentRevisionMismatch)
	}
}

func TestAssignmentGuardRejectsEveryProtectedOperationAfterLeaseExpiry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	now = now.Add(time.Minute)
	if _, err := guard.ReliableDeliveryDeadline(currentClaim()); !errors.Is(err, ErrLeaseExpired) {
		t.Errorf("reliable delivery deadline error = %v, want %v", err, ErrLeaseExpired)
	}

	operations := map[string]func(AssignmentClaim) error{
		"new connection":    guard.AllowNewConnection,
		"command":           guard.AllowCommand,
		"reliable delivery": guard.AllowReliableDelivery,
		"state update":      guard.AllowStateUpdate,
		"checkpoint":        guard.AllowCheckpoint,
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			if err := operation(currentClaim()); !errors.Is(err, ErrLeaseExpired) {
				t.Errorf("operation error = %v, want %v", err, ErrLeaseExpired)
			}
		})
	}
}

func TestAssignmentGuardRenewsOnlyCurrentImmutableAssignmentWithExtendedLease(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	current := guard.Assignment()

	tests := []struct {
		name   string
		mutate func(*RuntimeAssignment)
		want   error
	}{
		{name: "session", mutate: func(a *RuntimeAssignment) { a.SessionID = "session-2" }, want: ErrAssignmentSessionMismatch},
		{name: "runtime ID", mutate: func(a *RuntimeAssignment) { a.RuntimeID = "runtime-2" }, want: ErrAssignmentRuntimeIDMismatch},
		{name: "runtime kind", mutate: func(a *RuntimeAssignment) { a.RuntimeKind = RuntimeKindVenueEdge }, want: ErrAssignmentRuntimeKindMismatch},
		{name: "endpoint", mutate: func(a *RuntimeAssignment) { a.Endpoint = "other-runtime.example.test:443" }, want: ErrAssignmentEndpointMismatch},
		{name: "assignment epoch", mutate: func(a *RuntimeAssignment) { a.AssignmentEpoch++ }, want: ErrAssignmentEpochMismatch},
		{name: "presentation revision", mutate: func(a *RuntimeAssignment) { a.PresentationRevision++ }, want: ErrAssignmentRevisionMismatch},
		{name: "issued at", mutate: func(a *RuntimeAssignment) { a.IssuedAt = a.IssuedAt.Add(time.Second) }, want: ErrAssignmentIssuedAtMismatch},
		{name: "non-extended lease", mutate: func(a *RuntimeAssignment) {}, want: ErrLeaseNotExtended},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			renewal := current
			renewal.LeaseExpiresAt = current.LeaseExpiresAt.Add(time.Minute)
			test.mutate(&renewal)
			if test.want == ErrLeaseNotExtended {
				renewal.LeaseExpiresAt = current.LeaseExpiresAt
			}
			if err := guard.Renew(renewal); !errors.Is(err, test.want) {
				t.Errorf("Renew() error = %v, want %v", err, test.want)
			}
		})
	}

	renewal := current
	renewal.LeaseExpiresAt = current.LeaseExpiresAt.Add(time.Minute)
	if err := guard.Renew(renewal); err != nil {
		t.Fatalf("renew lease: %v", err)
	}
	deadline, err := guard.ReliableDeliveryDeadline(currentClaim())
	if err != nil {
		t.Fatalf("reliable delivery deadline after renewal: %v", err)
	}
	if !deadline.Equal(renewal.LeaseExpiresAt) {
		t.Errorf("reliable delivery deadline = %s, want %s", deadline, renewal.LeaseExpiresAt)
	}
	now = current.LeaseExpiresAt
	if err := guard.AllowCommand(currentClaim()); err != nil {
		t.Errorf("command with renewed lease: %v", err)
	}
}

func newTestGuard(t *testing.T, now *time.Time) *AssignmentGuard {
	t.Helper()
	guard, err := NewAssignmentGuard(RuntimeAssignment{
		SessionID:            "session-1",
		RuntimeID:            "runtime-1",
		RuntimeKind:          RuntimeKindCloud,
		Endpoint:             "runtime.example.test:443",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             *now,
		LeaseExpiresAt:       now.Add(time.Minute),
	}, func() time.Time { return *now })
	if err != nil {
		t.Fatalf("new assignment guard: %v", err)
	}
	return guard
}

func currentClaim() AssignmentClaim {
	return AssignmentClaim{
		SessionID:            "session-1",
		RuntimeID:            "runtime-1",
		RuntimeKind:          RuntimeKindCloud,
		AssignmentEpoch:      1,
		PresentationRevision: 1,
	}
}
