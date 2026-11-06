package runtimecore

import (
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

// ProjectedTrackedPosesAtCut returns a complete live tracking view and frozen
// display anchors for the same reliable cut as the projected runtime view.
func (s *V2Session) ProjectedTrackedPosesAtCut(targets []presentation.AnchorTarget, nodes []*realtime.NodeRuntimeState, nowMs, expectedReliableSequence uint64) ([]*realtime.ProjectedTrackedPose, []*realtime.FrozenAnchorDisplayState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.ReliableSequence != expectedReliableSequence {
		return nil, nil, ErrV3StateCutChanged
	}
	poses := make([]*realtime.ProjectedTrackedPose, 0, len(targets))
	previous := presentation.AnchorTarget_ANCHOR_TARGET_UNSPECIFIED
	for _, target := range targets {
		if target <= previous || target > presentation.AnchorTarget_ANCHOR_TARGET_BODY {
			return nil, nil, ErrV2RuntimeDefinition
		}
		previous = target
		pose := &realtime.ProjectedTrackedPose{Target: target, State: &realtime.ProjectedTrackedPose_Unavailable{Unavailable: &realtime.TrackedPoseUnavailable{}}}
		sample, found := s.tracking.lastSamples[realtime.TrackedTarget(target)]
		if found && s.snapshot.Clock.GetRunning() != nil && sample.OriginVersion == s.snapshot.PresentationOrigin.Version && nowMs >= sample.ObservedAtMs && nowMs-sample.ObservedAtMs <= 500 && (sample.PositionAvailable || sample.RotationAvailable) {
			value := &realtime.ProjectedTrackedPoseSample{TrackingFrameSequence: sample.FrameSequence, ObservedAtRuntimeMonotonicMs: sample.ObservedAtMs}
			if sample.PositionAvailable {
				value.Position = proto.Clone(sample.Pose.Position).(*presentation.Vector3)
			}
			if sample.RotationAvailable {
				value.Rotation = proto.Clone(sample.Pose.Rotation).(*presentation.Quaternion)
			}
			pose.State = &realtime.ProjectedTrackedPose_Sample{Sample: value}
		}
		poses = append(poses, pose)
	}
	var frozen []*realtime.FrozenAnchorDisplayState
	for _, node := range nodes {
		if item := frozenV3ByNode(s.snapshot.FrozenAnchors, node.NodeId); item != nil {
			frozen = append(frozen, proto.Clone(item).(*realtime.FrozenAnchorDisplayState))
		}
	}
	return poses, frozen, nil
}
