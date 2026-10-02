package runtimecore

import (
	"sort"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) ProjectedAnchorBindings(nodes []*realtimev2.NodeRuntimeState, nowMs uint64) ([]*realtimev2.ProjectedAnchorBindingPatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var patches []*realtimev2.ProjectedAnchorBindingPatch
	for _, node := range nodes {
		definition, ok := s.definition.Scene.Nodes[node.NodeId]
		if !ok {
			return nil, ErrV2RuntimeDefinition
		}
		if definition.Parent.Kind != "anchor" {
			continue
		}
		var target realtimev2.TrackedTarget
		switch definition.Parent.Target {
		case "head":
			target = realtimev2.TrackedTarget_TRACKED_TARGET_HEAD
		case "leftHand":
			target = realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND
		case "rightHand":
			target = realtimev2.TrackedTarget_TRACKED_TARGET_RIGHT_HAND
		case "body":
			target = realtimev2.TrackedTarget_TRACKED_TARGET_BODY
		default:
			return nil, ErrV2RuntimeDefinition
		}
		patch := &realtimev2.ProjectedAnchorBindingPatch{NodeId: node.NodeId, State: &realtimev2.ProjectedAnchorBindingPatch_Unavailable{Unavailable: &realtimev2.AnchorBindingUnavailable{}}}
		sample, found := s.tracking.lastSamples[target]
		if found && sample.OriginVersion == s.snapshot.PresentationOrigin.Version && nowMs >= sample.ObservedAtMs && nowMs-sample.ObservedAtMs <= 500 && (!definition.Parent.FollowPosition || sample.PositionAvailable) && (!definition.Parent.FollowRotation || sample.RotationAvailable) {
			binding := &realtimev2.ProjectedAnchorBindingSample{TrackingFrameSequence: sample.FrameSequence, ObservedAtRuntimeMonotonicMs: sample.ObservedAtMs}
			if definition.Parent.FollowPosition {
				binding.Position = proto.Clone(sample.Pose.Position).(*presentationv2.Vector3)
			}
			if definition.Parent.FollowRotation {
				binding.Rotation = proto.Clone(sample.Pose.Rotation).(*presentationv2.Quaternion)
			}
			patch.State = &realtimev2.ProjectedAnchorBindingPatch_Sample{Sample: binding}
		}
		patches = append(patches, patch)
	}
	sort.Slice(patches, func(i, j int) bool { return patches[i].NodeId < patches[j].NodeId })
	return patches, nil
}
