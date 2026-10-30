package runtimecore

import (
	"context"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

const roomIdleTimeout = 10 * time.Minute

// Caller holds operationMu and mu. Presence deadlines use wall time even while playback is paused.
func (s *V2Session) expireIdleLocked(ctx context.Context, now time.Time) (bool, error) {
	if s.snapshot.Clock.GetTerminating() != nil {
		return true, nil
	}
	if s.durability.completing {
		return true, nil
	}
	if !s.pendingEmptySince.IsZero() {
		previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
		s.emptySince = s.pendingEmptySince
		if err := s.commitV2MutationVisible(ctx, previous, nil, previous); err != nil {
			return false, err
		}
		s.pendingEmptySince = time.Time{}
	}
	if len(s.presence) != 0 || s.emptySince.IsZero() || now.Before(s.emptySince.Add(roomIdleTimeout)) {
		return false, nil
	}
	if s.completionWriter == nil || s.checkpointMetadata == nil {
		return false, ErrV2PersistenceUnavailable
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	events, err := s.prepareV2Termination(nil, realtimev2.TerminationReason_TERMINATION_REASON_IDLE_TIMEOUT)
	if err != nil {
		s.rollbackV2Fault(previous, realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION)
		return false, err
	}
	if err := s.commitV2Completion(ctx, previous, events); err != nil {
		return false, err
	}
	return true, nil
}

// DurablyEnded becomes true only after the Control Plane accepted the final checkpoint and release.
func (s *V2Session) DurablyEnded() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.durability.completing && s.durability.completion == nil && s.snapshot.Clock.GetTerminating() != nil
}
