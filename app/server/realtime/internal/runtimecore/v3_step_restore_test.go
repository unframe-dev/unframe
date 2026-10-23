package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func TestV3SelectStepRestoresInitialStateAtomically(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"p","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"a","steps":{"a":{"id":"a","cues":[{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"b"}}]},"b":{"id":"b","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(core.Snapshot().StepStartHistory) != 1 {
		t.Fatal("initial entry not captured")
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	_, _, err = core.LogicalInputContext(context.Background(), identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "next", LogicalEventName: "next"}))
	if err != nil {
		t.Fatal(err)
	}
	before := core.Snapshot()
	outcome, events, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "select", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "g", StepId: "a"}}))
	if err != nil || outcome.GetAccepted() == nil {
		t.Fatalf("outcome=%v err=%v", outcome, err)
	}
	after := core.Snapshot()
	if after.Progression.CurrentStepId != "a" || after.Clock.GetPaused() == nil || after.Progression.StepEntryEpoch <= before.Progression.StepEntryEpoch || after.InputEpoch <= before.InputEpoch || len(after.StepExecution.ConsumedCueIds) != 0 {
		t.Fatalf("restored=%v", after)
	}
	if len(events) != 1 || events[0].GetRuntimeViewReplaced() == nil || events[0].GetRuntimeViewReplaced().RuntimeView.BaseReliableSequence != after.ReliableSequence {
		t.Fatalf("events=%v", events)
	}
	if len(after.StepStartHistory) != 2 || after.LastIngressSequence != before.LastIngressSequence {
		t.Fatal("history or ingress rewound")
	}
}

func TestV3RestoreContinuingRunsRebasesAllPlaybackAndDeadlines(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"panel":{"id":"panel","kind":"container","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":0},"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"play"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"fade","completion":"nonBlocking","conflict":"reject"},{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":2,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}},{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[{"id":"timer","trigger":{"kind":"timer","afterMilliseconds":30},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"group","groupId":"intro"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"panel","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":0,"durationMilliseconds":400}}}}}`)
	core, err := newV3RegressionSessionWithBundle(raw, bundle)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	metadata := &realtimev2.DurableCheckpointEnvelope{AssignmentEpoch: 1}
	core.checkpointMetadata = metadata
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	input := func(id, action string) {
		t.Helper()
		_, _, err := core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: action}))
		if err != nil {
			t.Fatal(err)
		}
	}
	input("play", "play")
	if _, err = core.AdvanceTo(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	input("next", "next")
	if _, err = core.AdvanceTo(context.Background(), 80); err != nil {
		t.Fatal(err)
	}
	before := core.Snapshot()
	if len(before.ActiveRuns) != 2 {
		t.Fatalf("runs=%v", before.ActiveRuns)
	}
	outcome, events, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "restore", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "second"}}))
	if err != nil || outcome.GetAccepted() == nil || len(events) != 1 {
		t.Fatalf("restore=%v events=%v err=%v", outcome, events, err)
	}
	restored := core.Snapshot()
	if restored.Clock.RuntimeTimeMs != 80 || restored.StepExecution.Timers[0].DeadlineRuntimeTimeMs != 110 || restored.StepExecution.Timers[0].Fired || len(restored.StepExecution.ConsumedCueIds) != 0 {
		t.Fatalf("restored=%v", restored)
	}
	for _, run := range restored.ActiveRuns {
		if run.RunId.RunSequence <= before.LastAllocatedRunSequence || run.StartedAtRuntimeTimeMs != 60 {
			t.Fatalf("run=%v", run)
		}
		if run.Owner.GetGroup() != nil && run.Owner.GetGroup().GroupEntryEpoch != restored.Progression.GroupEntryEpoch {
			t.Fatal("owner epoch not rebound")
		}
		if model := run.GetModelClip(); model != nil {
			clock := model.GetSingle().Playback.GetPlaying()
			if clock.ReferenceRuntimeTimeMs != 60 || clock.PositionAtReferenceMs != 0 {
				t.Fatalf("model clock=%v", clock)
			}
		}
	}
	if err = protocolv2.ValidateSnapshot(restored, core.validationCatalog, 1); err != nil {
		t.Fatal(err)
	}
	if _, _, err = core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); err != nil {
		t.Fatal(err)
	}
	if events, err = core.AdvanceTo(context.Background(), 100); err != nil || len(events) != 0 {
		t.Fatalf("old completion fired: %v err=%v", events, err)
	}
	if _, err = core.AdvanceTo(context.Background(), 110); err != nil {
		t.Fatal(err)
	}
	if !core.Snapshot().StepExecution.Timers[0].Fired {
		t.Fatal("rebased timer did not fire")
	}
	if events, err = core.AdvanceTo(context.Background(), 160); err != nil || events[0].GetTimelineCompleted() == nil {
		t.Fatalf("completion=%v err=%v", events, err)
	}
}

func TestV3EntryHistoryCapacityRollsBackAndPauses(t *testing.T) {
	core, _ := reviewSession(t)
	core.checkpointWriter = nil
	core.definition.Flow.Variables = map[string]v2Variable{"v": {ID: "v", Owner: v2Owner{Kind: "presentation"}, Type: "string"}}
	core.snapshot.Variables = []*realtimev2.VariableState{{VariableId: "v", Value: &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_StringValue{StringValue: ""}}}}
	value, _ := json.Marshal(map[string]any{"kind": "literal", "value": strings.Repeat("x", 70000)})
	var cue v2Cue
	cue.ID = "large"
	cue.Trigger.Kind = "logicalInput"
	cue.Trigger.Actor.Kind = "presenter"
	cue.Trigger.Action = "large"
	cue.FirePolicy.Kind = "repeatable"
	cue.Next.Kind = "step"
	cue.Next.StepID = "start"
	cue.Actions = []v2Action{{Kind: "variable.set", VariableID: "v", Value: value}}
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	step.Cues = []v2Cue{cue}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	before := core.Snapshot()
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	out, _, err := core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "large-entry", LogicalEventName: "large"}))
	after := core.Snapshot()
	if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED || after.Clock.GetPaused() == nil || after.Variables[0].Value.GetStringValue() != "" || !proto.Equal(before.StepStartHistory[0], after.StepStartHistory[0]) {
		t.Fatalf("out=%v after=%v err=%v", out, after, err)
	}
	if _, events, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "fault-resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); err == nil || len(events) != 0 {
		t.Fatalf("capacity fault resumed: events=%v err=%v", events, err)
	}
	out, _, err = core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "repair-select", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
	if err != nil || out.GetAccepted() == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE {
		t.Fatalf("repair=%v err=%v", out, err)
	}
	if _, _, err = core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "repair-resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); err != nil {
		t.Fatal(err)
	}
}

func TestV3SelectStepFailureDoesNotPublishCandidate(t *testing.T) {
	core, _ := reviewSession(t)
	before, stream, closeStream := core.SnapshotAndSubscribe()
	defer closeStream()
	core.checkpointWriter = failingV2Checkpoint{}
	outcome, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "failed-select", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
	if err == nil || outcome != nil || len(events) != 0 || core.Snapshot().Progression.StepEntryEpoch != before.Progression.StepEntryEpoch || core.Snapshot().ReliableSequence != before.ReliableSequence || len(core.outcomes) != 0 {
		t.Fatalf("out=%v events=%v err=%v", outcome, events, err)
	}
	select {
	case event := <-stream:
		t.Fatalf("published uncommitted replacement: %v", event)
	default:
	}
}

func TestV3SelectStepCandidateIsHiddenWhileCheckpointWrites(t *testing.T) {
	core, _ := reviewSession(t)
	before := core.Snapshot()
	entered, release := make(chan struct{}), make(chan struct{})
	core.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { close(entered); <-release; return nil })
	done := make(chan error, 1)
	go func() {
		_, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pending-select", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
		done <- err
	}()
	<-entered
	observed := core.Snapshot()
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(before, observed) {
		t.Fatalf("candidate leaked: %v", observed)
	}
	if core.Snapshot().Clock.GetPaused() == nil || core.Snapshot().Progression.StepEntryEpoch <= before.Progression.StepEntryEpoch {
		t.Fatal("committed replacement missing")
	}
}

func TestV3SelectStepRestoresHistoryAcrossGroupsAndReplacesReentry(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"old":{"id":"old","kind":"container","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"new":{"id":"new","kind":"container","owner":{"kind":"group","groupId":"next"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"group","groupId":"next"}}]}}},"next":{"id":"next","initialStepId":"start-next","steps":{"start-next":{"id":"start-next","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err = core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "group-next", LogicalEventName: "next"})); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"select-original", "reselect-original"} {
		before := core.Snapshot()
		out, _, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: id, Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
		after := core.Snapshot()
		if err != nil || out.GetAccepted() == nil || len(after.NodeStates) != 1 || after.NodeStates[0].NodeId != "old" || after.Progression.StepEntryEpoch <= before.Progression.StepEntryEpoch {
			t.Fatalf("after=%v out=%v err=%v", after, out, err)
		}
		if len(after.StepStartHistory) != 2 || after.StepStartHistory[0].StepEntryEpoch != after.Progression.StepEntryEpoch {
			t.Fatal("reentry did not replace latest history")
		}
		if err = protocolv2.ValidateSnapshot(after, core.validationCatalog, 1); err != nil {
			t.Fatal(err)
		}
	}
}

func TestV3StepHistoryTotalCapacityKeepsEveryReachedStep(t *testing.T) {
	var definition map[string]any
	if err := json.Unmarshal([]byte(reviewDefinition), &definition); err != nil {
		t.Fatal(err)
	}
	flow := definition["flow"].(map[string]any)
	flow["variables"] = map[string]any{"large": map[string]any{"id": "large", "owner": map[string]any{"kind": "presentation"}, "type": "string", "initialValue": strings.Repeat("x", 60000)}}
	steps := map[string]any{}
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("s%d", i)
		steps[id] = map[string]any{"id": id, "cues": []any{map[string]any{"id": "next", "trigger": map[string]any{"kind": "logicalInput", "actor": map[string]any{"kind": "presenter"}, "action": "next"}, "firePolicy": map[string]any{"kind": "repeatable"}, "actions": []any{}, "next": map[string]any{"kind": "step", "stepId": fmt.Sprintf("s%d", i+1)}}}}
	}
	flow["groups"] = map[string]any{"intro": map[string]any{"id": "intro", "initialStepId": "s0", "steps": steps}}
	raw, _ := json.Marshal(definition)
	core, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for i := 1; i <= 8; i++ {
		before := core.Snapshot()
		out, _, err := core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: fmt.Sprintf("large-next-%d", i), LogicalEventName: "next"}))
		if err != nil {
			t.Fatal(err)
		}
		if i < 8 {
			if out.GetAccepted() == nil || len(core.Snapshot().StepStartHistory) != i+1 {
				t.Fatalf("entry %d: %v", i, out)
			}
		} else {
			after := core.Snapshot()
			if out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED || after.Progression.CurrentStepId != "s7" || after.Clock.GetPaused() == nil || len(after.StepStartHistory) != 8 {
				t.Fatalf("overflow=%v snapshot=%v", out, after)
			}
			for j, entry := range before.StepStartHistory {
				if !proto.Equal(entry, after.StepStartHistory[j]) {
					t.Fatal("reached history evicted or replaced")
				}
			}
		}
	}
}

func TestV3InitialStepHistoryRejectsOversizeEntry(t *testing.T) {
	var definition map[string]any
	if err := json.Unmarshal([]byte(reviewDefinition), &definition); err != nil {
		t.Fatal(err)
	}
	definition["flow"].(map[string]any)["variables"] = map[string]any{"large": map[string]any{"id": "large", "owner": map[string]any{"kind": "presentation"}, "type": "string", "initialValue": strings.Repeat("x", 65536)}}
	raw, _ := json.Marshal(definition)
	if _, err := NewV2InitialSnapshot(raw); !errors.Is(err, ErrV3RuntimeCapacity) {
		t.Fatalf("oversize initial entry err=%v", err)
	}
}

func TestV3RestoreMediaRebindsPlaybackAndCompletion(t *testing.T) {
	raw, err := os.ReadFile("testdata/media-public-definition.json")
	if err != nil {
		t.Fatal(err)
	}
	var definition map[string]any
	if err = json.Unmarshal(raw, &definition); err != nil {
		t.Fatal(err)
	}
	group := definition["flow"].(map[string]any)["groups"].(map[string]any)["intro"].(map[string]any)
	steps := group["steps"].(map[string]any)
	start := steps["start"].(map[string]any)
	start["cues"] = append(start["cues"].([]any), map[string]any{"id": "next", "trigger": map[string]any{"kind": "logicalInput", "actor": map[string]any{"kind": "presenter"}, "action": "next"}, "firePolicy": map[string]any{"kind": "repeatable"}, "actions": []any{}, "next": map[string]any{"kind": "step", "stepId": "second"}})
	steps["second"] = map[string]any{"id": "second", "cues": []any{}}
	raw, _ = json.Marshal(definition)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"video":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":1000,"loop":false}},"stateBindings":{"default":{"kind":"artifacts","artifactIds":["video"]}}}}}}}`)
	core, err := newV3RegressionSessionWithBundle(raw, bundle)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	core.checkpointMetadata = &realtimev2.DurableCheckpointEnvelope{AssignmentEpoch: 1}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for _, action := range []string{"play", "next"} {
		if action == "next" {
			if _, err = core.AdvanceTo(context.Background(), 200); err != nil {
				t.Fatal(err)
			}
		}
		if _, _, err = core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: action, LogicalEventName: action})); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = core.AdvanceTo(context.Background(), 600); err != nil {
		t.Fatal(err)
	}
	oldID := core.Snapshot().ActiveRuns[0].RunId
	out, _, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "media-restore", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "second"}}))
	if err != nil || out.GetAccepted() == nil {
		t.Fatalf("out=%v err=%v", out, err)
	}
	after := core.Snapshot()
	active := after.MediaStates[0].GetActive()
	run := after.ActiveRuns[0]
	if proto.Equal(oldID, run.RunId) || !proto.Equal(active.RunId, run.RunId) || !proto.Equal(active.Playback, run.GetMedia().Playback) || active.Playback.GetPlaying().ReferenceRuntimeTimeMs != 400 {
		t.Fatalf("run=%v active=%v", run, active)
	}
	if err = protocolv2.ValidateSnapshot(after, core.validationCatalog, 1); err != nil {
		t.Fatal(err)
	}
	if _, _, err = core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "media-resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); err != nil {
		t.Fatal(err)
	}
	if events, err := core.AdvanceTo(context.Background(), 1000); err != nil || len(events) != 0 {
		t.Fatalf("old media completion=%v err=%v", events, err)
	}
	if events, err := core.AdvanceTo(context.Background(), 1400); err != nil || len(events) != 1 || events[0].GetMediaCompleted() == nil {
		t.Fatalf("media completion=%v err=%v", events, err)
	}
}

func TestV3SelectStepCancelsInFlightSurfaceTransition(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"surface.setState","surfaceId":"surface","stateId":"second","transition":{"kind":"crossfade","durationMilliseconds":100,"easing":"linear","completion":"blocking"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	core.checkpointMetadata = &realtimev2.DurableCheckpointEnvelope{AssignmentEpoch: 1}
	freezeV2WallClock(core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err = core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "crossfade", LogicalEventName: "next"})); err != nil {
		t.Fatal(err)
	}
	if _, err = core.AdvanceTo(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	before := core.Snapshot()
	out, events, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "cancel-crossfade", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
	after := core.Snapshot()
	if err != nil || out.GetAccepted() == nil || len(events) != 1 || after.SurfaceStates[0].StateId != "first" || after.SurfaceStates[0].TransitionRunId != nil || len(after.ActiveRuns) != 0 || after.LastAllocatedRunSequence != before.LastAllocatedRunSequence {
		t.Fatalf("out=%v after=%v err=%v", out, after, err)
	}
	if err = protocolv2.ValidateSnapshot(after, core.validationCatalog, 1); err != nil {
		t.Fatal(err)
	}
	if _, _, err = core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-surface", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); err != nil {
		t.Fatal(err)
	}
	if events, err = core.AdvanceTo(context.Background(), 100); err != nil || len(events) != 0 || core.Snapshot().SurfaceStates[0].StateId != "first" {
		t.Fatalf("canceled transition completed: %v err=%v", events, err)
	}
}

func TestV3CapacityFaultSurvivesCheckpointRecovery(t *testing.T) {
	var definition map[string]any
	if err := json.Unmarshal([]byte(reviewDefinition), &definition); err != nil {
		t.Fatal(err)
	}
	flow := definition["flow"].(map[string]any)
	flow["variables"] = map[string]any{"large": map[string]any{"id": "large", "owner": map[string]any{"kind": "presentation"}, "type": "string", "initialValue": ""}}
	start := flow["groups"].(map[string]any)["intro"].(map[string]any)["steps"].(map[string]any)["start"].(map[string]any)
	start["cues"] = []any{map[string]any{"id": "large", "trigger": map[string]any{"kind": "logicalInput", "actor": map[string]any{"kind": "presenter"}, "action": "large"}, "firePolicy": map[string]any{"kind": "repeatable"}, "actions": []any{map[string]any{"kind": "variable.set", "variableId": "large", "value": map[string]any{"kind": "literal", "value": strings.Repeat("x", 70000)}}}, "next": map[string]any{"kind": "step", "stepId": "start"}}}
	raw, _ := json.Marshal(definition)
	core, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	template, _ := reviewSession(t)
	writer := &recordingV2Checkpoint{}
	if err = core.ConfigureDurability(writer, template.checkpointMetadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	out, _, err := core.LogicalInput(identity, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "capacity-recovery", LogicalEventName: "large"}))
	if err != nil || out.GetRejected() == nil || writer.envelope == nil {
		t.Fatalf("out=%v err=%v", out, err)
	}
	recovered, err := newV3RegressionSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err = recovered.ConfigureDurability(&recordingV2Checkpoint{}, template.checkpointMetadata, recovered.validationCatalog); err != nil {
		t.Fatal(err)
	}
	if err = recovered.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	if recovered.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION {
		t.Fatal("recovery discarded capacity fault")
	}
	if _, _, err = recovered.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(recovered, &realtimev2.RuntimeControlCommand{ClientEventId: "recovery-resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})); !errors.Is(err, ErrV3RuntimeCapacity) {
		t.Fatalf("recovery resumed fault: %v", err)
	}
}

func TestV3CheckpointRejectsHistoryForUnknownStep(t *testing.T) {
	core, writer := reviewSession(t)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "persist-history", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE})); err != nil {
		t.Fatal(err)
	}
	malformed := core.Snapshot()
	malformed.StepStartHistory[0].StepId = "unknown"
	envelope, err := protocolv2.EncodeCheckpoint(malformed, writer.envelope, core.validationCatalog)
	if err != nil {
		t.Fatal(err)
	}
	recovered, _ := reviewSession(t)
	if err = recovered.RestoreCheckpoint(envelope); err == nil {
		t.Fatal("accepted history not in Definition")
	}
}

func TestV3SelectStepFreezesSelectionTimeAnchorAndPreservesPausedDisplay(t *testing.T) {
	core, _ := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	selectStep := func(id string) {
		t.Helper()
		out, events, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: id, Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_SELECT_STEP, StepSelection: &realtimev2.StepSelection{GroupId: "intro", StepId: "start"}}))
		if err != nil || out.GetAccepted() == nil || len(events) != 1 {
			t.Fatalf("out=%v events=%v err=%v", out, events, err)
		}
	}
	selectStep("freeze-selection")
	if frozen := core.Snapshot().FrozenAnchors; len(frozen) != 1 || frozen[0].Position.X != 3 {
		t.Fatalf("selection anchor=%v", frozen)
	}
	v3SeedAnchor(t, core, 2, 7)
	selectStep("reselect-paused")
	if frozen := core.Snapshot().FrozenAnchors; len(frozen) != 1 || frozen[0].Position.X != 3 {
		t.Fatalf("paused display moved: %v", frozen)
	}
}

func TestV3InvariantResumeRunsNormalValidation(t *testing.T) {
 core, _ := reviewSession(t)
 core.checkpointWriter = nil
 core.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_INVARIANT_VIOLATION}}
 called := false
 core.ConfigureResumeValidation(func(context.Context) error { called = true; return nil })
 _, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "invariant-resume", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME}))
 if err != nil || !called { t.Fatalf("resume err=%v validator=%v", err, called) }
}
