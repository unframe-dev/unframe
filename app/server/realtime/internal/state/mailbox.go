// Package state contains transport-independent latest-wins Element State data structures.
package state

import (
	"errors"
	"sort"
	"sync"
	"time"
)

var ErrInvalidElementChange = errors.New("element state change is invalid")

type ChangedFields uint16

const (
	FieldPosition ChangedFields = 1 << iota
	FieldRotation
	FieldScale
	FieldActive
	FieldVisible
	FieldAnimationState
	FieldPlaybackPosition
)

const allChangedFields = FieldPosition | FieldRotation | FieldScale | FieldActive | FieldVisible | FieldAnimationState | FieldPlaybackPosition

type Vector3 struct {
	X float32
	Y float32
	Z float32
}

type Quaternion struct {
	X float32
	Y float32
	Z float32
	W float32
}

type ElementChange struct {
	ElementID        string
	Changed          ChangedFields
	Position         Vector3
	Rotation         Quaternion
	Scale            Vector3
	Active           bool
	Visible          bool
	AnimationState   string
	PlaybackPosition float64
}

type Frame struct {
	FrameSequence             uint64
	ProducedAt                time.Time
	OldestChangeAt            time.Time
	PresentationOriginVersion uint64
	BaseReliableSequence      uint64
	Elements                  []ElementChange
}

type Mailbox struct {
	mu             sync.Mutex
	oldestChangeAt time.Time
	pending        map[string]ElementChange
}

func NewMailbox() *Mailbox {
	return &Mailbox{pending: make(map[string]ElementChange)}
}

func (m *Mailbox) Merge(changedAt time.Time, changes []ElementChange) error {
	if changedAt.IsZero() {
		return ErrInvalidElementChange
	}
	for _, change := range changes {
		if change.ElementID == "" || change.Changed == 0 || change.Changed&^allChangedFields != 0 {
			return ErrInvalidElementChange
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if len(changes) > 0 && (m.oldestChangeAt.IsZero() || changedAt.Before(m.oldestChangeAt)) {
		m.oldestChangeAt = changedAt
	}
	for _, change := range changes {
		current := m.pending[change.ElementID]
		current.ElementID = change.ElementID
		if change.Changed&FieldPosition != 0 {
			current.Position = change.Position
		}
		if change.Changed&FieldRotation != 0 {
			current.Rotation = change.Rotation
		}
		if change.Changed&FieldScale != 0 {
			current.Scale = change.Scale
		}
		if change.Changed&FieldActive != 0 {
			current.Active = change.Active
		}
		if change.Changed&FieldVisible != 0 {
			current.Visible = change.Visible
		}
		if change.Changed&FieldAnimationState != 0 {
			current.AnimationState = change.AnimationState
		}
		if change.Changed&FieldPlaybackPosition != 0 {
			current.PlaybackPosition = change.PlaybackPosition
		}
		current.Changed |= change.Changed
		m.pending[change.ElementID] = current
	}
	return nil
}

func (m *Mailbox) Take(frameSequence uint64, producedAt time.Time, baseReliableSequence uint64, presentationOriginVersion uint64) (Frame, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.pending) == 0 {
		return Frame{}, false
	}
	ids := make([]string, 0, len(m.pending))
	for id := range m.pending {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	elements := make([]ElementChange, 0, len(ids))
	for _, id := range ids {
		elements = append(elements, m.pending[id])
	}
	frame := Frame{
		FrameSequence:             frameSequence,
		ProducedAt:                producedAt,
		OldestChangeAt:            m.oldestChangeAt,
		PresentationOriginVersion: presentationOriginVersion,
		BaseReliableSequence:      baseReliableSequence,
		Elements:                  elements,
	}
	m.pending = make(map[string]ElementChange)
	m.oldestChangeAt = time.Time{}
	return frame, true
}

func (m *Mailbox) OldestChangeAt() (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.oldestChangeAt, !m.oldestChangeAt.IsZero()
}
