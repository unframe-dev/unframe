package runtimecore

import (
	"context"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
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
	if frame != nil {
		if frame.InputEpoch == 0 || frame.InputEpoch > s.snapshot.InputEpoch || frame.BaseReliableSequence > s.snapshot.ReliableSequence {
			return nil, nil, errV2TrackingFrame
		}
		if frame.InputEpoch < s.snapshot.InputEpoch || frame.BaseReliableSequence < s.trackingReliableFloor {
			return nil, nil, nil
		}
	}
	if frame != nil && frame.PresentationOriginVersion != s.snapshot.PresentationOrigin.Version {
		if frame.PresentationOriginVersion < s.snapshot.PresentationOrigin.Version {
			return nil, nil, nil
		}
		return nil, nil, ErrV2OriginMismatch
	}
	// Convert calibrated Quest-local poses to the shared Stage coordinates.
	if frame != nil && frame.PresentationFromQuestLocal != nil {
		if err := protocolv2.ValidateMessage(frame.PresentationFromQuestLocal); err != nil {
			return nil, nil, err
		}
		origin := s.snapshot.PresentationOrigin.Pose
		calibration, err := v2TrackingComposePose(v2TrackingInversePose(origin), &realtimev2.TrackedPoseSample{QuestLocalPose: frame.PresentationFromQuestLocal, PositionAvailable: true, RotationAvailable: true})
		if err != nil {
			return nil, nil, err
		}
		frame = proto.Clone(frame).(*realtimev2.TrackingFrame)
		frame.PresentationFromQuestLocal = calibration
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
