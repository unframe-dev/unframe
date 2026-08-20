// Package assignment contains placement-independent runtime assignment and lease rules.
package assignment

import (
	"errors"
	"sync"
	"time"
)

var (
	ErrInvalidAssignment             = errors.New("runtime assignment is invalid")
	ErrAssignmentSessionMismatch     = errors.New("runtime assignment session does not match")
	ErrAssignmentRuntimeIDMismatch   = errors.New("runtime assignment runtime ID does not match")
	ErrAssignmentRuntimeKindMismatch = errors.New("runtime assignment runtime kind does not match")
	ErrAssignmentEndpointMismatch    = errors.New("runtime assignment endpoint does not match")
	ErrAssignmentEpochMismatch       = errors.New("runtime assignment epoch does not match")
	ErrAssignmentRevisionMismatch    = errors.New("runtime assignment presentation revision does not match")
	ErrAssignmentIssuedAtMismatch    = errors.New("runtime assignment issue time does not match")
	ErrLeaseExpired                  = errors.New("runtime assignment lease has expired")
	ErrLeaseNotExtended              = errors.New("runtime assignment lease renewal does not extend expiry")
)

// RuntimeKind identifies the deployment profile selected for a runtime.
type RuntimeKind string

const (
	RuntimeKindCloud     RuntimeKind = "Cloud"
	RuntimeKindVenueEdge RuntimeKind = "VenueEdge"
)

// Clock supplies the current time. It permits deterministic lease tests and
// lets runtime wiring choose its clock explicitly.
type Clock func() time.Time

// RuntimeAssignment binds one session revision to a runtime instance for one
// fencing epoch until LeaseExpiresAt.
type RuntimeAssignment struct {
	SessionID            string
	RuntimeID            string
	RuntimeKind          RuntimeKind
	Endpoint             string
	AssignmentEpoch      uint64
	PresentationRevision uint64
	IssuedAt             time.Time
	LeaseExpiresAt       time.Time
}

// AssignmentClaim is the assignment-bound subset of a verified participant
// credential required at every runtime operation boundary.
type AssignmentClaim struct {
	SessionID            string
	RuntimeID            string
	RuntimeKind          RuntimeKind
	AssignmentEpoch      uint64
	PresentationRevision uint64
}

func (a RuntimeAssignment) Validate() error {
	if a.SessionID == "" || a.RuntimeID == "" || !a.RuntimeKind.valid() || a.Endpoint == "" || a.AssignmentEpoch == 0 || a.PresentationRevision == 0 || a.IssuedAt.IsZero() || a.LeaseExpiresAt.IsZero() || !a.LeaseExpiresAt.After(a.IssuedAt) {
		return ErrInvalidAssignment
	}
	return nil
}

func (k RuntimeKind) valid() bool {
	return k == RuntimeKindCloud || k == RuntimeKindVenueEdge
}

// AssignmentGuard authorizes runtime operations against one local assignment.
// Renew serializes assignment replacement with authorization.
type AssignmentGuard struct {
	mu         sync.RWMutex
	assignment RuntimeAssignment
	clock      Clock
}

func NewAssignmentGuard(assignment RuntimeAssignment, clock Clock) (*AssignmentGuard, error) {
	if err := assignment.Validate(); err != nil {
		return nil, err
	}
	if clock == nil {
		clock = time.Now
	}
	return &AssignmentGuard{assignment: assignment, clock: clock}, nil
}

// Assignment returns the current assignment snapshot.
func (g *AssignmentGuard) Assignment() RuntimeAssignment {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.assignment
}

// ValidateCurrent verifies that the request is for this runtime's current
// fencing epoch and that its lease has not expired.
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

// ReliableDeliveryDeadline returns the current lease boundary atomically with
// assignment validation so transport sends cannot use a superseded lease.
func (g *AssignmentGuard) ReliableDeliveryDeadline(claim AssignmentClaim) (time.Time, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if err := g.validateCurrentLocked(claim); err != nil {
		return time.Time{}, err
	}
	return g.assignment.LeaseExpiresAt, nil
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
func (g *AssignmentGuard) Renew(renewal RuntimeAssignment) error {
	if err := renewal.Validate(); err != nil {
		return err
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	current := g.assignment
	if renewal.SessionID != current.SessionID {
		return ErrAssignmentSessionMismatch
	}
	if renewal.RuntimeID != current.RuntimeID {
		return ErrAssignmentRuntimeIDMismatch
	}
	if renewal.RuntimeKind != current.RuntimeKind {
		return ErrAssignmentRuntimeKindMismatch
	}
	if renewal.Endpoint != current.Endpoint {
		return ErrAssignmentEndpointMismatch
	}
	if renewal.AssignmentEpoch != current.AssignmentEpoch {
		return ErrAssignmentEpochMismatch
	}
	if renewal.PresentationRevision != current.PresentationRevision {
		return ErrAssignmentRevisionMismatch
	}
	if !renewal.IssuedAt.Equal(current.IssuedAt) {
		return ErrAssignmentIssuedAtMismatch
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
	if claim.RuntimeID != g.assignment.RuntimeID {
		return ErrAssignmentRuntimeIDMismatch
	}
	if claim.RuntimeKind != g.assignment.RuntimeKind {
		return ErrAssignmentRuntimeKindMismatch
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
