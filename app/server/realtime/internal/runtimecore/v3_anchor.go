package runtimecore

import (
	"errors"
	"sort"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

var ErrV3StateCutChanged = errors.New("runtime state cut changed")

func (s *V2Session) freshV3Anchor(node v2Node, now time.Time) (v2PresentedTrackingSample, bool, error) {
	sample, available, err := s.anchorTrackingSample(node)
	return sample, available && !now.Before(sample.ReceivedAt) && now.Sub(sample.ReceivedAt) <= 500*time.Millisecond, err
}

func (s *V2Session) freezeV3Anchors(now time.Time) error {
	frozen := map[string]*realtimev2.FrozenAnchorDisplayState{}
	active := map[string]bool{}
	for _, state := range s.snapshot.NodeStates {
		active[state.NodeId] = true
	}
	for _, state := range s.snapshot.FrozenAnchors {
		if active[state.NodeId] {
			frozen[state.NodeId] = proto.Clone(state).(*realtimev2.FrozenAnchorDisplayState)
		}
	}
	for _, state := range s.snapshot.NodeStates {
		node := s.definition.Scene.Nodes[state.NodeId]
		if node.Parent.Kind != "anchor" {
			continue
		}
		sample, available, err := s.freshV3Anchor(node, now)
		if err != nil {
			return err
		}
		if !available {
			continue
		}
		display := &realtimev2.FrozenAnchorDisplayState{NodeId: state.NodeId}
		if node.Parent.FollowPosition {
			display.Position = proto.Clone(sample.Pose.Position).(*presentationv2.Vector3)
		}
		if node.Parent.FollowRotation {
			display.Rotation = proto.Clone(sample.Pose.Rotation).(*presentationv2.Quaternion)
		}
		if display.Position != nil || display.Rotation != nil {
			frozen[state.NodeId] = display
		}
	}
	s.snapshot.FrozenAnchors = nil
	for _, id := range sortedV2Keys(frozen) {
		s.snapshot.FrozenAnchors = append(s.snapshot.FrozenAnchors, frozen[id])
	}
	return nil
}

func (s *V2Session) releaseFreshV3Anchors(now time.Time) (bool, error) {
	retained := make([]*realtimev2.FrozenAnchorDisplayState, 0, len(s.snapshot.FrozenAnchors))
	for _, frozen := range s.snapshot.FrozenAnchors {
		_, available, err := s.freshV3Anchor(s.definition.Scene.Nodes[frozen.NodeId], now)
		if err != nil {
			return false, err
		}
		if !available {
			retained = append(retained, frozen)
		}
	}
	changed := len(retained) != len(s.snapshot.FrozenAnchors)
	if changed {
		s.snapshot.FrozenAnchors = retained
	}
	return changed, nil
}

func (s *V2Session) canonicalV3RuntimeView() *realtimev2.ParticipantRuntimeView {
	snapshot := s.snapshot
	epoch := uint64(1)
	if s.checkpointMetadata != nil {
		epoch = s.checkpointMetadata.AssignmentEpoch
	}
	return proto.Clone(&realtimev2.ParticipantRuntimeView{ProjectionProfileId: "canonical", AssignmentEpoch: epoch, BaseReliableSequence: snapshot.ReliableSequence, Progression: snapshot.Progression, Clock: snapshot.Clock, PresentationOrigin: snapshot.PresentationOrigin, NodeStates: snapshot.NodeStates, SurfaceStates: snapshot.SurfaceStates, MediaStates: snapshot.MediaStates, ModelClipStates: snapshot.ModelClipStates, Variables: snapshot.Variables, ActiveRuns: snapshot.ActiveRuns, FrozenAnchors: snapshot.FrozenAnchors, EnabledLogicalInputs: s.EnabledLogicalInputs(snapshot)}).(*realtimev2.ParticipantRuntimeView)
}

func (s *V2Session) prepareV3Pause(previous *realtimev2.CanonicalRuntimeSnapshot, events []*realtimev2.ProjectedReliableEvent) ([]*realtimev2.ProjectedReliableEvent, error) {
	if previous.Clock.GetRunning() == nil || s.snapshot.Clock.GetPaused() == nil {
		return events, nil
	}
	if err := s.freezeV3Anchors(time.Now()); err != nil {
		return nil, err
	}
	if s.snapshot.InputEpoch == previous.InputEpoch {
		if err := s.requireV3Synchronization(realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PAUSED, false); err != nil {
			return nil, err
		}
	}
	var replacement *realtimev2.ProjectedReliableEvent
	if len(events) > 0 && events[len(events)-1].GetRuntimeStatusChanged().GetPaused() != nil {
		replacement = events[len(events)-1]
	} else {
		replacement = s.nextEvent(&realtimev2.ProjectedReliableEvent{})
		events = append(events, replacement)
	}
	view := s.canonicalV3RuntimeView()
	view.BaseReliableSequence = replacement.Sequence
	replacement.Payload = &realtimev2.ProjectedReliableEvent_RuntimeViewReplaced{RuntimeViewReplaced: &realtimev2.RuntimeViewReplaced{RuntimeView: view}}
	return events, nil
}

func (s *V2Session) ProjectedAnchorBindingsAtCut(nodes []*realtimev2.NodeRuntimeState, nowMs, expectedReliableSequence uint64) ([]*realtimev2.ProjectedAnchorBindingPatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.ReliableSequence != expectedReliableSequence {
		return nil, ErrV3StateCutChanged
	}
	return s.projectedV3AnchorBindings(nodes, nowMs)
}

func frozenV3ByNode(states []*realtimev2.FrozenAnchorDisplayState, id string) *realtimev2.FrozenAnchorDisplayState {
	index := sort.Search(len(states), func(index int) bool { return states[index].NodeId >= id })
	if index < len(states) && states[index].NodeId == id {
		return states[index]
	}
	return nil
}

func (s *V2Session) pruneV3FrozenAnchors() {
	active := make(map[string]bool, len(s.snapshot.NodeStates))
	for _, node := range s.snapshot.NodeStates {
		active[node.NodeId] = true
	}
	s.snapshot.FrozenAnchors = filterV2Slice(s.snapshot.FrozenAnchors, func(frozen *realtimev2.FrozenAnchorDisplayState) bool { return active[frozen.NodeId] })
}
