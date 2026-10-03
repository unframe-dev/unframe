package session

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"sync"
	"time"
)

const StateNonceLifetime = 30 * time.Second

var ErrStateNonceInvalid = errors.New("state connection nonce is invalid")

type stateNonce struct {
	participantID string
	value         [32]byte
	expiresAt     time.Time
}

// StateNonceManager binds a one-use State stream credential to its Control
// connection and authenticated participant.
type StateNonceManager struct {
	mu      sync.Mutex
	clock   func() time.Time
	pending map[string]stateNonce
}

func NewStateNonceManager(clock func() time.Time) *StateNonceManager {
	if clock == nil {
		clock = time.Now
	}
	return &StateNonceManager{clock: clock, pending: make(map[string]stateNonce)}
}

func (m *StateNonceManager) Issue(connectionID, participantID string) ([]byte, error) {
	if connectionID == "" || participantID == "" {
		return nil, ErrStateNonceInvalid
	}
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.clock()
	for id, pending := range m.pending {
		if !now.Before(pending.expiresAt) {
			delete(m.pending, id)
		}
	}
	m.pending[connectionID] = stateNonce{participantID: participantID, value: value, expiresAt: now.Add(StateNonceLifetime)}
	return value[:], nil
}

func (m *StateNonceManager) Consume(connectionID, participantID string, value []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, found := m.pending[connectionID]
	if !found || participantID != pending.participantID || len(value) != len(pending.value) || !m.clock().Before(pending.expiresAt) || subtle.ConstantTimeCompare(value, pending.value[:]) != 1 {
		return ErrStateNonceInvalid
	}
	delete(m.pending, connectionID)
	return nil
}

func (m *StateNonceManager) Revoke(connectionID string) {
	m.mu.Lock()
	delete(m.pending, connectionID)
	m.mu.Unlock()
}
