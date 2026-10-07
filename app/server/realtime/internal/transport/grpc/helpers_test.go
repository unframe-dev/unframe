package grpc

import (
	"context"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"time"
)

type testIdentityResolver struct{ identity session.Identity }

func (r testIdentityResolver) Resolve(context.Context) (session.Identity, error) {
	return r.identity, nil
}

type allowAllAssignment struct{}

func (allowAllAssignment) AllowNewConnection(assignment.AssignmentClaim) error { return nil }

func (allowAllAssignment) ConnectionDeadline(assignment.AssignmentClaim) (time.Time, error) {
	return time.Now().Add(time.Hour), nil
}

func (allowAllAssignment) AllowCommand(assignment.AssignmentClaim) error { return nil }

func (allowAllAssignment) ReliableDeliveryDeadline(assignment.AssignmentClaim) (time.Time, error) {
	return time.Now().Add(time.Hour), nil
}
