package runtimecore

import (
	"encoding/json"
	"math"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

type v2Reference struct {
	Kind       string `json:"kind"`
	VariableID string `json:"variableId"`
	Field      string `json:"field"`
	SurfaceID  string `json:"surfaceId"`
	NodeID     string `json:"nodeId"`
	Value      any    `json:"value"`
}
type v2Guard struct {
	Kind     string      `json:"kind"`
	Guards   []v2Guard   `json:"guards"`
	Guard    *v2Guard    `json:"guard"`
	Left     v2Reference `json:"left"`
	Operator string      `json:"operator"`
	Right    any         `json:"right"`
}

func v2GuardPasses(cue v2Cue, pre *realtimev2.CanonicalRuntimeSnapshot, payload map[string]any) bool {
	if len(cue.Guard) == 0 {
		return true
	}
	var guard v2Guard
	if json.Unmarshal(cue.Guard, &guard) != nil {
		return false
	}
	if cue.FixedPayload != nil {
		payload = cue.FixedPayload
	}
	return evaluateV2Guard(guard, pre, payload)
}
func evaluateV2Guard(guard v2Guard, pre *realtimev2.CanonicalRuntimeSnapshot, payload map[string]any) bool {
	switch guard.Kind {
	case "all":
		for _, child := range guard.Guards {
			if !evaluateV2Guard(child, pre, payload) {
				return false
			}
		}
		return true
	case "any":
		for _, child := range guard.Guards {
			if evaluateV2Guard(child, pre, payload) {
				return true
			}
		}
		return false
	case "not":
		return guard.Guard != nil && !evaluateV2Guard(*guard.Guard, pre, payload)
	case "compare":
		left, ok := v2ReferenceValue(guard.Left, pre, payload)
		if !ok {
			return false
		}
		if left == nil && guard.Right == nil {
			return guard.Operator == "eq"
		}
		if left == nil || guard.Right == nil {
			return false
		}
		switch l := left.(type) {
		case string:
			r, ok := guard.Right.(string)
			if !ok {
				return false
			}
			if guard.Operator == "eq" {
				return l == r
			}
			return guard.Operator == "neq" && l != r
		case bool:
			r, ok := guard.Right.(bool)
			if !ok {
				return false
			}
			if guard.Operator == "eq" {
				return l == r
			}
			return guard.Operator == "neq" && l != r
		case float64:
			r, ok := guard.Right.(float64)
			if !ok {
				return false
			}
			switch guard.Operator {
			case "eq":
				return l == r
			case "neq":
				return l != r
			case "gt":
				return l > r
			case "gte":
				return l >= r
			case "lt":
				return l < r
			case "lte":
				return l <= r
			}
		}
	}
	return false
}
func v2ReferenceValue(ref v2Reference, pre *realtimev2.CanonicalRuntimeSnapshot, payload map[string]any) (any, bool) {
	switch ref.Kind {
	case "literal":
		return ref.Value, true
	case "eventPayload":
		v, ok := payload[ref.Field]
		return v, ok
	case "variable":
		for _, state := range pre.Variables {
			if state.VariableId == ref.VariableID {
				switch x := state.Value.Value.(type) {
				case *presentationv2.ScalarValue_StringValue:
					return x.StringValue, true
				case *presentationv2.ScalarValue_NumberValue:
					return x.NumberValue, true
				case *presentationv2.ScalarValue_BooleanValue:
					return x.BooleanValue, true
				case *presentationv2.ScalarValue_NullValue:
					return nil, true
				}
			}
		}
	case "surfaceState":
		for _, state := range pre.SurfaceStates {
			if state.SurfaceId == ref.SurfaceID {
				return state.StateId, true
			}
		}
	case "nodeField":
		for _, state := range pre.NodeStates {
			if state.NodeId == ref.NodeID {
				switch ref.Field {
				case "active":
					return state.Active, true
				case "visible":
					return state.Visible, true
				case "opacity":
					return state.Opacity, true
				}
			}
		}
	}
	return nil, false
}
func v2ActionValue(raw json.RawMessage, pre *realtimev2.CanonicalRuntimeSnapshot, payload map[string]any) (any, bool) {
	var ref v2Reference
	if json.Unmarshal(raw, &ref) != nil {
		return nil, false
	}
	return v2ReferenceValue(ref, pre, payload)
}
func v2ScalarValue(kind string, value any) (*presentationv2.ScalarValue, bool) {
	switch kind {
	case "string":
		v, ok := value.(string)
		if ok {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_StringValue{StringValue: v}}, true
		}
	case "number":
		v, ok := value.(float64)
		if ok && !math.IsNaN(v) && !math.IsInf(v, 0) {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NumberValue{NumberValue: v}}, true
		}
	case "boolean":
		v, ok := value.(bool)
		if ok {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_BooleanValue{BooleanValue: v}}, true
		}
	case "null":
		if value == nil {
			return &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NullValue{NullValue: &presentationv2.NullScalar{}}}, true
		}
	}
	return nil, false
}
func evaluateV2Actions(def v2Definition, pre *realtimev2.CanonicalRuntimeSnapshot, cue v2Cue, payload map[string]any) (*realtimev2.CanonicalRuntimeSnapshot, []*realtimev2.ProjectedReliableEvent, *realtimev2.CueBatchRejected, error) {
	return evaluateV2ActionsWithMedia(def, pre, cue, payload, nil)
}

func evaluateV2ActionsWithMedia(def v2Definition, pre *realtimev2.CanonicalRuntimeSnapshot, cue v2Cue, payload map[string]any, mediaSpecs map[string]map[string]v2MediaSpec) (*realtimev2.CanonicalRuntimeSnapshot, []*realtimev2.ProjectedReliableEvent, *realtimev2.CueBatchRejected, error) {
	if cue.FixedPayload != nil {
		payload = cue.FixedPayload
	}
	next := proto.Clone(pre).(*realtimev2.CanonicalRuntimeSnapshot)
	events := make([]*realtimev2.ProjectedReliableEvent, 0, len(cue.Actions))
	claims := map[string]bool{}
	reject := func(reason realtimev2.CueRejectionReason) (*realtimev2.CanonicalRuntimeSnapshot, []*realtimev2.ProjectedReliableEvent, *realtimev2.CueBatchRejected, error) {
		return pre, nil, &realtimev2.CueBatchRejected{CueId: cue.ID, Reason: reason}, nil
	}
	invalid := realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID
	conflict := realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT
	for _, action := range cue.Actions {
		switch action.Kind {
		case "surface.setState":
			if len(action.Transition) != 0 && v2TransitionKind(action.Transition) != "cut" {
				return nil, nil, nil, ErrV2RuntimeUnsupported
			}
			key := "surface:" + action.SurfaceID
			if claims[key] {
				return reject(conflict)
			}
			claims[key] = true
			surface, ok := def.Scene.Surfaces[action.SurfaceID]
			if !ok || surface.States[action.StateID] == nil {
				return reject(invalid)
			}
			var target *realtimev2.SurfaceRuntimeState
			for _, state := range next.SurfaceStates {
				if state.SurfaceId == action.SurfaceID {
					target = state
					break
				}
			}
			if target == nil {
				return reject(invalid)
			}
			old := target.StateId
			if old == action.StateID {
				continue
			}
			if old != action.StateID && mediaRun(next, action.SurfaceID) != nil {
				spec, ok := mediaSpecs[action.SurfaceID][old]
				if !ok {
					return nil, nil, nil, ErrV2RuntimeDefinition
				}
				stopped, rejected, err := applyV2MediaCommand(next, spec, v2MediaCommand{Kind: "media.stop"}, nil, 0)
				if err != nil {
					return nil, nil, nil, err
				}
				if rejected {
					return reject(invalid)
				}
				events = append(events, stopped...)
			}
			target.StateId = action.StateID
			events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_SurfaceStateChanged{SurfaceStateChanged: &realtimev2.SurfaceStateChanged{SurfaceId: action.SurfaceID, FromStateId: old, StateId: action.StateID}}})
		case "variable.set":
			key := "variable:" + action.VariableID
			if claims[key] {
				return reject(conflict)
			}
			claims[key] = true
			variable, ok := def.Flow.Variables[action.VariableID]
			if !ok {
				return reject(invalid)
			}
			var target *realtimev2.VariableState
			for _, state := range next.Variables {
				if state.VariableId == action.VariableID {
					target = state
					break
				}
			}
			if target == nil {
				return reject(invalid)
			}
			value, ok := v2ActionValue(action.Value, pre, payload)
			if !ok {
				return reject(invalid)
			}
			scalar, ok := v2ScalarValue(variable.Type, value)
			if !ok {
				return reject(invalid)
			}
			target.Value = scalar
			events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_VariableChanged{VariableChanged: &realtimev2.VariableChanged{State: proto.Clone(target).(*realtimev2.VariableState)}}})
		case "node.patch":
			var target *realtimev2.NodeRuntimeState
			for _, state := range next.NodeStates {
				if state.NodeId == action.NodeID {
					target = state
					break
				}
			}
			if target == nil {
				return reject(invalid)
			}
			if len(action.Patch) == 0 {
				return reject(invalid)
			}
			for field, raw := range action.Patch {
				key := "node:" + action.NodeID + ":" + field
				if claims[key] {
					return reject(conflict)
				}
				claims[key] = true
				switch field {
				case "active", "visible":
					v, ok := v2ActionValue(raw, pre, payload)
					if !ok {
						return reject(invalid)
					}
					b, ok := v.(bool)
					if !ok {
						return reject(invalid)
					}
					if field == "active" {
						target.Active = b
					} else {
						target.Visible = b
					}
				case "opacity":
					v, ok := v2ActionValue(raw, pre, payload)
					if !ok {
						return reject(invalid)
					}
					f, ok := v.(float64)
					if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 1 {
						return reject(invalid)
					}
					target.Opacity = f
				case "transform":
					var transform struct {
						Position [3]float64 `json:"position"`
						Rotation [4]float64 `json:"rotation"`
						Scale    [3]float64 `json:"scale"`
					}
					if json.Unmarshal(raw, &transform) != nil {
						return reject(invalid)
					}
					target.Transform = &presentationv2.Transform{Position: &presentationv2.Vector3{X: transform.Position[0], Y: transform.Position[1], Z: transform.Position[2]}, Rotation: &presentationv2.Quaternion{X: transform.Rotation[0], Y: transform.Rotation[1], Z: transform.Rotation[2], W: transform.Rotation[3]}, Scale: &presentationv2.Vector3{X: transform.Scale[0], Y: transform.Scale[1], Z: transform.Scale[2]}}
				default:
					return nil, nil, nil, ErrV2RuntimeUnsupported
				}
			}
			events = append(events, &realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_NodeStateCommitted{NodeStateCommitted: &realtimev2.NodeStateCommitted{State: proto.Clone(target).(*realtimev2.NodeRuntimeState)}}})
		default:
			return nil, nil, nil, ErrV2RuntimeUnsupported
		}
	}
	return next, events, nil, nil
}
