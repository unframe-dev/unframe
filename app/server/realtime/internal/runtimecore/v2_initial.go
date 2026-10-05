package runtimecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
)

var (
	ErrV2RuntimeDefinition  = errors.New("v2 runtime definition is invalid")
	ErrV2RuntimeUnsupported = errors.New("v2 runtime definition needs an unavailable consumer")
)

type v2Owner struct {
	Kind    string `json:"kind"`
	GroupID string `json:"groupId"`
}

type v2Node struct {
	ID      string  `json:"id"`
	Kind    string  `json:"kind"`
	AssetID string  `json:"assetId"`
	Owner   v2Owner `json:"owner"`
	Parent  struct {
		Kind           string `json:"kind"`
		NodeID         string `json:"nodeId"`
		Target         string `json:"target"`
		FollowPosition bool   `json:"followPosition"`
		FollowRotation bool   `json:"followRotation"`
	} `json:"parent"`
	Order     uint32  `json:"order"`
	SurfaceID string  `json:"surfaceId"`
	Active    bool    `json:"active"`
	Visible   bool    `json:"visible"`
	Opacity   float64 `json:"opacity"`
	Transform struct {
		Position [3]float64 `json:"position"`
		Rotation [4]float64 `json:"rotation"`
		Scale    [3]float64 `json:"scale"`
	} `json:"transform"`
}

type v2Surface struct {
	Interactions map[string]struct {
		ID    string `json:"id"`
		Event string `json:"event"`
	} `json:"interactions"`
	ID             string                     `json:"id"`
	HostNodeID     string                     `json:"hostNodeId"`
	InitialStateID string                     `json:"initialStateId"`
	States         map[string]json.RawMessage `json:"states"`
	Content        struct {
		Nodes map[string]struct {
			Kind string `json:"kind"`
			Loop bool   `json:"loop"`
		} `json:"nodes"`
	} `json:"content"`
	PhysicalSizeMeters [2]float64 `json:"physicalSizeMeters"`
	LogicalSize        [2]float64 `json:"logicalSize"`
	Fit                string     `json:"fit"`
	RenderIntent       struct {
		InternalAnimation struct {
			Kind                 string `json:"kind"`
			DurationMilliseconds uint64 `json:"durationMilliseconds"`
		} `json:"internalAnimation"`
	} `json:"renderIntent"`
}

type v2Variable struct {
	ID           string  `json:"id"`
	Owner        v2Owner `json:"owner"`
	Type         string  `json:"type"`
	InitialValue any     `json:"initialValue"`
}

type v2Cue struct {
	ID       string `json:"id"`
	Priority uint64 `json:"priority"`
	Order    uint32 `json:"order"`
	Trigger  struct {
		Kind       string `json:"kind"`
		Event      string `json:"event"`
		TimelineID string `json:"timelineId"`
		Actor      struct {
			Kind string `json:"kind"`
		} `json:"actor"`
		Action                string  `json:"action"`
		SurfaceID             string  `json:"surfaceId"`
		NodeID                string  `json:"nodeId"`
		ClipID                string  `json:"clipId"`
		InteractionID         string  `json:"interactionId"`
		AfterMilliseconds     uint64  `json:"afterMilliseconds"`
		ZoneID                string  `json:"zoneId"`
		Edge                  string  `json:"edge"`
		DwellMilliseconds     uint64  `json:"dwellMilliseconds"`
		HysteresisMeters      float64 `json:"hysteresisMeters"`
		MinimumDistanceMeters float64 `json:"minimumDistanceMeters"`
		WindowMilliseconds    uint64  `json:"windowMilliseconds"`
		Subject               struct {
			Kind   string `json:"kind"`
			Target string `json:"target"`
		} `json:"subject"`
	} `json:"trigger"`
	FirePolicy struct {
		Kind                 string `json:"kind"`
		CooldownMilliseconds uint64 `json:"cooldownMilliseconds"`
	} `json:"firePolicy"`
	Guard        json.RawMessage `json:"guard"`
	FixedPayload map[string]any  `json:"fixedPayload"`
	Next         struct {
		Kind    string `json:"kind"`
		StepID  string `json:"stepId"`
		GroupID string `json:"groupId"`
	} `json:"next"`
	Actions []v2Action `json:"actions"`
}

type v2Action struct {
	Kind            string                     `json:"kind"`
	TimelineID      string                     `json:"timelineId"`
	Completion      string                     `json:"completion"`
	Conflict        string                     `json:"conflict"`
	SurfaceID       string                     `json:"surfaceId"`
	StateID         string                     `json:"stateId"`
	VariableID      string                     `json:"variableId"`
	Value           json.RawMessage            `json:"value"`
	NodeID          string                     `json:"nodeId"`
	Patch           map[string]json.RawMessage `json:"patch"`
	Transition      json.RawMessage            `json:"transition"`
	PositionSeconds json.RawMessage            `json:"positionSeconds"`
	ClipID          string                     `json:"clipId"`
	Speed           float64                    `json:"speed"`
	Loop            bool                       `json:"loop"`
}

type v2Definition struct {
	SchemaVersion  uint32 `json:"schemaVersion"`
	PresentationID string `json:"presentationId"`
	Stage          struct {
		Zones map[string]v2TrackingZone `json:"zones"`
	} `json:"stage"`
	Scene struct {
		Nodes    map[string]v2Node    `json:"nodes"`
		Surfaces map[string]v2Surface `json:"surfaces"`
	} `json:"scene"`
	Flow struct {
		InitialGroupID string `json:"initialGroupId"`
		Groups         map[string]struct {
			ID            string `json:"id"`
			InitialStepID string `json:"initialStepId"`
			Steps         map[string]struct {
				ID   string  `json:"id"`
				Cues []v2Cue `json:"cues"`
			} `json:"steps"`
		} `json:"groups"`
		Variables map[string]v2Variable      `json:"variables"`
		Timelines map[string]json.RawMessage `json:"timelines"`
	} `json:"flow"`
}

func NewV2InitialSnapshot(raw json.RawMessage) (*realtimev2.CanonicalRuntimeSnapshot, error) {
	return newV2InitialSnapshot(raw, nil, nil)
}

func newV2InitialSnapshot(raw json.RawMessage, mediaSpecs map[string]map[string]v2MediaSpec, modelClips map[string]map[string]v2ModelClipSpec) (*realtimev2.CanonicalRuntimeSnapshot, error) {
	var definition v2Definition
	if err := json.Unmarshal(raw, &definition); err != nil || definition.SchemaVersion != 2 || definition.PresentationID == "" {
		return nil, ErrV2RuntimeDefinition
	}
	for id, node := range definition.Scene.Nodes {
		if node.Kind == "model" && modelClips[id] == nil {
			return nil, ErrV2RuntimeUnsupported
		}
	}
	for id, surface := range definition.Scene.Surfaces {
		if surface.RenderIntent.InternalAnimation.Kind == "precomputed-video" && mediaSpecs == nil {
			return nil, ErrV2RuntimeUnsupported
		}
		if len(surface.Content.Nodes) != 0 {
			video := false
			for _, content := range surface.Content.Nodes {
				video = video || content.Kind == "video"
			}
			if video && mediaSpecs[id] == nil {
				return nil, ErrV2RuntimeUnsupported
			}
		}
	}
	for _, group := range definition.Flow.Groups {
		for _, step := range group.Steps {
			trackingDefinition := v2TrackingDefinition{Zones: definition.Stage.Zones}
			for _, cue := range step.Cues {
				switch cue.Trigger.Kind {
				case "zoneEdge", "motion":
					tracked, err := v2TrackingCueFromDefinition(cue)
					if err != nil {
						return nil, ErrV2RuntimeDefinition
					}
					trackingDefinition.Cues = append(trackingDefinition.Cues, tracked)
				case "modelClipCompleted":
					if modelClips[cue.Trigger.NodeID][cue.Trigger.ClipID].DurationMS == 0 {
						return nil, ErrV2RuntimeUnsupported
					}
				case "mediaCompleted":
					if mediaSpecs == nil || mediaSpecs[cue.Trigger.SurfaceID] == nil {
						return nil, ErrV2RuntimeUnsupported
					}
				}
				for _, action := range cue.Actions {
					switch action.Kind {
					case "modelClip.play", "modelClip.pause", "modelClip.resume", "modelClip.stop":
						if modelClips[action.NodeID] == nil {
							return nil, ErrV2RuntimeUnsupported
						}
					case "media.play", "media.pause", "media.seek":
						if mediaSpecs == nil || mediaSpecs[action.SurfaceID] == nil {
							return nil, ErrV2RuntimeUnsupported
						}
					case "media.resume", "media.stop":
						return nil, ErrV2RuntimeDefinition
					}
				}
			}
			if err := v2TrackingValidateDefinition(trackingDefinition); err != nil {
				return nil, ErrV2RuntimeDefinition
			}
		}
	}
	group, found := definition.Flow.Groups[definition.Flow.InitialGroupID]
	if !found || group.ID != definition.Flow.InitialGroupID {
		return nil, ErrV2RuntimeDefinition
	}
	step, found := group.Steps[group.InitialStepID]
	if !found || step.ID != group.InitialStepID {
		return nil, ErrV2RuntimeDefinition
	}
	snapshot := &realtimev2.CanonicalRuntimeSnapshot{
		SchemaVersion:      2,
		Clock:              &realtimev2.RuntimeClockSnapshot{Status: &realtimev2.RuntimeClockSnapshot_Running{Running: &realtimev2.Running{}}},
		Progression:        &realtimev2.ProgressionRuntimeState{CurrentGroupId: group.ID, GroupEntryEpoch: 1, CurrentStepId: step.ID, StepEntryEpoch: 1, Phase: &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}},
		StepExecution:      &realtimev2.StepExecutionSnapshot{StepEntryEpoch: 1},
		PresentationOrigin: &realtimev2.PresentationOrigin{Pose: &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}},
	}
	for _, id := range sortedV2Keys(definition.Scene.Nodes) {
		node := definition.Scene.Nodes[id]
		if node.ID != id || !v2OwnerActive(node.Owner, group.ID) {
			continue
		}
		snapshot.NodeStates = append(snapshot.NodeStates, &realtimev2.NodeRuntimeState{
			NodeId: id, Active: node.Active, Visible: node.Visible, Opacity: node.Opacity,
			Transform: &presentationv2.Transform{
				Position: &presentationv2.Vector3{X: node.Transform.Position[0], Y: node.Transform.Position[1], Z: node.Transform.Position[2]},
				Rotation: &presentationv2.Quaternion{X: node.Transform.Rotation[0], Y: node.Transform.Rotation[1], Z: node.Transform.Rotation[2], W: node.Transform.Rotation[3]},
				Scale:    &presentationv2.Vector3{X: node.Transform.Scale[0], Y: node.Transform.Scale[1], Z: node.Transform.Scale[2]},
			},
		})
		if node.Kind == "model" {
			snapshot.ModelClipStates = append(snapshot.ModelClipStates, &realtimev2.ModelClipRuntimeState{ModelNodeId: id, State: &realtimev2.ModelClipRuntimeState_DefaultPose{DefaultPose: &realtimev2.DefaultModelPose{}}})
		}
	}
	for _, id := range sortedV2Keys(definition.Scene.Surfaces) {
		surface := definition.Scene.Surfaces[id]
		host, found := definition.Scene.Nodes[surface.HostNodeID]
		if !found || !v2OwnerActive(host.Owner, group.ID) {
			continue
		}
		if surface.ID != id || surface.InitialStateID == "" || surface.States[surface.InitialStateID] == nil {
			return nil, ErrV2RuntimeDefinition
		}
		snapshot.SurfaceStates = append(snapshot.SurfaceStates, &realtimev2.SurfaceRuntimeState{SurfaceId: id, StateId: surface.InitialStateID})
		if states := mediaSpecs[id]; states != nil {
			snapshot.MediaStates = append(snapshot.MediaStates, &realtimev2.MediaRuntimeState{SurfaceId: id, State: &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{}}})
		}
	}
	for _, id := range sortedV2Keys(definition.Flow.Variables) {
		variable := definition.Flow.Variables[id]
		if !v2OwnerActive(variable.Owner, group.ID) {
			continue
		}
		value, err := v2Scalar(variable.Type, variable.InitialValue)
		if variable.ID != id || err != nil {
			return nil, ErrV2RuntimeDefinition
		}
		snapshot.Variables = append(snapshot.Variables, &realtimev2.VariableState{VariableId: id, Value: value})
	}
	for _, cue := range step.Cues {
		if cue.Trigger.Kind == "timer" {
			if cue.Trigger.AfterMilliseconds == 0 {
				return nil, ErrV2RuntimeDefinition
			}
			snapshot.StepExecution.Timers = append(snapshot.StepExecution.Timers, &realtimev2.ArmedTimer{CueId: cue.ID, DeadlineRuntimeTimeMs: cue.Trigger.AfterMilliseconds})
		}
	}
	sort.Slice(snapshot.StepExecution.Timers, func(i, j int) bool {
		return snapshot.StepExecution.Timers[i].CueId < snapshot.StepExecution.Timers[j].CueId
	})
	if err := protocolv2.ValidateMessage(snapshot); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrV2RuntimeDefinition, err)
	}
	return snapshot, nil
}

func v2OwnerActive(owner v2Owner, groupID string) bool {
	return owner.Kind == "presentation" || owner.Kind == "group" && owner.GroupID == groupID
}

func v2Scalar(kind string, value any) (*presentationv2.ScalarValue, error) {
	switch kind {
	case "string":
		text, ok := value.(string)
		if ok {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_StringValue{StringValue: text}}, nil
		}
	case "number":
		number, ok := value.(float64)
		if ok {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NumberValue{NumberValue: number}}, nil
		}
	case "boolean":
		boolean, ok := value.(bool)
		if ok {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_BooleanValue{BooleanValue: boolean}}, nil
		}
	case "null":
		if value == nil {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NullValue{NullValue: &presentationv2.NullScalar{}}}, nil
		}
	}
	return nil, ErrV2RuntimeDefinition
}

func sortedV2Keys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func BuildV2CanonicalCatalog(raw json.RawMessage) (*presentationv2.ProjectedRuntimeCatalog, error) {
	return buildV2CanonicalCatalog(raw, nil, nil)
}

func buildV2CanonicalCatalog(raw json.RawMessage, mediaSpecs map[string]map[string]v2MediaSpec, modelClips map[string]map[string]v2ModelClipSpec) (*presentationv2.ProjectedRuntimeCatalog, error) {
	if _, err := newV2InitialSnapshot(raw, mediaSpecs, modelClips); err != nil {
		return nil, err
	}
	var def v2Definition
	if err := json.Unmarshal(raw, &def); err != nil {
		return nil, ErrV2RuntimeDefinition
	}
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}
	for _, id := range sortedV2Keys(def.Scene.Nodes) {
		node := def.Scene.Nodes[id]
		if node.ID != id {
			return nil, ErrV2RuntimeDefinition
		}
		owner, err := v2ResourceOwner(node.Owner)
		if err != nil {
			return nil, err
		}
		parent := &presentationv2.SpatialParent{Parent: &presentationv2.SpatialParent_Stage{Stage: &presentationv2.StageParent{}}}
		if node.Parent.Kind == "node" {
			parent.Parent = &presentationv2.SpatialParent_Node{Node: &presentationv2.NodeParent{NodeId: node.Parent.NodeID}}
		} else if node.Parent.Kind == "anchor" {
			var target presentationv2.AnchorTarget
			switch node.Parent.Target {
			case "head":
				target = presentationv2.AnchorTarget_ANCHOR_TARGET_HEAD
			case "leftHand":
				target = presentationv2.AnchorTarget_ANCHOR_TARGET_LEFT_HAND
			case "rightHand":
				target = presentationv2.AnchorTarget_ANCHOR_TARGET_RIGHT_HAND
			case "body":
				target = presentationv2.AnchorTarget_ANCHOR_TARGET_BODY
			default:
				return nil, ErrV2RuntimeDefinition
			}
			parent.Parent = &presentationv2.SpatialParent_PresenterAnchor{PresenterAnchor: &presentationv2.PresenterAnchorParent{Target: target, FollowPosition: node.Parent.FollowPosition, FollowRotation: node.Parent.FollowRotation}}
		} else if node.Parent.Kind != "" && node.Parent.Kind != "stage" {
			return nil, ErrV2RuntimeUnsupported
		}
		projected := &presentationv2.ProjectedNodeDefinition{NodeId: id, Owner: owner, Parent: parent, Order: node.Order}
		switch node.Kind {
		case "container":
			projected.Node = &presentationv2.ProjectedNodeDefinition_Container{Container: &presentationv2.ContainerNode{}}
		case "surface":
			projected.Node = &presentationv2.ProjectedNodeDefinition_Surface{Surface: &presentationv2.SurfaceNode{SemanticSurfaceId: node.SurfaceID}}
		case "model":
			projected.Node = &presentationv2.ProjectedNodeDefinition_Model{Model: &presentationv2.ModelNode{ModelAssetId: node.AssetID}}
		default:
			return nil, ErrV2RuntimeUnsupported
		}
		catalog.Nodes = append(catalog.Nodes, projected)
		if node.Kind == "model" {
			for _, clipID := range sortedV2Keys(modelClips[id]) {
				clip := modelClips[id][clipID]
				catalog.ModelClips = append(catalog.ModelClips, &presentationv2.ProjectedModelClipDefinition{ModelNodeId: id, ModelAssetId: node.AssetID, ClipId: clipID, SourceAnimationIndex: clip.SourceAnimationIndex, DurationMs: clip.DurationMS, Owner: owner})
			}
		}
	}
	for _, id := range sortedV2Keys(def.Scene.Surfaces) {
		surface := def.Scene.Surfaces[id]
		host, ok := def.Scene.Nodes[surface.HostNodeID]
		if !ok || surface.ID != id || host.SurfaceID != id {
			return nil, ErrV2RuntimeDefinition
		}
		owner, err := v2ResourceOwner(host.Owner)
		if err != nil {
			return nil, err
		}
		fit := map[string]presentationv2.SurfaceFit{"contain": presentationv2.SurfaceFit_SURFACE_FIT_CONTAIN, "cover": presentationv2.SurfaceFit_SURFACE_FIT_COVER, "stretch": presentationv2.SurfaceFit_SURFACE_FIT_STRETCH}[surface.Fit]
		if fit == 0 && surface.Fit != "" {
			return nil, ErrV2RuntimeDefinition
		}
		states := sortedV2Keys(surface.States)
		catalog.Surfaces = append(catalog.Surfaces, &presentationv2.ProjectedSurfaceDefinition{SurfaceId: id, HostNodeId: surface.HostNodeID, ReachableStateIds: states, PhysicalSizeMeters: &presentationv2.Vector2{X: surface.PhysicalSizeMeters[0], Y: surface.PhysicalSizeMeters[1]}, LogicalSize: &presentationv2.Vector2{X: surface.LogicalSize[0], Y: surface.LogicalSize[1]}, Fit: fit, Owner: owner, HasVideo: mediaSpecs[id] != nil})
	}
	for _, id := range sortedV2Keys(def.Flow.Variables) {
		variable := def.Flow.Variables[id]
		owner, err := v2ResourceOwner(variable.Owner)
		if err != nil || variable.ID != id {
			return nil, ErrV2RuntimeDefinition
		}
		kind := map[string]presentationv2.ScalarType{"string": presentationv2.ScalarType_SCALAR_TYPE_STRING, "number": presentationv2.ScalarType_SCALAR_TYPE_NUMBER, "boolean": presentationv2.ScalarType_SCALAR_TYPE_BOOLEAN, "null": presentationv2.ScalarType_SCALAR_TYPE_NULL}[variable.Type]
		if kind == 0 {
			return nil, ErrV2RuntimeDefinition
		}
		catalog.Variables = append(catalog.Variables, &presentationv2.ProjectedVariableDefinition{VariableId: id, Type: kind, Owner: owner})
	}
	for _, id := range sortedV2Keys(def.Flow.Timelines) {
		var timeline struct {
			ID                   string  `json:"id"`
			Owner                v2Owner `json:"owner"`
			DurationMilliseconds uint64  `json:"durationMilliseconds"`
			Tracks               []struct {
				Target struct {
					NodeID   string `json:"nodeId"`
					Property string `json:"property"`
				} `json:"target"`
				Keyframes []struct {
					TimeMilliseconds uint64 `json:"timeMilliseconds"`
					Value            any    `json:"value"`
					EasingToNext     string `json:"easingToNext"`
				} `json:"keyframes"`
			} `json:"tracks"`
		}
		if err := json.Unmarshal(def.Flow.Timelines[id], &timeline); err != nil || timeline.ID != id {
			return nil, ErrV2RuntimeDefinition
		}
		owner, err := v2ResourceOwner(timeline.Owner)
		if err != nil {
			return nil, err
		}
		projected := &presentationv2.ProjectedTimelineDefinition{TimelineId: id, Owner: owner, DurationMs: timeline.DurationMilliseconds}
		for _, track := range timeline.Tracks {
			property := map[string]presentationv2.TimelineProperty{"opacity": presentationv2.TimelineProperty_TIMELINE_PROPERTY_OPACITY, "transform.position": presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_POSITION, "transform.rotation": presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_ROTATION, "transform.scale": presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_SCALE}[track.Target.Property]
			if property == 0 {
				return nil, ErrV2RuntimeDefinition
			}
			p := &presentationv2.ProjectedTimelineTrack{Target: &presentationv2.TimelineTrackTarget{NodeId: track.Target.NodeID, Property: property}}
			for _, key := range track.Keyframes {
				frame := &presentationv2.TimelineKeyframe{TimeMs: key.TimeMilliseconds}
				if value, ok := key.Value.(float64); ok && property == presentationv2.TimelineProperty_TIMELINE_PROPERTY_OPACITY {
					frame.Value = &presentationv2.TimelineKeyframe_Number{Number: &presentationv2.NumberKeyframeValue{Value: value}}
				} else if values, ok := key.Value.([]any); ok {
					numbers := make([]float64, len(values))
					for i, value := range values {
						var valid bool
						numbers[i], valid = value.(float64)
						if !valid {
							return nil, ErrV2RuntimeDefinition
						}
					}
					switch {
					case (property == presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_POSITION || property == presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_SCALE) && len(numbers) == 3:
						frame.Value = &presentationv2.TimelineKeyframe_Vector3{Vector3: &presentationv2.Vector3KeyframeValue{Value: &presentationv2.Vector3{X: numbers[0], Y: numbers[1], Z: numbers[2]}}}
					case property == presentationv2.TimelineProperty_TIMELINE_PROPERTY_TRANSFORM_ROTATION && len(numbers) == 4:
						frame.Value = &presentationv2.TimelineKeyframe_Quaternion{Quaternion: &presentationv2.QuaternionKeyframeValue{Value: &presentationv2.Quaternion{X: numbers[0], Y: numbers[1], Z: numbers[2], W: numbers[3]}}}
					default:
						return nil, ErrV2RuntimeDefinition
					}
				} else {
					return nil, ErrV2RuntimeDefinition
				}
				p.Keyframes = append(p.Keyframes, frame)
			}
			projected.Tracks = append(projected.Tracks, p)
		}
		catalog.Timelines = append(catalog.Timelines, projected)
	}
	if err := protocolv2.ValidateMessage(catalog); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrV2RuntimeDefinition, err)
	}
	return catalog, nil
}

func v2ResourceOwner(owner v2Owner) (*presentationv2.ResourceOwner, error) {
	switch owner.Kind {
	case "presentation":
		return &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}, nil
	case "group":
		if owner.GroupID != "" {
			return &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Group{Group: &presentationv2.GroupResourceOwner{GroupId: owner.GroupID}}}, nil
		}
	}
	return nil, ErrV2RuntimeDefinition
}
