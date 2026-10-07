package runtimecore

import (
	"context"
	"encoding/json"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"math"
	"strings"
	"testing"
)

func TestV2RepeatableCueRespectsCooldown(t *testing.T) {
	s, _ := reviewSession(t)
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"repeat","trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable","cooldownMilliseconds":100},"next":{"kind":"stay"}}`), &cue)
	g := s.definition.Flow.Groups["intro"]
	st := g.Steps["start"]
	st.Cues = []v2Cue{cue}
	g.Steps["start"] = st
	s.definition.Flow.Groups["intro"] = g
	for i, id := range []string{"first", "second"} {
		out, _, err := s.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "p"}, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: "next"})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 && out.GetAccepted().GetCueCommitted() == nil || i == 1 && out.GetAccepted().GetCueNotSelected() == nil {
			t.Fatalf("cooldown outcome %v", out)
		}
	}
}
func TestV2LeaveFailureReleasesPresence(t *testing.T) {
	s, _ := reviewSession(t)
	id := session.Identity{ParticipantID: "p", Role: session.RoleViewer}
	if err := s.JoinParticipant(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	s.checkpointWriter = failingV2Checkpoint{}
	if err := s.LeaveParticipant(context.Background(), id); err == nil {
		t.Fatal("expected persistence failure")
	}
	_, presence, _, closeSub := s.SnapshotPresenceAndSubscribe()
	defer closeSub()
	if len(presence.Participants) != 0 {
		t.Fatal("disconnected participant still present")
	}
}

func timelinePolicySession(t *testing.T) *V2Session {
	t.Helper()
	s, _ := reviewSession(t)
	s.snapshot.NodeStates = []*realtimev2.NodeRuntimeState{{NodeId: "node", Transform: policyTransform()}}
	s.definition.Flow.Timelines["one"] = json.RawMessage(`{"id":"one","owner":{"kind":"presentation"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"node","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}`)
	s.definition.Flow.Timelines["two"] = json.RawMessage(`{"id":"two","owner":{"kind":"presentation"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"node","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}`)
	return s
}
func TestV2TimelineStopCommitsCurrentValueAndRejectsOverlap(t *testing.T) {
	s := timelinePolicySession(t)
	cue := v2Cue{ID: "play", Actions: []v2Action{{Kind: "timeline.play", TimelineID: "one", Completion: "nonBlocking"}}}
	_, _, reject, err := s.evaluateV2RunActions(s.snapshot, cue, "event-1")
	if err != nil || reject != nil {
		t.Fatalf("play %v %v", reject, err)
	}
	cue.Actions[0].TimelineID = "two"
	_, _, reject, err = s.evaluateV2RunActions(s.snapshot, cue, "event-2")
	if err != nil || reject == nil {
		t.Fatalf("overlap %v %v", reject, err)
	}
	s.snapshot.Clock.RuntimeTimeMs = 50
	cue.Actions = []v2Action{{Kind: "timeline.stop", TimelineID: "one"}}
	events, _, reject, err := s.evaluateV2RunActions(s.snapshot, cue, "event-3")
	if err != nil || reject != nil || len(s.snapshot.ActiveRuns) != 0 || s.snapshot.NodeStates[0].Opacity != 0.5 || len(events) != 2 || events[0].GetTimelineCanceled() == nil {
		t.Fatalf("stop events=%v reject=%v err=%v state=%v", events, reject, err, s.snapshot)
	}
	events, _, reject, err = s.evaluateV2RunActions(s.snapshot, cue, "event-4")
	if err != nil || reject != nil || len(events) != 0 {
		t.Fatal("inactive stop was not a no-op")
	}
}
func TestV2TimelineCompletionSelectsStableCueWithCompletionCause(t *testing.T) {
	s := timelinePolicySession(t)
	s.checkpointWriter = nil
	play := v2Cue{ID: "play", Actions: []v2Action{{Kind: "timeline.play", TimelineID: "one", Completion: "nonBlocking"}}}
	_, _, _, err := s.evaluateV2RunActions(s.snapshot, play, "event-1")
	if err != nil {
		t.Fatal(err)
	}
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"follow","trigger":{"kind":"timelineCompleted","timelineId":"one"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"two","completion":"nonBlocking"}],"next":{"kind":"stay"}}`), &cue)
	g := s.definition.Flow.Groups["intro"]
	st := g.Steps["start"]
	st.Cues = []v2Cue{cue}
	g.Steps["start"] = st
	s.definition.Flow.Groups["intro"] = g
	events, err := s.AdvanceTo(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	completedID := ""
	for _, e := range events {
		if e.GetTimelineCompleted() != nil {
			completedID = e.EventId
		}
	}
	if len(s.snapshot.ActiveRuns) != 1 || s.snapshot.ActiveRuns[0].Cause.CauseEventId != completedID || completedID == "" {
		t.Fatalf("completion cause events=%v snapshot=%v", events, s.snapshot)
	}
}
func TestV2SemanticEventResolvesInteractionCatalog(t *testing.T) {
	s, _ := reviewSession(t)
	s.checkpointWriter = nil
	var surface v2Surface
	_ = json.Unmarshal([]byte(`{"id":"screen","hostNodeId":"host","interactions":{"tap":{"id":"tap","event":"trusted"}},"states":{"idle":{"enabledInteractionIds":["tap"]}}}`), &surface)
	s.definition.Scene.Surfaces["screen"] = surface
	var node v2Node
	_ = json.Unmarshal([]byte(`{"id":"host","owner":{"kind":"presentation"},"parent":{"kind":"stage"}}`), &node)
	s.definition.Scene.Nodes["host"] = node
	s.snapshot.NodeStates = []*realtimev2.NodeRuntimeState{{NodeId: "host", Transform: policyTransform(), Active: true, Visible: true}}
	s.snapshot.SurfaceStates = []*realtimev2.SurfaceRuntimeState{{SurfaceId: "screen", StateId: "idle"}}
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"semantic","trigger":{"kind":"semanticEvent","event":"trusted","actor":{"kind":"presenter"}},"firePolicy":{"kind":"oncePerStepEntry"},"next":{"kind":"stay"}}`), &cue)
	g := s.definition.Flow.Groups["intro"]
	st := g.Steps["start"]
	st.Cues = []v2Cue{cue}
	g.Steps["start"] = st
	s.definition.Flow.Groups["intro"] = g
	out, _, err := s.SurfaceInteraction(session.Identity{ParticipantID: "p", Role: session.RolePresenter}, &realtimev2.SurfaceInteractionCommand{ClientEventId: "tap", SurfaceId: "screen", InteractionId: "tap"})
	if err != nil || out.GetAccepted().GetCueCommitted().GetCueId() != "semantic" {
		t.Fatalf("semantic outcome=%v err=%v", out, err)
	}
}

func policyTransform() *presentationv2.Transform {
	return &presentationv2.Transform{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}, Scale: &presentationv2.Vector3{X: 1, Y: 1, Z: 1}}
}

func TestV2TimelineClaimsRejectStopAndPatchAtomically(t *testing.T) {
	s := timelinePolicySession(t)
	s.checkpointWriter = nil
	play := v2Cue{ID: "play", Actions: []v2Action{{Kind: "timeline.play", TimelineID: "one", Completion: "nonBlocking"}}}
	_, _, _, err := s.evaluateV2RunActions(s.snapshot, play, "event")
	if err != nil {
		t.Fatal(err)
	}
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"stop-patch","firePolicy":{"kind":"repeatable"},"actions":[{"kind":"timeline.stop","timelineId":"one"},{"kind":"node.patch","nodeId":"node","patch":{"opacity":{"kind":"literal","value":0.3}}}],"next":{"kind":"stay"}}`), &cue)
	events, reject, err := s.applySelectedV2Cue(cue, "event")
	if err != nil || reject == nil || len(events) != 0 || len(s.snapshot.ActiveRuns) != 1 || s.snapshot.NodeStates[0].Opacity != 0 || len(s.snapshot.StepExecution.Cooldowns) != 0 {
		t.Fatalf("conflicting batch events=%v reject=%v err=%v", events, reject, err)
	}
}
func TestV2TimelineInterpolationUsesEasingAndQuaternionShortestArc(t *testing.T) {
	for _, tc := range []struct {
		property, from, to, easing string
		want                       float64
	}{
		{"opacity", "0", "1", "cubicIn", 0.125},
		{"transform.position", "[0,0,0]", "[8,0,0]", "cubicOut", 7},
		{"transform.rotation", "[0,0,0,1]", "[0,0,0,-1]", "linear", 1},
	} {
		t.Run(tc.property, func(t *testing.T) {
			var timeline v2Timeline
			raw := `{"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"node","property":"` + tc.property + `"},"keyframes":[{"timeMilliseconds":0,"value":` + tc.from + `,"easingToNext":"` + tc.easing + `"},{"timeMilliseconds":100,"value":` + tc.to + `}]}]}`
			if err := json.Unmarshal([]byte(raw), &timeline); err != nil {
				t.Fatal(err)
			}
			state := &realtimev2.NodeRuntimeState{NodeId: "node", Transform: policyTransform()}
			snapshot := &realtimev2.CanonicalRuntimeSnapshot{NodeStates: []*realtimev2.NodeRuntimeState{state}}
			if err := applyV2TimelineAt(snapshot, timeline, 50); err != nil {
				t.Fatal(err)
			}
			value := state.Opacity
			if tc.property == "transform.position" {
				value = state.Transform.Position.X
			}
			if tc.property == "transform.rotation" {
				value = state.Transform.Rotation.W
			}
			if value != tc.want {
				t.Fatalf("interpolated %g, want %g", value, tc.want)
			}
		})
	}
}
func TestV2EnabledInputsFilterPolicyAndSystemActors(t *testing.T) {
	s, _ := reviewSession(t)
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"next","trigger":{"kind":"logicalInput","action":"next","actor":{"kind":"presenter"}},"firePolicy":{"kind":"repeatable"}}`), &cue)
	g := s.definition.Flow.Groups["intro"]
	st := g.Steps["start"]
	st.Cues = []v2Cue{cue}
	g.Steps["start"] = st
	s.definition.Flow.Groups["intro"] = g
	if names := s.EnabledLogicalInputs(s.snapshot); len(names) != 1 || names[0] != "next" {
		t.Fatalf("inputs=%v", names)
	}
	s.snapshot.StepExecution.Cooldowns = []*realtimev2.CueCooldown{{CueId: "next", NextEligibleRuntimeTimeMs: 10}}
	if names := s.EnabledLogicalInputs(s.snapshot); len(names) != 0 {
		t.Fatalf("cooldown inputs=%v", names)
	}
	s.snapshot.Clock.RuntimeTimeMs = 10
	if names := s.EnabledLogicalInputs(s.snapshot); len(names) != 1 {
		t.Fatalf("deadline inputs=%v", names)
	}
	cue.Trigger.Actor.Kind = "system"
	st.Cues = []v2Cue{cue}
	g.Steps["start"] = st
	s.definition.Flow.Groups["intro"] = g
	if names := s.EnabledLogicalInputs(s.snapshot); len(names) != 0 {
		t.Fatalf("system inputs=%v", names)
	}
}

func TestV2QuaternionInterpolationCanonicalizesZero(t *testing.T) {
	var timeline v2Timeline
	_ = json.Unmarshal([]byte(`{"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"node","property":"transform.rotation"},"keyframes":[{"timeMilliseconds":0,"value":[-0.8,0,0,0.6],"easingToNext":"linear"},{"timeMilliseconds":100,"value":[0.8,0,0,0.6]}]}]}`), &timeline)
	node := &realtimev2.NodeRuntimeState{NodeId: "node", Transform: policyTransform()}
	if err := applyV2TimelineAt(&realtimev2.CanonicalRuntimeSnapshot{NodeStates: []*realtimev2.NodeRuntimeState{node}}, timeline, 75); err != nil {
		t.Fatal(err)
	}
	q := node.Transform.Rotation
	if q.W < 0 || math.Signbit(q.Y) || math.Signbit(q.Z) {
		t.Fatalf("noncanonical quaternion %v", q)
	}
}
func TestV2SameStateCutHasNoSurfaceEvent(t *testing.T) {
	s, _ := reviewSession(t)
	var surface v2Surface
	_ = json.Unmarshal([]byte(`{"id":"screen","states":{"idle":{"enabledInteractionIds":[]}}}`), &surface)
	s.definition.Scene.Surfaces["screen"] = surface
	s.snapshot.SurfaceStates = []*realtimev2.SurfaceRuntimeState{{SurfaceId: "screen", StateId: "idle"}}
	cue := v2Cue{ID: "cut", Actions: []v2Action{{Kind: "surface.setState", SurfaceID: "screen", StateID: "idle"}}}
	next, events, rejection, err := evaluateV2ActionsWithMedia(s.definition, s.snapshot, cue, nil, nil)
	if err != nil || rejection != nil || len(events) != 0 || next.SurfaceStates[0].StateId != "idle" {
		t.Fatalf("same-state cut events=%v rejection=%v err=%v", events, rejection, err)
	}
}

func TestV2GroupExitCommitsTimelineValueToPresentationNode(t *testing.T) {
	s := timelinePolicySession(t)
	raw := strings.ReplaceAll(string(s.definition.Flow.Timelines["one"]), `"kind":"presentation"`, `"kind":"group","groupId":"intro"`)
	s.definition.Flow.Timelines["one"] = json.RawMessage(raw)
	var node v2Node
	_ = json.Unmarshal([]byte(`{"id":"node","owner":{"kind":"presentation"},"parent":{"kind":"stage"}}`), &node)
	s.definition.Scene.Nodes["node"] = node
	var root map[string]json.RawMessage
	_ = json.Unmarshal(s.rawDefinition, &root)
	var flow map[string]json.RawMessage
	_ = json.Unmarshal(root["flow"], &flow)
	var groups map[string]json.RawMessage
	_ = json.Unmarshal(flow["groups"], &groups)
	groups["next"] = json.RawMessage(`{"id":"next","initialStepId":"next-step","steps":{"next-step":{"id":"next-step","cues":[]}}}`)
	flow["groups"], _ = json.Marshal(groups)
	root["flow"], _ = json.Marshal(flow)
	s.rawDefinition, _ = json.Marshal(root)
	definition := s.definition
	_ = json.Unmarshal(s.rawDefinition, &definition)
	s.definition.Flow.Groups["next"] = definition.Flow.Groups["next"]
	cue := v2Cue{ID: "play", Actions: []v2Action{{Kind: "timeline.play", TimelineID: "one", Completion: "nonBlocking"}}}
	_, _, _, err := s.evaluateV2RunActions(s.snapshot, cue, "event")
	if err != nil {
		t.Fatal(err)
	}
	s.snapshot.Clock.RuntimeTimeMs = 50
	events, err := s.enterV2Group("next")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range events {
		if committed := event.GetNodeStateCommitted(); committed != nil && committed.State.NodeId == "node" && committed.State.Opacity == 0.5 {
			found = true
		}
	}
	if !found || s.snapshot.NodeStates[0].Opacity != 0.5 {
		t.Fatalf("group exit events=%v snapshot=%v", events, s.snapshot)
	}
}
