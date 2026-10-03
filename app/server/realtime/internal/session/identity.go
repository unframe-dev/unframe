package session

import (
	"errors"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

var (
	ErrInvalidIdentity   = errors.New("session identity is invalid")
	ErrParticipantActive = errors.New("session participant is already connected")
)

type Role uint8

const (
	RoleUnknown Role = iota
	RolePresenter
	RoleViewer
)

type Identity struct {
	SessionID            string
	ParticipantID        string
	Role                 Role
	RuntimeID            string
	RuntimeKind          assignment.RuntimeKind
	AssignmentEpoch      uint64
	PresentationID       string
	PresentationRevision uint64
	ProtocolVersion      uint64
}
