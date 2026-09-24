// Package runtimecore composes deployment-independent realtime session state.
package runtimecore

import (
	"errors"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

var ErrInvalidDependencies = errors.New("runtime core dependencies are invalid")

type Core struct {
	coordinator *session.Coordinator
	assignments *assignment.AssignmentGuard
}

func New(assignments *assignment.AssignmentGuard) (*Core, error) {
	if assignments == nil {
		return nil, ErrInvalidDependencies
	}
	return &Core{
		coordinator: session.NewCoordinator(),
		assignments: assignments,
	}, nil
}

func (c *Core) Coordinator() *session.Coordinator {
	return c.coordinator
}

func (c *Core) Assignments() *assignment.AssignmentGuard {
	return c.assignments
}

func (c *Core) Ready() error {
	current := c.assignments.Assignment()
	return c.assignments.ValidateCurrent(assignment.AssignmentClaim{
		SessionID:            current.SessionID,
		RuntimeID:            current.RuntimeID,
		RuntimeKind:          current.RuntimeKind,
		AssignmentEpoch:      current.AssignmentEpoch,
		PresentationRevision: current.PresentationRevision,
	})
}
