package runtimecore

import (
	"sort"

	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

type testAnchorBinding struct {
	sample *realtime.ProjectedTrackedPoseSample
	frozen *realtime.FrozenAnchorDisplayState
}

func (p testAnchorBinding) GetSample() *realtime.ProjectedTrackedPoseSample { return p.sample }
func (p testAnchorBinding) GetFrozen() *realtime.FrozenAnchorDisplayState   { return p.frozen }
func (p testAnchorBinding) GetUnavailable() *struct{} {
	if p.sample == nil && p.frozen == nil {
		return &struct{}{}
	}
	return nil
}

func testAnchorBindings(s *V2Session, nodes []*realtime.NodeRuntimeState, now uint64) ([]testAnchorBinding, error) {
	return testAnchorBindingsAtCut(s, nodes, now, s.Snapshot().ReliableSequence)
}

func testAnchorBindingsAtCut(s *V2Session, nodes []*realtime.NodeRuntimeState, now, cut uint64) ([]testAnchorBinding, error) {
	targetsByName := map[string]presentation.AnchorTarget{"head": 1, "leftHand": 2, "rightHand": 3, "body": 4}
	set := map[presentation.AnchorTarget]bool{}
	for _, node := range nodes {
		if def := s.definition.Scene.Nodes[node.NodeId]; def.Parent.Kind == "anchor" {
			set[targetsByName[def.Parent.Target]] = true
		}
	}
	var targets []presentation.AnchorTarget
	for target := range set {
		targets = append(targets, target)
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i] < targets[j] })
	poses, frozen, err := s.ProjectedTrackedPosesAtCut(targets, nodes, now, cut)
	if err != nil {
		return nil, err
	}
	byTarget := map[presentation.AnchorTarget]*realtime.ProjectedTrackedPoseSample{}
	for _, pose := range poses {
		byTarget[pose.Target] = pose.GetSample()
	}
	byNode := map[string]*realtime.FrozenAnchorDisplayState{}
	for _, item := range frozen {
		byNode[item.NodeId] = item
	}
	var result []testAnchorBinding
	for _, node := range nodes {
		def := s.definition.Scene.Nodes[node.NodeId]
		if def.Parent.Kind != "anchor" {
			continue
		}
		entry := testAnchorBinding{frozen: byNode[node.NodeId]}
		if sample := byTarget[targetsByName[def.Parent.Target]]; sample != nil && entry.frozen == nil {
			entry.sample = proto.Clone(sample).(*realtime.ProjectedTrackedPoseSample)
			if !def.Parent.FollowPosition {
				entry.sample.Position = nil
			}
			if !def.Parent.FollowRotation {
				entry.sample.Rotation = nil
			}
			if def.Parent.FollowPosition && entry.sample.Position == nil || def.Parent.FollowRotation && entry.sample.Rotation == nil {
				entry.sample = nil
			}
		}
		result = append(result, entry)
	}
	return result, nil
}
