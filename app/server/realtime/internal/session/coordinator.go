package session

import (
	"errors"
	"sync"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

var (
	ErrForbidden          = errors.New("session command is not permitted for this role")
	ErrDuplicateMessageID = errors.New("session command message ID has already been processed")
	ErrInvalidIdentity    = errors.New("session identity is invalid")
	ErrInvalidCommand     = errors.New("session command is invalid")
	ErrParticipantActive  = errors.New("session participant is already connected")
	ErrConnectionInactive = errors.New("session connection is no longer active")
)

const (
	reliableQueueCapacity   = 64
	messageIDWindowCapacity = 1024
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

type PageChangeCommand struct {
	MessageID string
	PageIndex uint32
}

type ReliableEvent struct {
	Sequence         uint64
	CommandMessageID string
	PageIndex        uint32
}

// Connection identifies one active participant stream without exposing
// transport-specific state to the session coordinator.
type Connection struct {
	identity       Identity
	events         chan ReliableEvent
	overflowed     chan struct{}
	disconnectOnce sync.Once
}

func (c *Connection) Events() <-chan ReliableEvent {
	return c.events
}

// Overflowed is closed when the reliable event queue fills before the
// connection can consume an event.
func (c *Connection) Overflowed() <-chan struct{} {
	return c.overflowed
}

// Coordinator owns transient, session-local canonical state and is independent
// of gRPC and generated protocol types.
type Coordinator struct {
	mu       sync.Mutex
	sessions map[string]*activeSession
}

type activeSession struct {
	nextSequence uint64
	participants map[string]*Connection
	messageIDs   map[string]struct{}
	messageOrder []string
}

func NewCoordinator() *Coordinator {
	return &Coordinator{sessions: make(map[string]*activeSession)}
}

func (c *Coordinator) Connect(identity Identity) (*Connection, error) {
	if !validIdentity(identity) {
		return nil, ErrInvalidIdentity
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	state := c.sessions[identity.SessionID]
	if state == nil {
		state = &activeSession{
			participants: make(map[string]*Connection),
			messageIDs:   make(map[string]struct{}),
		}
		c.sessions[identity.SessionID] = state
	}
	if _, connected := state.participants[identity.ParticipantID]; connected {
		return nil, ErrParticipantActive
	}

	connection := &Connection{
		identity:   identity,
		events:     make(chan ReliableEvent, reliableQueueCapacity),
		overflowed: make(chan struct{}),
	}
	state.participants[identity.ParticipantID] = connection
	return connection, nil
}

func (c *Coordinator) ChangePage(connection *Connection, command PageChangeCommand) (ReliableEvent, error) {
	if connection == nil || command.MessageID == "" {
		return ReliableEvent{}, ErrInvalidCommand
	}
	identity := connection.identity
	if identity.Role != RolePresenter {
		return ReliableEvent{}, ErrForbidden
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	state := c.sessions[identity.SessionID]
	if state == nil || state.participants[identity.ParticipantID] != connection {
		return ReliableEvent{}, ErrConnectionInactive
	}
	if _, exists := state.messageIDs[command.MessageID]; exists {
		return ReliableEvent{}, ErrDuplicateMessageID
	}
	state.messageIDs[command.MessageID] = struct{}{}
	state.messageOrder = append(state.messageOrder, command.MessageID)
	if len(state.messageOrder) > messageIDWindowCapacity {
		expired := state.messageOrder[0]
		delete(state.messageIDs, expired)
		state.messageOrder = state.messageOrder[1:]
	}
	state.nextSequence++
	event := ReliableEvent{
		Sequence:         state.nextSequence,
		CommandMessageID: command.MessageID,
		PageIndex:        command.PageIndex,
	}
	for participantID, recipient := range state.participants {
		select {
		case recipient.events <- event:
		default:
			c.disconnectLocked(state, participantID, recipient, true)
		}
	}
	if len(state.participants) == 0 {
		delete(c.sessions, identity.SessionID)
	}
	return event, nil
}

func (c *Coordinator) Disconnect(connection *Connection) {
	if connection == nil {
		return
	}
	connection.disconnectOnce.Do(func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		identity := connection.identity
		state := c.sessions[identity.SessionID]
		if state == nil || state.participants[identity.ParticipantID] != connection {
			return
		}
		c.disconnectLocked(state, identity.ParticipantID, connection, false)
		if len(state.participants) == 0 {
			delete(c.sessions, identity.SessionID)
		}
	})
}

func (c *Coordinator) disconnectLocked(state *activeSession, participantID string, connection *Connection, overflow bool) {
	delete(state.participants, participantID)
	if overflow {
		close(connection.overflowed)
	}
	close(connection.events)
}

func validIdentity(identity Identity) bool {
	return identity.SessionID != "" && identity.ParticipantID != "" && (identity.Role == RolePresenter || identity.Role == RoleViewer)
}
