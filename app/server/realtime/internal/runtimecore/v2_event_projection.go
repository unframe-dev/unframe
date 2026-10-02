package runtimecore

import (
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func ProjectV2ReliableEvent(event *realtimev2.ProjectedReliableEvent, profile *deliveryv2.ProjectionProfileDescriptor) (*realtimev2.ProjectedReliableEvent, bool) {
	if event == nil || profile == nil || profile.RuntimeCatalog == nil {
		return nil, false
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
	timelines := make(map[string]bool, len(profile.RuntimeCatalog.Timelines))
	for _, timeline := range profile.RuntimeCatalog.Timelines {
		timelines[timeline.TimelineId] = true
	}
	visible := false
	switch payload := event.Payload.(type) {
	case *realtimev2.ProjectedReliableEvent_RuntimeStatusChanged, *realtimev2.ProjectedReliableEvent_PresentationOriginChanged,
		*realtimev2.ProjectedReliableEvent_GroupExited, *realtimev2.ProjectedReliableEvent_StepEntered,
		*realtimev2.ProjectedReliableEvent_CueAccepted, *realtimev2.ProjectedReliableEvent_PresentationEnded,
		*realtimev2.ProjectedReliableEvent_LogicalInputAccepted, *realtimev2.ProjectedReliableEvent_ParticipantPresenceChanged:
		visible = true
	case *realtimev2.ProjectedReliableEvent_GroupEntered:
		clone := proto.Clone(event).(*realtimev2.ProjectedReliableEvent)
		initial := clone.GetGroupEntered().Initialization
		if initial != nil {
			initial.NodeStates = filterV2Slice(initial.NodeStates, func(x *realtimev2.NodeRuntimeState) bool { return nodes[x.NodeId] })
			initial.SurfaceStates = filterV2Slice(initial.SurfaceStates, func(x *realtimev2.SurfaceRuntimeState) bool { return surfaces[x.SurfaceId] })
			initial.MediaStates = filterV2Slice(initial.MediaStates, func(x *realtimev2.MediaRuntimeState) bool { return surfaces[x.SurfaceId] })
			initial.Variables = filterV2Slice(initial.Variables, func(x *realtimev2.VariableState) bool { return variables[x.VariableId] })
			initial.ModelClipStates = filterV2Slice(initial.ModelClipStates, func(x *realtimev2.ModelClipRuntimeState) bool { return nodes[x.ModelNodeId] })
		}
		return clone, true
	case *realtimev2.ProjectedReliableEvent_SurfaceInteractionAccepted:
		visible = surfaces[payload.SurfaceInteractionAccepted.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_SurfaceStateChanged:
		visible = surfaces[payload.SurfaceStateChanged.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_SurfaceTransitionStarted:
		visible = surfaces[payload.SurfaceTransitionStarted.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_SurfaceTransitionCompleted:
		visible = surfaces[payload.SurfaceTransitionCompleted.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_NodeStateCommitted:
		visible = nodes[payload.NodeStateCommitted.GetState().GetNodeId()]
	case *realtimev2.ProjectedReliableEvent_VariableChanged:
		visible = variables[payload.VariableChanged.GetState().GetVariableId()]
	case *realtimev2.ProjectedReliableEvent_TimelineStarted:
		visible = timelines[payload.TimelineStarted.TimelineId]
	case *realtimev2.ProjectedReliableEvent_TimelineCompleted:
		visible = timelines[payload.TimelineCompleted.TimelineId]
	case *realtimev2.ProjectedReliableEvent_TimelineCanceled:
		visible = timelines[payload.TimelineCanceled.TimelineId]
	case *realtimev2.ProjectedReliableEvent_MediaStarted:
		visible = surfaces[payload.MediaStarted.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaPaused:
		visible = surfaces[payload.MediaPaused.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaResumed:
		visible = surfaces[payload.MediaResumed.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaSeeked:
		visible = surfaces[payload.MediaSeeked.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaCompleted:
		visible = surfaces[payload.MediaCompleted.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaCanceled:
		visible = surfaces[payload.MediaCanceled.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaStopped:
		visible = surfaces[payload.MediaStopped.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_MediaStoppedSeeked:
		visible = surfaces[payload.MediaStoppedSeeked.SurfaceId]
	case *realtimev2.ProjectedReliableEvent_ModelClipStarted:
		visible = nodes[payload.ModelClipStarted.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipPaused:
		visible = nodes[payload.ModelClipPaused.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipResumed:
		visible = nodes[payload.ModelClipResumed.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipStopped:
		visible = nodes[payload.ModelClipStopped.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipCompleted:
		visible = nodes[payload.ModelClipCompleted.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipCrossfadeStarted:
		visible = nodes[payload.ModelClipCrossfadeStarted.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipCrossfadeCompleted:
		visible = nodes[payload.ModelClipCrossfadeCompleted.ModelNodeId]
	case *realtimev2.ProjectedReliableEvent_ModelClipCanceled:
		visible = nodes[payload.ModelClipCanceled.ModelNodeId]
	}
	if !visible {
		return nil, false
	}
	return proto.Clone(event).(*realtimev2.ProjectedReliableEvent), true
}

func filterV2Slice[T any](values []T, keep func(T) bool) []T {
	filtered := make([]T, 0, len(values))
	for _, value := range values {
		if keep(value) {
			filtered = append(filtered, value)
		}
	}
	return filtered
}
