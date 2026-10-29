package runtimecore

import (
	"context"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"time"
)

func (s *V2Session) AcceptTracking(ctx context.Context, identity session.Identity, frame *realtimev2.TrackingFrame, receivedAt time.Time, observedAtMs uint64) ([]v2PresentedTrackingSample, []*realtimev2.ProjectedReliableEvent, error) {
	if identity.Role != session.RolePresenter {
		return nil, nil, ErrV2PresenterRequired
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.durability.completing {
		return nil, nil, ErrV2PersistenceUnavailable
	}

	if s.snapshot.Clock.GetTerminating() != nil {
		return nil, nil, ErrV2RuntimeDefinition
	}
	previousTracking := s.tracking.Clone()
	samples, _, err := s.tracking.Accept(frame, receivedAt, observedAtMs, v2TrackingDefinition{}, s.snapshot.PresentationOrigin.Version)
	if err != nil {
		return nil, nil, err
	}
	if s.snapshot.Clock.GetRunning() != nil && len(s.snapshot.FrozenAnchors) != 0 {
		previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
		changed, releaseErr := s.releaseFreshV3Anchors(receivedAt)
		if releaseErr != nil {
			s.tracking = previousTracking
			s.snapshot = previous
			return nil, nil, releaseErr
		}
		if changed {
			if err := s.commitV2Mutation(ctx, previous, nil, previousTracking); err != nil {
				s.tracking = previousTracking
				return nil, nil, err
			}
		}
	}
	return samples, nil, nil
}
