package runtimecore

import (
	"context"
	"encoding/hex"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocol "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) PresentationOrigin(ctx context.Context, identity session.Identity, command *realtime.PresentationOriginCommand) (*realtime.CommandOutcome, []*realtime.ProjectedReliableEvent, error) {
	if err := protocol.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
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
	poseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command.Pose)
	if err != nil {
		return nil, nil, err
	}
	key := identity.ParticipantID + "\x00" + command.ClientEventId
	fingerprint := v3Fingerprint("presentation_origin", command.ClientEventId, command.CommandEpoch, command.ExpectedPresentationOriginVersion, nil, []string{hex.EncodeToString(poseBytes)}, 0, nil)
	// A successful retry retains its original expected version after the origin advances.
	if stored, ok := s.outcomes[key]; ok {
		if stored.fingerprint != fingerprint {
			return nil, nil, ErrV2IdempotencyKeyReused
		}
		return proto.Clone(stored.outcome).(*realtime.CommandOutcome), nil, nil
	}
	if command.ExpectedPresentationOriginVersion != s.snapshot.PresentationOrigin.Version {
		return nil, nil, ErrV2OriginMismatch
	}
	if command.CommandEpoch > s.commandEpoch {
		return nil, nil, ErrV3CommandEpochFuture
	}
	if rejection := s.admitV3Command(command.ClientEventId, command.CommandEpoch, false, nil); rejection != 0 {
		return v3Rejected(command.ClientEventId, rejection), nil, nil
	}
	if s.snapshot.Clock.GetTerminating() != nil {
		return v3Rejected(command.ClientEventId, realtime.CommandRejectionReason_COMMAND_REJECTION_REASON_SESSION_ENDED), nil, nil
	}
	if s.snapshot.PresentationOrigin.Version == ^uint64(0) {
		return nil, nil, ErrV2RuntimeDefinition
	}
	previous := proto.Clone(s.snapshot).(*realtime.CanonicalRuntimeSnapshot)
	for _, frozen := range s.snapshot.FrozenAnchors {
		pose := &presentation.Pose{Position: &presentation.Vector3{}, Rotation: &presentation.Quaternion{W: 1}}
		if frozen.Position != nil {
			pose.Position = frozen.Position
		}
		if frozen.Rotation != nil {
			pose.Rotation = frozen.Rotation
		}
		marker, err := v2TrackingComposePose(previous.PresentationOrigin.Pose, &realtime.TrackedPoseSample{QuestLocalPose: pose, PositionAvailable: frozen.Position != nil, RotationAvailable: frozen.Rotation != nil})
		if err != nil {
			s.snapshot = previous
			return nil, nil, err
		}
		rebased, err := v2TrackingComposePose(v2TrackingInversePose(command.Pose), &realtime.TrackedPoseSample{QuestLocalPose: marker, PositionAvailable: frozen.Position != nil, RotationAvailable: frozen.Rotation != nil})
		if err != nil {
			s.snapshot = previous
			return nil, nil, err
		}
		if frozen.Position != nil {
			frozen.Position = rebased.Position
		}
		if frozen.Rotation != nil {
			frozen.Rotation = rebased.Rotation
		}
	}
	s.snapshot.PresentationOrigin = &realtime.PresentationOrigin{Version: previous.PresentationOrigin.Version + 1, Pose: proto.Clone(command.Pose).(*presentation.Pose)}
	event := s.nextEvent(&realtime.ProjectedReliableEvent{Payload: &realtime.ProjectedReliableEvent_PresentationOriginChanged{PresentationOriginChanged: &realtime.PresentationOriginChanged{Origin: proto.Clone(s.snapshot.PresentationOrigin).(*realtime.PresentationOrigin)}}})
	outcome := &realtime.CommandOutcome{ClientEventId: command.ClientEventId, Result: &realtime.CommandOutcome_Accepted{Accepted: &realtime.CommandAccepted{CanonicalEventId: event.EventId, ReliableSequence: event.Sequence}}}
	if err := s.requireV3Synchronization(realtime.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED, false); err != nil {
		s.snapshot = previous
		return nil, nil, err
	}
	s.rememberOutcome(key, fingerprint, outcome)
	events := []*realtime.ProjectedReliableEvent{event}
	if len(s.snapshot.FrozenAnchors) != 0 {
		replacement := s.nextEvent(&realtime.ProjectedReliableEvent{})
		replacement.Payload = &realtime.ProjectedReliableEvent_RuntimeViewReplaced{RuntimeViewReplaced: &realtime.RuntimeViewReplaced{RuntimeView: s.canonicalV3RuntimeView()}}
		events = append(events, replacement)
	}
	if err := s.commitV2Mutation(ctx, previous, &events); err != nil {
		return nil, nil, err
	}
	return proto.Clone(outcome).(*realtime.CommandOutcome), cloneV2Events(events), nil
}
