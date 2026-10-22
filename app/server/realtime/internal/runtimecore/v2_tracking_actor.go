package runtimecore

import (
	"context"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"time"
)

func (s *V2Session) AcceptTracking(_ context.Context, identity session.Identity, frame *realtimev2.TrackingFrame, receivedAt time.Time, observedAtMs uint64) ([]v2PresentedTrackingSample, []*realtimev2.ProjectedReliableEvent, error) {
	if identity.Role != session.RolePresenter {
		return nil, nil, ErrV2PresenterRequired
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetTerminating() != nil {
		return nil, nil, ErrV2RuntimeDefinition
	}
	samples, _, err := s.tracking.Accept(frame, receivedAt, observedAtMs, v2TrackingDefinition{}, s.snapshot.PresentationOrigin.Version)
	return samples, nil, err
}
