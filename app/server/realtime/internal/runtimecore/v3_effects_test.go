package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocol "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"testing"
)

func effectDefinition() json.RawMessage {
	return json.RawMessage(`{"schemaVersion":1,"presentationId":"effects","scene":{"nodes":{"target":{"id":"target","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]},"second":{"id":"second","cues":[]}}}}},"variables":{},"timelines":{}}`)
}
func effectCue(kind string) v2Cue {
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"start-effect","actions":[{"kind":"effect.start","effectId":"demo","nodeId":"target","owner":{"kind":"group","groupId":"intro"},"seed":17,"effect":{"kind":"`+kind+`","size":1,"color":{"red":1,"green":0.5,"blue":0,"alpha":1},"speed":1,"durationMilliseconds":1000,"waveCycles":0.5}}],"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`), &cue)
	if kind != "wave" {
		cue.Actions[0].Effect.WaveCycles = 0
	}
	return cue
}
func TestEffectCueCreatesReplayableRun(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	_, reject, err := s.applySelectedV2Cue(effectCue("wave"), "event-1")
	if err != nil || reject != nil {
		t.Fatalf("start: %v %v", err, reject)
	}
	if len(s.snapshot.EffectRuns) != 1 || s.snapshot.EffectRuns[0].Seed != 17 {
		t.Fatal("run or seed absent")
	}
	if _, err := s.AdvanceTo(context.Background(), 1000); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshot.EffectRuns) != 1 || s.snapshot.EffectRuns[0].Status != realtime.EffectRunStatus_EFFECT_RUN_STATUS_RETAINED {
		t.Fatal("wave must retain its run after drawing")
	}
	var stop v2Cue
	_ = json.Unmarshal([]byte(`{"id":"stop","actions":[{"kind":"effect.stop","effectId":"demo"}],"next":{"kind":"stay"}}`), &stop)
	if _, reject, err = s.applySelectedV2Cue(stop, "event-2"); err != nil || reject != nil {
		t.Fatalf("stop: %v %v", err, reject)
	}
	if len(s.snapshot.EffectRuns) != 0 {
		t.Fatal("stopped run retained")
	}
}
func TestDissolveCompletionHidesAndStepRestoreRecoversNode(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	if _, reject, err := s.applySelectedV2Cue(effectCue("dissolve"), "event-1"); err != nil || reject != nil {
		t.Fatalf("start: %v %v", err, reject)
	}
	if _, err := s.AdvanceTo(context.Background(), 1000); err != nil {
		t.Fatal(err)
	}
	if s.snapshot.NodeStates[0].Visible {
		t.Fatal("completed dissolve must hide target")
	}
	if err := s.restoreV3Step(s.snapshot.StepStartHistory[0]); err != nil {
		t.Fatal(err)
	}
	if !s.snapshot.NodeStates[0].Visible {
		t.Fatal("Step start must restore visibility")
	}
}

func TestGestureEffectDeduplicatesAndRestoresFromCheckpoint(t *testing.T) {
	var root map[string]any
	if err := json.Unmarshal(effectDefinition(), &root); err != nil {
		t.Fatal(err)
	}
	var cue map[string]any
	raw, _ := json.Marshal(effectCue("wave"))
	if err := json.Unmarshal(raw, &cue); err != nil {
		t.Fatal(err)
	}
	delete(cue, "guard")
	cue["trigger"] = map[string]any{"kind": "gesture", "gesture": "throw", "actor": map[string]any{"kind": "presenter"}}
	flow := root["flow"].(map[string]any)
	groups := flow["groups"].(map[string]any)
	steps := groups["intro"].(map[string]any)["steps"].(map[string]any)
	steps["start"].(map[string]any)["cues"] = []any{cue}
	raw, _ = json.Marshal(root)
	s, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(raw)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtime.DurableCheckpointEnvelope{SchemaVersion: 1, SessionId: "session", RuntimeId: "runtime", RuntimeKind: realtime.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentation.PublicationFence{PresentationId: "effects", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	writer := &recordingV2Checkpoint{}
	if err := s.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := &realtime.GestureInputCommand{ClientEventId: v3TestEventID("throw"), CommandEpoch: 1, InputContext: v3TestInput(s, "throw"), Gesture: presentation.GestureKind_GESTURE_KIND_THROW}
	first, events, err := s.GestureInputContext(context.Background(), identity, command)
	if err != nil || first.GetAccepted().GetCueCommitted() == nil || len(s.snapshot.EffectRuns) != 1 {
		t.Fatalf("gesture cue: %v %v", first, err)
	}
	duplicate, repeated, err := s.GestureInputContext(context.Background(), identity, command)
	if err != nil || !proto.Equal(first, duplicate) || len(repeated) != 0 || len(s.snapshot.EffectRuns) != 1 {
		t.Fatal("duplicate created another effect")
	}
	replay, err := s.Replay(0)
	if err != nil || len(replay) != len(events) {
		t.Fatalf("replay: %v", err)
	}
	if err := protocol.ValidateSnapshot(s.snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	flushV2(t, s)
	decoded, err := protocol.DecodeCheckpoint(writer.envelope, metadata, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(decoded.EffectRuns[0], s.snapshot.EffectRuns[0]) {
		t.Fatal("checkpoint changed effect")
	}
}
func TestEffectPauseGroupExitAndRestore(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.applySelectedV2Cue(effectCue("wave"), "event"); err != nil {
		t.Fatal(err)
	}
	s.snapshot.Clock.Status = &realtime.RuntimeClockSnapshot_Paused{Paused: &realtime.Paused{Reason: realtime.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE}}
	if _, err := s.AdvanceTo(context.Background(), 5000); err != nil {
		t.Fatal(err)
	}
	if s.snapshot.Clock.RuntimeTimeMs != 0 || s.snapshot.EffectRuns[0].Status != 1 {
		t.Fatal("paused clock advanced effect")
	}
	s.snapshot.Clock.Status = &realtime.RuntimeClockSnapshot_Running{Running: &realtime.Running{}}
	if _, err := s.enterV2Step("second"); err != nil {
		t.Fatal(err)
	}
	entry := s.snapshot.StepStartHistory[1]
	if entry.StepId != "second" {
		entry = s.snapshot.StepStartHistory[0]
	}
	if _, err := s.AdvanceTo(context.Background(), 2000); err != nil {
		t.Fatal(err)
	}
	oldID := proto.Clone(s.snapshot.EffectRuns[0].RunId)
	if err := s.restoreV3Step(entry); err != nil {
		t.Fatal(err)
	}
	if s.snapshot.EffectRuns[0].StartedAtRuntimeTimeMs != 2000 || proto.Equal(oldID, s.snapshot.EffectRuns[0].RunId) {
		t.Fatal("restored effect clock/id not rebased")
	}
	// Reentering the Group releases Group-owned runs.
	if _, err := s.enterV2Group("intro"); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshot.EffectRuns) != 0 {
		t.Fatal("Group exit retained effect")
	}
}

func TestEffectBatchRejectionDoesNotMutateSnapshot(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	cue := effectCue("wave")
	cue.Actions = append(cue.Actions, cue.Actions[0])
	before := proto.Clone(s.snapshot)
	if _, rejection, err := s.applySelectedV2Cue(cue, "event"); err != nil || rejection == nil {
		t.Fatalf("duplicate effect action: %v %v", rejection, err)
	}
	if !proto.Equal(before, s.snapshot) {
		t.Fatal("rejected batch changed snapshot")
	}
}
func TestEffectSnapshotRejectsInvalidRunClosure(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.applySelectedV2Cue(effectCue("wave"), "event"); err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*realtime.CanonicalRuntimeSnapshot){
		func(v *realtime.CanonicalRuntimeSnapshot) { v.EffectRuns[0].NodeId = "absent" },
		func(v *realtime.CanonicalRuntimeSnapshot) { v.EffectRuns[0].RunId.AssignmentEpoch = 2 },
		func(v *realtime.CanonicalRuntimeSnapshot) {
			v.EffectRuns[0].Status = realtime.EffectRunStatus_EFFECT_RUN_STATUS_RETAINED
		},
		func(v *realtime.CanonicalRuntimeSnapshot) { v.EffectRuns[0].Configuration.Size = 0 },
		func(v *realtime.CanonicalRuntimeSnapshot) { v.EffectRuns[0].Configuration.Size = 1e300 },
		func(v *realtime.CanonicalRuntimeSnapshot) { v.EffectRuns[0].Configuration.Speed = 1e-300 },
		func(v *realtime.CanonicalRuntimeSnapshot) {
			v.EffectRuns[0].Configuration.Kind = presentation.EffectKind_EFFECT_KIND_HAND_GLOW
		},
	} {
		snapshot := proto.Clone(s.snapshot).(*realtime.CanonicalRuntimeSnapshot)
		mutate(snapshot)
		if err := protocol.ValidateSnapshot(snapshot, catalog, 1); err == nil {
			t.Fatal("invalid effect snapshot admitted")
		}
	}
}

func TestEffectCapacityRejectsWithoutChangingExistingRuns(t *testing.T) {
	s, err := newV3RegressionSession(effectDefinition())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 32; i++ {
		cue := effectCue("wave")
		cue.Actions[0].EffectID = fmt.Sprintf("wave-%02d", i)
		if _, reject, err := s.applySelectedV2Cue(cue, "event"); err != nil || reject != nil {
			t.Fatalf("start %d: %v %v", i, reject, err)
		}
	}
	before := proto.Clone(s.snapshot)
	if _, reject, err := s.applySelectedV2Cue(effectCue("wave"), "event"); err != nil || reject == nil {
		t.Fatalf("capacity: %v %v", reject, err)
	}
	if !proto.Equal(before, s.snapshot) {
		t.Fatal("capacity rejection changed existing effects")
	}
}

func TestEffectEventRequiresProjectionCapability(t *testing.T) {
	event := &realtime.ProjectedReliableEvent{Payload: &realtime.ProjectedReliableEvent_EffectRunsChanged{EffectRunsChanged: &realtime.EffectRunsChanged{EffectRuns: []*realtime.EffectRunSnapshot{{NodeId: "target"}, {NodeId: "hidden"}}}}}
	profile := &delivery.ProjectionProfileDescriptor{VisibleNodeIds: []string{"target"}, RuntimeCatalog: &presentation.ProjectedRuntimeCatalog{}}
	if _, visible := ProjectV2ReliableEvent(event, profile); visible {
		t.Fatal("effect event sent to projection without effect support")
	}
	profile.RequiredRuntimeCapabilities = []presentation.RuntimeCapability{11}
	projected, visible := ProjectV2ReliableEvent(event, profile)
	if !visible || len(projected.GetEffectRunsChanged().EffectRuns) != 1 || projected.GetEffectRunsChanged().EffectRuns[0].NodeId != "target" {
		t.Fatal("effect projection did not filter runs to visible targets")
	}
	event.GetEffectRunsChanged().EffectRuns = nil
	projected, visible = ProjectV2ReliableEvent(event, profile)
	if !visible || projected.GetEffectRunsChanged() == nil || len(projected.GetEffectRunsChanged().EffectRuns) != 0 {
		t.Fatal("effect-capable projection must receive an empty replacement to clear previous runs")
	}
}
