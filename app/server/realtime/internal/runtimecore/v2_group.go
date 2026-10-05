package runtimecore

import (
	"encoding/json"
	"sort"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) enterV2Group(targetID string) ([]*realtimev2.ProjectedReliableEvent, error) {
	target, ok := s.definition.Flow.Groups[targetID]
	if !ok || target.ID != targetID || target.InitialStepID == "" {
		return nil, ErrV2RuntimeDefinition
	}
	var root map[string]json.RawMessage
	if json.Unmarshal(s.rawDefinition, &root) != nil {
		return nil, ErrV2RuntimeDefinition
	}
	var flow map[string]json.RawMessage
	if json.Unmarshal(root["flow"], &flow) != nil {
		return nil, ErrV2RuntimeDefinition
	}
	targetBytes, err := json.Marshal(targetID)
	if err != nil {
		return nil, err
	}
	flow["initialGroupId"] = targetBytes
	flowBytes, err := json.Marshal(flow)
	if err != nil {
		return nil, err
	}
	root["flow"] = flowBytes
	raw, err := json.Marshal(root)
	if err != nil {
		return nil, err
	}
	initial, err := newV2InitialSnapshot(raw, s.mediaSpecs, s.modelClips)
	if err != nil {
		return nil, err
	}
	oldID := s.snapshot.Progression.CurrentGroupId
	oldEpoch := s.snapshot.Progression.GroupEntryEpoch
	var events []*realtimev2.ProjectedReliableEvent
	originalRuns := append([]*realtimev2.RuntimeRunSnapshot(nil), s.snapshot.ActiveRuns...)
	cancellations := make(map[uint64]*realtimev2.ProjectedReliableEvent)
	for _, canceled := range cancelV2MediaRuns(s.snapshot, realtimev2.MediaCancelReason_MEDIA_CANCEL_REASON_GROUP_EXIT, oldID) {
		cancellations[canceled.GetMediaCanceled().RunId.RunSequence] = canceled
	}
	var active []*realtimev2.RuntimeRunSnapshot
	for _, run := range originalRuns {
		if run.Owner.GetGroup() != nil && run.Owner.GetGroup().GroupId == oldID {
			if timeline := run.GetTimeline(); timeline != nil {
				cancellations[run.RunId.RunSequence] = &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_TimelineCanceled{TimelineCanceled: &realtimev2.TimelineCanceled{RunId: run.RunId, TimelineId: timeline.TimelineId, Reason: realtimev2.TimelineCancelReason_TIMELINE_CANCEL_REASON_GROUP_EXIT}}}
			}
			if model := run.GetModelClip(); model != nil {
				found := false
				for _, state := range s.snapshot.ModelClipStates {
					if state.ModelNodeId != model.ModelNodeId {
						continue
					}
					result, err := cancelV2ModelRun(state, run, realtimev2.ModelClipCancelReason_MODEL_CLIP_CANCEL_REASON_GROUP_EXIT)
					if err != nil {
						return nil, err
					}
					for _, event := range result.Events {
						cancellations[run.RunId.RunSequence] = event
					}
					found = true
					break
				}
				if !found {
					return nil, ErrV2RuntimeDefinition
				}
			}
			continue
		}
		active = append(active, run)
	}
	sort.Slice(originalRuns, func(i, j int) bool { return originalRuns[i].RunId.RunSequence < originalRuns[j].RunId.RunSequence })
	for _, run := range originalRuns {
		if canceled := cancellations[run.RunId.RunSequence]; canceled != nil {
			events = append(events, canceled)
		}
	}
	s.snapshot.ActiveRuns = active
	groupNodes := func(id string) bool {
		node, ok := s.definition.Scene.Nodes[id]
		return ok && node.Owner.Kind == "group" && node.Owner.GroupID == targetID
	}
	keepNodes := filterV2Slice(s.snapshot.NodeStates, func(x *realtimev2.NodeRuntimeState) bool {
		node := s.definition.Scene.Nodes[x.NodeId]
		return node.Owner.Kind != "group"
	})
	newNodes := filterV2Slice(initial.NodeStates, func(x *realtimev2.NodeRuntimeState) bool { return groupNodes(x.NodeId) })
	s.snapshot.NodeStates = append(keepNodes, newNodes...)
	sort.Slice(s.snapshot.NodeStates, func(i, j int) bool { return s.snapshot.NodeStates[i].NodeId < s.snapshot.NodeStates[j].NodeId })
	groupSurface := func(id string) bool {
		surface, ok := s.definition.Scene.Surfaces[id]
		return ok && groupNodes(surface.HostNodeID)
	}
	keepSurfaces := filterV2Slice(s.snapshot.SurfaceStates, func(x *realtimev2.SurfaceRuntimeState) bool {
		return surfaceOwnerKind(s.definition, x.SurfaceId) != "group"
	})
	newSurfaces := filterV2Slice(initial.SurfaceStates, func(x *realtimev2.SurfaceRuntimeState) bool { return groupSurface(x.SurfaceId) })
	s.snapshot.SurfaceStates = append(keepSurfaces, newSurfaces...)
	sort.Slice(s.snapshot.SurfaceStates, func(i, j int) bool {
		return s.snapshot.SurfaceStates[i].SurfaceId < s.snapshot.SurfaceStates[j].SurfaceId
	})
	keepMedia := filterV2Slice(s.snapshot.MediaStates, func(x *realtimev2.MediaRuntimeState) bool {
		return surfaceOwnerKind(s.definition, x.SurfaceId) != "group"
	})
	newMedia := filterV2Slice(initial.MediaStates, func(x *realtimev2.MediaRuntimeState) bool { return groupSurface(x.SurfaceId) })
	s.snapshot.MediaStates = append(keepMedia, newMedia...)
	sort.Slice(s.snapshot.MediaStates, func(i, j int) bool { return s.snapshot.MediaStates[i].SurfaceId < s.snapshot.MediaStates[j].SurfaceId })
	keepModel := filterV2Slice(s.snapshot.ModelClipStates, func(x *realtimev2.ModelClipRuntimeState) bool {
		return s.definition.Scene.Nodes[x.ModelNodeId].Owner.Kind != "group"
	})
	newModel := filterV2Slice(initial.ModelClipStates, func(x *realtimev2.ModelClipRuntimeState) bool { return groupNodes(x.ModelNodeId) })
	s.snapshot.ModelClipStates = append(keepModel, newModel...)
	sort.Slice(s.snapshot.ModelClipStates, func(i, j int) bool {
		return s.snapshot.ModelClipStates[i].ModelNodeId < s.snapshot.ModelClipStates[j].ModelNodeId
	})
	keepVariables := filterV2Slice(s.snapshot.Variables, func(x *realtimev2.VariableState) bool {
		variable := s.definition.Flow.Variables[x.VariableId]
		return variable.Owner.Kind != "group"
	})
	newVariables := filterV2Slice(initial.Variables, func(x *realtimev2.VariableState) bool {
		variable := s.definition.Flow.Variables[x.VariableId]
		return variable.Owner.Kind == "group" && variable.Owner.GroupID == targetID
	})
	s.snapshot.Variables = append(keepVariables, newVariables...)
	sort.Slice(s.snapshot.Variables, func(i, j int) bool { return s.snapshot.Variables[i].VariableId < s.snapshot.Variables[j].VariableId })
	s.snapshot.Progression.CurrentGroupId = targetID
	s.snapshot.Progression.GroupEntryEpoch++
	s.snapshot.Progression.CurrentStepId = target.InitialStepID
	s.snapshot.Progression.StepEntryEpoch++
	s.snapshot.Progression.StepEnteredAtRuntimeTimeMs = s.snapshot.Clock.RuntimeTimeMs
	s.snapshot.Progression.Phase = &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}
	s.snapshot.StepExecution = &realtimev2.StepExecutionSnapshot{StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch}
	if err := s.armV2StepTimers(); err != nil {
		return nil, err
	}
	initialization := &realtimev2.GroupRuntimeInitialization{NodeStates: cloneV2NodeStates(newNodes), SurfaceStates: cloneV2SurfaceStates(newSurfaces), MediaStates: cloneV2MediaStates(newMedia), ModelClipStates: cloneV2ModelStates(newModel), Variables: cloneV2VariableStates(newVariables)}
	events = append(events,
		&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_GroupExited{GroupExited: &realtimev2.GroupExited{GroupId: oldID, GroupEntryEpoch: oldEpoch}}},
		&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_GroupEntered{GroupEntered: &realtimev2.GroupEntered{GroupId: targetID, GroupEntryEpoch: s.snapshot.Progression.GroupEntryEpoch, Initialization: initialization}}},
		&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_StepEntered{StepEntered: &realtimev2.StepEntered{GroupId: targetID, GroupEntryEpoch: s.snapshot.Progression.GroupEntryEpoch, StepId: target.InitialStepID, StepEntryEpoch: s.snapshot.Progression.StepEntryEpoch, EnteredAtRuntimeTimeMs: s.snapshot.Clock.RuntimeTimeMs}}},
	)
	return events, nil
}

func surfaceOwnerKind(def v2Definition, surfaceID string) string {
	return def.Scene.Nodes[def.Scene.Surfaces[surfaceID].HostNodeID].Owner.Kind
}
func cloneV2NodeStates(values []*realtimev2.NodeRuntimeState) []*realtimev2.NodeRuntimeState {
	result := make([]*realtimev2.NodeRuntimeState, len(values))
	for i, x := range values {
		result[i] = proto.Clone(x).(*realtimev2.NodeRuntimeState)
	}
	return result
}
func cloneV2SurfaceStates(values []*realtimev2.SurfaceRuntimeState) []*realtimev2.SurfaceRuntimeState {
	result := make([]*realtimev2.SurfaceRuntimeState, len(values))
	for i, x := range values {
		result[i] = proto.Clone(x).(*realtimev2.SurfaceRuntimeState)
	}
	return result
}
func cloneV2MediaStates(values []*realtimev2.MediaRuntimeState) []*realtimev2.MediaRuntimeState {
	result := make([]*realtimev2.MediaRuntimeState, len(values))
	for i, x := range values {
		result[i] = proto.Clone(x).(*realtimev2.MediaRuntimeState)
	}
	return result
}
func cloneV2ModelStates(values []*realtimev2.ModelClipRuntimeState) []*realtimev2.ModelClipRuntimeState {
	result := make([]*realtimev2.ModelClipRuntimeState, len(values))
	for i, x := range values {
		result[i] = proto.Clone(x).(*realtimev2.ModelClipRuntimeState)
	}
	return result
}
func cloneV2VariableStates(values []*realtimev2.VariableState) []*realtimev2.VariableState {
	result := make([]*realtimev2.VariableState, len(values))
	for i, x := range values {
		result[i] = proto.Clone(x).(*realtimev2.VariableState)
	}
	return result
}
