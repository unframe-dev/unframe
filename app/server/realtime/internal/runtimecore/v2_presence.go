package runtimecore

import (
	"context"
	"sort"
	"sync"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

type v2Subscription struct {
	sizes []int
	bytes int
}

// A channel consumer does not hold the session lock. Its length lets the sole
// producer reclaim charges conservatively without moving queued events.
func (q *v2Subscription) discardConsumed(remaining int) {
	consumed := len(q.sizes) - remaining
	for _, size := range q.sizes[:consumed] {
		q.bytes -= size
	}
	q.sizes = q.sizes[consumed:]
}

func (s *V2Session) JoinParticipant(ctx context.Context, identity session.Identity) error {
	if identity.ParticipantID == "" || (identity.Role != session.RolePresenter && identity.Role != session.RoleViewer) {
		return session.ErrInvalidIdentity
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetTerminating() != nil {
		return ErrV2RuntimeDefinition
	}
	if _, exists := s.presence[identity.ParticipantID]; exists {
		return session.ErrParticipantActive
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	event := s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_ParticipantPresenceChanged{ParticipantPresenceChanged: &realtimev2.ParticipantPresenceChanged{ParticipantId: identity.ParticipantID, Role: v2SessionRole(identity.Role), Connected: true}}})
	s.participants[identity.ParticipantID] = identity.Role
	if err := s.commitV2Mutation(ctx, previous, []*realtimev2.ProjectedReliableEvent{event}); err != nil {
		return err
	}
	s.presence[identity.ParticipantID] = identity.Role
	return nil
}

func (s *V2Session) PauseLeaseExpired() {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetRunning() == nil {
		return
	}
	s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED}}
	s.lastTick = time.Now()
}

func (s *V2Session) LeaveParticipant(ctx context.Context, identity session.Identity) error {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	role, exists := s.presence[identity.ParticipantID]
	if !exists {
		return nil
	}
	if paused := s.snapshot.Clock.GetPaused(); paused != nil && (paused.Reason == realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED || paused.Reason == realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION) {
		delete(s.presence, identity.ParticipantID)
		return nil
	}
	if s.snapshot.Clock.GetTerminating() != nil {
		delete(s.presence, identity.ParticipantID)
		return nil
	}
	defer delete(s.presence, identity.ParticipantID)
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	events := []*realtimev2.ProjectedReliableEvent{s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_ParticipantPresenceChanged{ParticipantPresenceChanged: &realtimev2.ParticipantPresenceChanged{ParticipantId: identity.ParticipantID, Role: v2SessionRole(role), Connected: false}}})}
	pausePresenter := role == session.RolePresenter && s.snapshot.Clock.GetRunning() != nil
	if pausePresenter {
		s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PRESENTER_DISCONNECTED}}
		events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PRESENTER_DISCONNECTED}}}}}))
	}
	if err := s.commitV2Mutation(ctx, previous, events); err != nil {
		return err
	}
	delete(s.presence, identity.ParticipantID)
	if pausePresenter {
		s.lastTick = time.Now()
	}
	return nil
}

func (s *V2Session) SnapshotPresenceAndSubscribe() (*realtimev2.CanonicalRuntimeSnapshot, *realtimev2.ProjectedPresenceState, <-chan *realtimev2.ProjectedReliableEvent, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := make(chan *realtimev2.ProjectedReliableEvent, 1024)
	s.subscribers[stream] = &v2Subscription{}
	snapshot := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	presence := &realtimev2.ProjectedPresenceState{}
	for participantID, role := range s.presence {
		presence.Participants = append(presence.Participants, &realtimev2.ProjectedParticipantPresence{ParticipantId: participantID, Role: v2SessionRole(role), Connected: true})
	}
	sort.Slice(presence.Participants, func(i, j int) bool {
		return presence.Participants[i].ParticipantId < presence.Participants[j].ParticipantId
	})
	var once sync.Once
	closeSubscription := func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, found := s.subscribers[stream]; found {
				delete(s.subscribers, stream)
				close(stream)
			}
		})
	}
	return snapshot, presence, stream, closeSubscription
}

func v2SessionRole(role session.Role) presentationv2.SessionRole {
	if role == session.RolePresenter {
		return presentationv2.SessionRole_SESSION_ROLE_PRESENTER
	}
	return presentationv2.SessionRole_SESSION_ROLE_VIEWER
}
