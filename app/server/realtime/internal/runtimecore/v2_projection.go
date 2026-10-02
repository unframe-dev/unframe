package runtimecore

import (
	"fmt"
	"sort"

	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

func ProjectV2Snapshot(snapshot *realtimev2.CanonicalRuntimeSnapshot, profile *deliveryv2.ProjectionProfileDescriptor, assignmentEpoch uint64, enabledLogicalInputs []string) (*realtimev2.ParticipantRuntimeView, error) {
	if snapshot == nil || profile == nil || profile.ProjectionProfileId == "" || profile.RuntimeCatalog == nil || assignmentEpoch == 0 {
		return nil, ErrV2RuntimeDefinition
	}
	nodes := make(map[string]bool, len(profile.VisibleNodeIds))
	for _, id := range profile.VisibleNodeIds {
		nodes[id] = true
	}
	surfaces := make(map[string]bool, len(profile.VisibleSurfaceIds))
	for _, id := range profile.VisibleSurfaceIds {
		surfaces[id] = true
	}
	variables := make(map[string]bool, len(profile.VisibleVariableIds))
	for _, id := range profile.VisibleVariableIds {
		variables[id] = true
	}
	view := &realtimev2.ParticipantRuntimeView{
		ProjectionProfileId:  profile.ProjectionProfileId,
		AssignmentEpoch:      assignmentEpoch,
		BaseReliableSequence: snapshot.ReliableSequence,
		Progression:          proto.Clone(snapshot.Progression).(*realtimev2.ProgressionRuntimeState),
		Clock:                proto.Clone(snapshot.Clock).(*realtimev2.RuntimeClockSnapshot),
		PresentationOrigin:   proto.Clone(snapshot.PresentationOrigin).(*realtimev2.PresentationOrigin),
		EnabledLogicalInputs: append([]string(nil), enabledLogicalInputs...),
	}
	sort.Strings(view.EnabledLogicalInputs)
	for _, node := range snapshot.NodeStates {
		if nodes[node.NodeId] {
			view.NodeStates = append(view.NodeStates, proto.Clone(node).(*realtimev2.NodeRuntimeState))
		}
	}
	for _, surface := range snapshot.SurfaceStates {
		if surfaces[surface.SurfaceId] {
			view.SurfaceStates = append(view.SurfaceStates, proto.Clone(surface).(*realtimev2.SurfaceRuntimeState))
		}
	}
	for _, media := range snapshot.MediaStates {
		if surfaces[media.SurfaceId] {
			view.MediaStates = append(view.MediaStates, proto.Clone(media).(*realtimev2.MediaRuntimeState))
		}
	}
	for _, variable := range snapshot.Variables {
		if variables[variable.VariableId] {
			view.Variables = append(view.Variables, proto.Clone(variable).(*realtimev2.VariableState))
		}
	}
	for _, model := range snapshot.ModelClipStates {
		if nodes[model.ModelNodeId] {
			view.ModelClipStates = append(view.ModelClipStates, proto.Clone(model).(*realtimev2.ModelClipRuntimeState))
		}
	}
	timelines := make(map[string]bool)
	for _, timeline := range profile.RuntimeCatalog.Timelines {
		timelines[timeline.TimelineId] = true
	}
	for _, run := range snapshot.ActiveRuns {
		visible := run.GetTimeline() != nil && timelines[run.GetTimeline().TimelineId] || run.GetSurfaceTransition() != nil && surfaces[run.GetSurfaceTransition().SurfaceId] || run.GetMedia() != nil && surfaces[run.GetMedia().SurfaceId] || run.GetModelClip() != nil && nodes[run.GetModelClip().ModelNodeId]
		if visible {
			view.ActiveRuns = append(view.ActiveRuns, proto.Clone(run).(*realtimev2.RuntimeRunSnapshot))
		}
	}
	if phase := view.Progression.GetTransitioning(); phase != nil {
		visibleRuns := make(map[uint64]bool, len(view.ActiveRuns))
		for _, run := range view.ActiveRuns {
			visibleRuns[run.RunId.RunSequence] = true
		}
		phase.BlockingRunIds = filterV2Slice(phase.BlockingRunIds, func(id *presentationv2.RuntimeRunId) bool { return visibleRuns[id.RunSequence] })
	}
	if err := protocolv2.ValidateMessage(view); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrV2RuntimeDefinition, err)
	}
	return view, nil
}
