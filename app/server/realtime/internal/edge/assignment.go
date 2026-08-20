// Package edge contains Venue Edge assignment and lease domain rules.
package edge

import (
	"errors"
	"sync"
	"time"
)

var (
	ErrInvalidAssignment          = errors.New("edge session assignment is invalid")
	ErrAssignmentSessionMismatch  = errors.New("edge session assignment session does not match")
	ErrAssignmentEdgeMismatch     = errors.New("edge session assignment edge does not match")
	ErrAssignmentEpochMismatch    = errors.New("edge session assignment epoch does not match")
	ErrAssignmentRevisionMismatch = errors.New("edge session assignment presentation revision does not match")
	ErrLeaseExpired               = errors.New("edge session assignment lease has expired")
	ErrLeaseNotExtended           = errors.New("edge session assignment lease renewal does not extend expiry")
)

// Clock supplies the current time. It permits deterministic lease tests and
// lets runtime wiring choose its clock explicitly.
type Clock func() time.Time

// EdgeSessionAssignment binds one session revision to an Edge for one fencing
// epoch until LeaseExpiresAt.
type EdgeSessionAssignment struct {
	SessionID            string
	EdgeID               string
	AssignmentEpoch      uint64
	PresentationRevision uint64
	IssuedAt             time.Time
	LeaseExpiresAt       time.Time
}

// AssignmentClaim is the assignment-bound subset of a verified participant
// credential required at every runtime operation boundary.
type AssignmentClaim struct {
	SessionID            string
	EdgeID               string
	AssignmentEpoch      uint64
	PresentationRevision uint64
}

func (a EdgeSessionAssignment) Validate() error {
	if a.SessionID == "" || a.EdgeID == "" || a.AssignmentEpoch == 0 || a.PresentationRevision == 0 || a.IssuedAt.IsZero() || a.LeaseExpiresAt.IsZero() || !a.LeaseExpiresAt.After(a.IssuedAt) {
		return ErrInvalidAssignment
	}
	return nil
}

// AssignmentGuard authorizes Edge runtime operations against one local
// assignment. Renew serializes assignment replacement with authorization.
type AssignmentGuard struct {
	mu         sync.RWMutex
	assignment EdgeSessionAssignment
	clock      Clock
}

func NewAssignmentGuard(assignment EdgeSessionAssignment, clock Clock) (*AssignmentGuard, error) {
	if err := assignment.Validate(); err != nil {
		return nil, err
	}
	if clock == nil {
		clock = time.Now
	}
	return &AssignmentGuard{assignment: assignment, clock: clock}, nil
}

// Assignment returns the current assignment snapshot.
func (g *AssignmentGuard) Assignment() EdgeSessionAssignment {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.assignment
}

// ValidateCurrent verifies that the request is for this Edge's current fencing
// epoch and that its lease has not expired.
func (g *AssignmentGuard) ValidateCurrent(claim AssignmentClaim) error {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.validateCurrentLocked(claim)
}

// AllowNewConnection authorizes a new participant connection.
func (g *AssignmentGuard) AllowNewConnection(claim AssignmentClaim) error {
	return g.ValidateCurrent(claim)
}

// AllowCommand authorizes a reliable runtime command.
func (g *AssignmentGuard) AllowCommand(claim AssignmentClaim) error {
	return g.ValidateCurrent(claim)
}

// AllowReliableDelivery prevents pre-expiry events queued for a slow
// connection from crossing the lease boundary.
func (g *AssignmentGuard) AllowReliableDelivery(claim AssignmentClaim) error {
	return g.ValidateCurrent(claim)
}

// AllowStateUpdate authorizes a state update from the current runtime.
func (g *AssignmentGuard) AllowStateUpdate(claim AssignmentClaim) error {
	return g.ValidateCurrent(claim)
}

// AllowCheckpoint authorizes a checkpoint sent to the Control Plane.
func (g *AssignmentGuard) AllowCheckpoint(claim AssignmentClaim) error {
	return g.ValidateCurrent(claim)
}

// Renew replaces the local lease only when it is for the same immutable
// assignment identity and extends the prior expiry.
func (g *AssignmentGuard) Renew(renewal EdgeSessionAssignment) error {
	if err := renewal.Validate(); err != nil {
		return err
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	current := g.assignment
	if renewal.SessionID != current.SessionID {
		return ErrAssignmentSessionMismatch
	}
	if renewal.EdgeID != current.EdgeID {
		return ErrAssignmentEdgeMismatch
	}
	if renewal.AssignmentEpoch != current.AssignmentEpoch {
		return ErrAssignmentEpochMismatch
	}
	if renewal.PresentationRevision != current.PresentationRevision {
		return ErrAssignmentRevisionMismatch
	}
	if !renewal.LeaseExpiresAt.After(current.LeaseExpiresAt) {
		return ErrLeaseNotExtended
	}
	g.assignment = renewal
	return nil
}

func (g *AssignmentGuard) validateCurrentLocked(claim AssignmentClaim) error {
	if claim.SessionID != g.assignment.SessionID {
		return ErrAssignmentSessionMismatch
	}
	if claim.EdgeID != g.assignment.EdgeID {
		return ErrAssignmentEdgeMismatch
	}
	if claim.AssignmentEpoch != g.assignment.AssignmentEpoch {
		return ErrAssignmentEpochMismatch
	}
	if claim.PresentationRevision != g.assignment.PresentationRevision {
		return ErrAssignmentRevisionMismatch
	}
	if !g.clock().Before(g.assignment.LeaseExpiresAt) {
		return ErrLeaseExpired
	}
	return nil
}
