package runtimecore

import (
	"encoding/json"
	"testing"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func TestV2ImmediateActionsAreAtomicAndUsePreEventValues(t *testing.T) {
	var def v2Definition
	if err := json.Unmarshal([]byte(`{"scene":{"nodes":{"n":{"id":"n","kind":"container","owner":{"kind":"presentation"}}},"surfaces":{"s":{"id":"s","hostNodeId":"n","states":{"old":{},"new":{}}}}},"flow":{"variables":{"v":{"id":"v","type":"boolean","owner":{"kind":"presentation"}}}}}`), &def); err != nil {
		t.Fatal(err)
	}
	pre := &realtimev2.CanonicalRuntimeSnapshot{NodeStates: []*realtimev2.NodeRuntimeState{{NodeId: "n", Active: true, Visible: true, Opacity: 1}}, SurfaceStates: []*realtimev2.SurfaceRuntimeState{{SurfaceId: "s", StateId: "old"}}, Variables: []*realtimev2.VariableState{{VariableId: "v"}}}
	var cue v2Cue
	if err := json.Unmarshal([]byte(`{"id":"cue","guard":{"kind":"compare","left":{"kind":"eventPayload","field":"accepted"},"operator":"eq","right":true},"actions":[{"kind":"variable.set","variableId":"v","value":{"kind":"eventPayload","field":"accepted"}},{"kind":"surface.setState","surfaceId":"s","stateId":"new"},{"kind":"node.patch","nodeId":"n","patch":{"visible":{"kind":"literal","value":false}}}]}`), &cue); err != nil {
		t.Fatal(err)
	}
	if !v2GuardPasses(cue, pre, map[string]any{"accepted": true}) || v2GuardPasses(cue, pre, map[string]any{"accepted": false}) {
		t.Fatal("guard semantics")
	}
	next, events, rejection, err := evaluateV2Actions(def, pre, cue, map[string]any{"accepted": true})
	if err != nil || rejection != nil || len(events) != 3 {
		t.Fatalf("action result: %v %#v %#v", err, rejection, events)
	}
	if pre.SurfaceStates[0].StateId != "old" || !pre.NodeStates[0].Visible {
		t.Fatal("pre-state mutated")
	}
	if next.SurfaceStates[0].StateId != "new" || next.NodeStates[0].Visible || !next.Variables[0].Value.GetBooleanValue() {
		t.Fatal("next-state invalid")
	}
	cue.Actions = append(cue.Actions, v2Action{Kind: "surface.setState", SurfaceID: "missing", StateID: "new"})
	rejected, emitted, reason, err := evaluateV2Actions(def, pre, cue, map[string]any{"accepted": true})
	if err != nil || rejected != pre || len(emitted) != 0 || reason == nil {
		t.Fatalf("non-atomic reject: %v %#v %#v", err, rejected, reason)
	}
}

func TestV2ExplicitSurfaceCutIsImmediate(t *testing.T) {
	var def v2Definition
	if err := json.Unmarshal([]byte(`{"scene":{"surfaces":{"s":{"id":"s","states":{"old":{},"new":{}}}}}}`), &def); err != nil {
		t.Fatal(err)
	}
	var cue v2Cue
	if err := json.Unmarshal([]byte(`{"id":"cut","actions":[{"kind":"surface.setState","surfaceId":"s","stateId":"new","transition":{"kind":"cut"}}]}`), &cue); err != nil {
		t.Fatal(err)
	}
	pre := &realtimev2.CanonicalRuntimeSnapshot{SurfaceStates: []*realtimev2.SurfaceRuntimeState{{SurfaceId: "s", StateId: "old"}}}
	next, events, rejection, err := evaluateV2Actions(def, pre, cue, nil)
	if err != nil || rejection != nil || len(events) != 1 || next.SurfaceStates[0].StateId != "new" {
		t.Fatalf("cut next=%#v events=%#v rejection=%#v error=%v", next, events, rejection, err)
	}
}
