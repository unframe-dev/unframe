package grpc

import (
	"errors"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

// AssignmentAuthorizer verifies that an operation belongs to the Runtime's active
// assignment and is still within its lease.
type AssignmentAuthorizer interface {
	AllowNewConnection(assignment.AssignmentClaim) error
	ConnectionDeadline(assignment.AssignmentClaim) (time.Time, error)
	AllowCommand(assignment.AssignmentClaim) error
	ReliableDeliveryDeadline(assignment.AssignmentClaim) (time.Time, error)
}

func assignmentError(err error) error {
	switch {
	case errors.Is(err, assignment.ErrAssignmentSessionMismatch), errors.Is(err, assignment.ErrAssignmentRuntimeIDMismatch), errors.Is(err, assignment.ErrAssignmentRuntimeKindMismatch), errors.Is(err, assignment.ErrAssignmentEpochMismatch), errors.Is(err, assignment.ErrAssignmentRevisionMismatch):
		return status.Error(codes.PermissionDenied, "realtime assignment does not match this runtime")
	case errors.Is(err, assignment.ErrLeaseExpired):
		return status.Error(codes.FailedPrecondition, "realtime assignment lease has expired")
	default:
		return status.Error(codes.FailedPrecondition, "realtime assignment is not active")
	}
}

func assignmentClaim(identity session.Identity) assignment.AssignmentClaim {
	return assignment.AssignmentClaim{
		SessionID:            identity.SessionID,
		RuntimeID:            identity.RuntimeID,
		RuntimeKind:          identity.RuntimeKind,
		AssignmentEpoch:      identity.AssignmentEpoch,
		PresentationRevision: identity.PresentationRevision,
	}
}
