package edge

import (
	"errors"
	"testing"
	"time"
)

func TestEdgeSessionAssignmentValidateRequiresEveryField(t *testing.T) {
	t.Parallel()

	issuedAt := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	valid := EdgeSessionAssignment{
		SessionID:            "session-1",
		EdgeID:               "edge-1",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             issuedAt,
		LeaseExpiresAt:       issuedAt.Add(time.Minute),
	}

	tests := []struct {
		name       string
		assignment EdgeSessionAssignment
	}{
		{name: "session ID", assignment: EdgeSessionAssignment{EdgeID: valid.EdgeID, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "edge ID", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "assignment epoch", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, EdgeID: valid.EdgeID, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "presentation revision", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, EdgeID: valid.EdgeID, AssignmentEpoch: valid.AssignmentEpoch, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "issued at", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, EdgeID: valid.EdgeID, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, LeaseExpiresAt: valid.LeaseExpiresAt}},
		{name: "lease expires at", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, EdgeID: valid.EdgeID, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt}},
		{name: "lease expires before issue", assignment: EdgeSessionAssignment{SessionID: valid.SessionID, EdgeID: valid.EdgeID, AssignmentEpoch: valid.AssignmentEpoch, PresentationRevision: valid.PresentationRevision, IssuedAt: valid.IssuedAt, LeaseExpiresAt: valid.IssuedAt}},
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

func TestAssignmentGuardRejectsWrongCurrentEdgeOrEpoch(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)

	claim := AssignmentClaim{SessionID: "session-1", EdgeID: "edge-1", AssignmentEpoch: 1, PresentationRevision: 1}
	wrongEdge := claim
	wrongEdge.EdgeID = "other-edge"
	if err := guard.ValidateCurrent(wrongEdge); !errors.Is(err, ErrAssignmentEdgeMismatch) {
		t.Errorf("wrong edge error = %v, want %v", err, ErrAssignmentEdgeMismatch)
	}
	wrongEpoch := claim
	wrongEpoch.AssignmentEpoch = 2
	if err := guard.ValidateCurrent(wrongEpoch); !errors.Is(err, ErrAssignmentEpochMismatch) {
		t.Errorf("wrong epoch error = %v, want %v", err, ErrAssignmentEpochMismatch)
	}
	if err := guard.ValidateCurrent(claim); err != nil {
		t.Errorf("validate current assignment: %v", err)
	}
}

func TestAssignmentGuardRejectsWrongSessionOrPresentationRevision(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	claim := AssignmentClaim{SessionID: "session-1", EdgeID: "edge-1", AssignmentEpoch: 1, PresentationRevision: 1}
	wrongSession := claim
	wrongSession.SessionID = "session-2"
	if err := guard.AllowNewConnection(wrongSession); !errors.Is(err, ErrAssignmentSessionMismatch) {
		t.Errorf("wrong session error = %v, want %v", err, ErrAssignmentSessionMismatch)
	}
	wrongRevision := claim
	wrongRevision.PresentationRevision = 2
	if err := guard.AllowCommand(wrongRevision); !errors.Is(err, ErrAssignmentRevisionMismatch) {
		t.Errorf("wrong revision error = %v, want %v", err, ErrAssignmentRevisionMismatch)
	}
}

func TestAssignmentGuardRejectsEveryProtectedOperationAfterLeaseExpiry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	now = now.Add(time.Minute)

	operations := map[string]func(AssignmentClaim) error{
		"new connection": guard.AllowNewConnection,
		"command":        guard.AllowCommand,
		"state update":   guard.AllowStateUpdate,
		"checkpoint":     guard.AllowCheckpoint,
	}
	claim := AssignmentClaim{SessionID: "session-1", EdgeID: "edge-1", AssignmentEpoch: 1, PresentationRevision: 1}
	if _, err := guard.ReliableDeliveryDeadline(claim); !errors.Is(err, ErrLeaseExpired) {
		t.Errorf("reliable delivery deadline error = %v, want %v", err, ErrLeaseExpired)
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			if err := operation(claim); !errors.Is(err, ErrLeaseExpired) {
				t.Errorf("operation error = %v, want %v", err, ErrLeaseExpired)
			}
		})
	}
}

func TestAssignmentGuardRenewsLeaseOnlyMonotonicallyForCurrentAssignment(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	guard := newTestGuard(t, &now)
	current := guard.Assignment()

	notExtended := current
	notExtended.IssuedAt = now.Add(10 * time.Second)
	if err := guard.Renew(notExtended); !errors.Is(err, ErrLeaseNotExtended) {
		t.Errorf("non-extended renewal error = %v, want %v", err, ErrLeaseNotExtended)
	}

	wrongEpoch := current
	wrongEpoch.AssignmentEpoch++
	wrongEpoch.IssuedAt = now.Add(10 * time.Second)
	wrongEpoch.LeaseExpiresAt = current.LeaseExpiresAt.Add(time.Minute)
	if err := guard.Renew(wrongEpoch); !errors.Is(err, ErrAssignmentEpochMismatch) {
		t.Errorf("wrong epoch renewal error = %v, want %v", err, ErrAssignmentEpochMismatch)
	}

	wrongRevision := current
	wrongRevision.PresentationRevision++
	wrongRevision.IssuedAt = now.Add(10 * time.Second)
	wrongRevision.LeaseExpiresAt = current.LeaseExpiresAt.Add(time.Minute)
	if err := guard.Renew(wrongRevision); !errors.Is(err, ErrAssignmentRevisionMismatch) {
		t.Errorf("wrong revision renewal error = %v, want %v", err, ErrAssignmentRevisionMismatch)
	}

	renewal := current
	renewal.IssuedAt = now.Add(10 * time.Second)
	renewal.LeaseExpiresAt = current.LeaseExpiresAt.Add(time.Minute)
	if err := guard.Renew(renewal); err != nil {
		t.Fatalf("renew lease: %v", err)
	}
	deadline, err := guard.ReliableDeliveryDeadline(AssignmentClaim{SessionID: "session-1", EdgeID: "edge-1", AssignmentEpoch: 1, PresentationRevision: 1})
	if err != nil {
		t.Fatalf("reliable delivery deadline after renewal: %v", err)
	}
	if !deadline.Equal(renewal.LeaseExpiresAt) {
		t.Errorf("reliable delivery deadline = %s, want %s", deadline, renewal.LeaseExpiresAt)
	}
	now = current.LeaseExpiresAt
	if err := guard.AllowCommand(AssignmentClaim{SessionID: "session-1", EdgeID: "edge-1", AssignmentEpoch: 1, PresentationRevision: 1}); err != nil {
		t.Errorf("command with renewed lease: %v", err)
	}
}

func newTestGuard(t *testing.T, now *time.Time) *AssignmentGuard {
	t.Helper()
	assignment := EdgeSessionAssignment{
		SessionID:            "session-1",
		EdgeID:               "edge-1",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             *now,
		LeaseExpiresAt:       now.Add(time.Minute),
	}
	guard, err := NewAssignmentGuard(assignment, func() time.Time { return *now })
	if err != nil {
		t.Fatalf("new assignment guard: %v", err)
	}
	return guard
}
