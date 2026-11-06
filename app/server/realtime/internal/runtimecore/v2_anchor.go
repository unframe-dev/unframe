package runtimecore

import (
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func (s *V2Session) anchorTrackingSample(node v2Node) (v2PresentedTrackingSample, bool, error) {
	var target realtimev2.TrackedTarget
	switch node.Parent.Target {
	case "head":
		target = realtimev2.TrackedTarget_TRACKED_TARGET_HEAD
	case "leftHand":
		target = realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND
	case "rightHand":
		target = realtimev2.TrackedTarget_TRACKED_TARGET_RIGHT_HAND
	case "body":
		target = realtimev2.TrackedTarget_TRACKED_TARGET_BODY
	default:
		return v2PresentedTrackingSample{}, false, ErrV2RuntimeDefinition
	}
	sample, found := s.tracking.lastSamples[target]
	available := found && sample.OriginVersion == s.snapshot.PresentationOrigin.Version && (!node.Parent.FollowPosition || sample.PositionAvailable) && (!node.Parent.FollowRotation || sample.RotationAvailable)
	return sample, available, nil
}
