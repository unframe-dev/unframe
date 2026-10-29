package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
	"time"
)

func TestV3InputSynchronizationBarrierAndOutcomeReuse(t *testing.T) {
	core, err := NewV2Session(json.RawMessage(`{"schemaVersion":3,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"g","groups":{"g":{"id":"g","initialStepId":"s","steps":{"s":{"id":"s","cues":[{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"},"actions":[]}]}}}},"variables":{},"timelines":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{ParticipantID: "presenter", Role: session.RolePresenter}
	sync := core.InputSynchronization()
	command := &realtimev2.LogicalInputCommand{ClientEventId: "1:550e8400-e29b-41d4-a716-446655440000", CommandEpoch: 1, InputContext: sync.InputContext, LogicalEventName: "next"}
	outcome, _, err := core.LogicalInput(identity, command)
	if err != nil || outcome.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_SYNCHRONIZATION_REQUIRED || len(core.outcomes) != 0 {
		t.Fatalf("barrier outcome=%v error=%v records=%d", outcome, err, len(core.outcomes))
	}
	_, err = core.AcknowledgeInputSynchronization(context.Background(), identity, &realtimev2.InputSynchronizationAck{SynchronizationRevision: sync.SynchronizationRevision, InputContext: sync.InputContext, CommandEpoch: sync.CommandEpoch, AppliedReliableSequence: sync.ReliableSequence, PendingCommandsDiscarded: true})
	if err != nil {
		t.Fatal(err)
	}
	first, _, err := core.LogicalInput(identity, command)
	if err != nil || first.GetAccepted() == nil {
		t.Fatalf("first=%v error=%v", first, err)
	}
	if err := core.BeginInputSynchronization(context.Background(), realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PAUSED, false); err != nil {
		t.Fatal(err)
	}
	duplicate, events, err := core.LogicalInput(identity, command)
	if err != nil || !proto.Equal(first, duplicate) || len(events) != 0 {
		t.Fatalf("duplicate=%v events=%v error=%v", duplicate, events, err)
	}
}

func v3Acknowledge(t *testing.T, core *V2Session) *realtimev2.PresenterInputSynchronization {
	t.Helper()
	sync := core.InputSynchronization()
	epoch := sync.CommandEpoch
	if sync.NextCommandEpoch != nil {
		epoch = *sync.NextCommandEpoch
	}
	ready, err := core.AcknowledgeInputSynchronization(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.InputSynchronizationAck{SynchronizationRevision: sync.SynchronizationRevision, InputContext: sync.InputContext, CommandEpoch: epoch, AppliedReliableSequence: sync.ReliableSequence, PendingCommandsDiscarded: true})
	if err != nil {
		t.Fatal(err)
	}
	return ready
}

func TestV3SynchronizationAckAtomicallyRotatesHistoryAndReplaysReady(t *testing.T) {
	core, writer := reviewSession(t)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE})
	if _, _, err := core.RuntimeControl(context.Background(), identity, command); err != nil {
		t.Fatal(err)
	}
	if err := core.BeginInputSynchronization(context.Background(), realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED, true); err != nil {
		t.Fatal(err)
	}
	required := core.InputSynchronization()
	core.checkpointWriter = failingV2Checkpoint{}
	ack := &realtimev2.InputSynchronizationAck{SynchronizationRevision: required.SynchronizationRevision, InputContext: required.InputContext, CommandEpoch: required.GetNextCommandEpoch(), AppliedReliableSequence: required.ReliableSequence, PendingCommandsDiscarded: true}
	ready, err := core.AcknowledgeInputSynchronization(context.Background(), identity, ack)
	if err != nil {
		t.Fatal(err)
	}
	if ready.Phase != realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY || core.commandEpoch != 2 || len(core.outcomes) != 0 {
		t.Fatalf("READY=%v records=%d", ready, len(core.outcomes))
	}
	core.checkpointWriter = writer
	flushV2(t, core)
	checkpointSequence := writer.envelope.CheckpointSequence
	repeated, err := core.AcknowledgeInputSynchronization(context.Background(), identity, ack)
	if err != nil || !proto.Equal(ready, repeated) || writer.envelope.CheckpointSequence != checkpointSequence {
		t.Fatal("READY retry wrote or changed state")
	}
	rejected, _, err := core.RuntimeControl(context.Background(), identity, command)
	if err != nil || rejected.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_COMMAND_EPOCH_STALE || len(core.outcomes) != 0 {
		t.Fatalf("old epoch executed: %v %v", rejected, err)
	}
}

func TestV3HistoryCapacityStartsDurableBarrierWithoutEviction(t *testing.T) {
	core, writer := reviewSession(t)
	v3Acknowledge(t, core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for i := 0; i < 999; i++ {
		id := v3TestEventID(fmt.Sprintf("%d", i))
		core.rememberOutcome(identity.ParticipantID+"\x00"+id, "sha256:"+strings.Repeat("a", 64), v3Rejected(id, realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_UNAVAILABLE))
	}
	command := &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID("new"), CommandEpoch: 1, InputContext: core.InputSynchronization().InputContext, LogicalEventName: "next"}
	outcome, events, err := core.LogicalInput(identity, command)
	if err != nil || outcome.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_SYNCHRONIZATION_REQUIRED || len(events) != 0 || len(core.outcomes) != 999 {
		t.Fatalf("capacity outcome=%v records=%d err=%v", outcome, len(core.outcomes), err)
	}
	flushV2(t, core)
	if writer.envelope == nil || core.InputSynchronization().GetNextCommandEpoch() != 2 {
		t.Fatal("capacity did not persist a rotation barrier")
	}
	v3Acknowledge(t, core)
	if len(core.outcomes) != 0 || core.commandEpoch != 2 {
		t.Fatal("ACK did not safely clear history")
	}
}

func TestV3ClockWaitsForInitialAuthenticatedParticipant(t *testing.T) {
	core, err := NewV2Session(json.RawMessage(reviewDefinition))
	if err != nil {
		t.Fatal(err)
	}
	base, _ := reviewSession(t)
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, base.checkpointMetadata, base.checkpointCatalog); err != nil {
		t.Fatal(err)
	}
	start := core.lastTick
	if _, err := core.AdvanceFromWall(context.Background(), start.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if core.Snapshot().Clock.RuntimeTimeMs != 0 || writer.envelope != nil {
		t.Fatal("runtime advanced before initial Join")
	}
	if err := core.JoinParticipant(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := core.AdvanceFromWall(context.Background(), start.Add(time.Hour+time.Second)); err != nil {
		t.Fatal(err)
	}
	if core.Snapshot().Clock.RuntimeTimeMs != 1000 {
		t.Fatal("runtime did not begin after Join")
	}
}

func TestV3RecalibrationPreservesLifecycleAndOrigin(t *testing.T) {
	for _, paused := range []bool{false, true} {
		t.Run(fmt.Sprint(paused), func(t *testing.T) {
			core, _ := reviewSession(t)
			if paused {
				core.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE}}
			}
			clock := proto.Clone(core.snapshot.Clock)
			origin := proto.Clone(core.snapshot.PresentationOrigin)
			epoch := core.snapshot.InputEpoch
			out, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "calibrate", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RECALIBRATE}))
			if err != nil || out.GetAccepted() == nil || len(events) != 1 || !proto.Equal(clock, core.snapshot.Clock) || !proto.Equal(origin, core.snapshot.PresentationOrigin) || core.snapshot.InputEpoch != epoch+1 {
				t.Fatalf("recalibrate outcome=%v events=%v error=%v", out, events, err)
			}
			if core.InputSynchronization().Phase != realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED || core.InputSynchronization().Reason != realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED {
				t.Fatal("missing recalibration barrier")
			}
		})
	}
}

func TestV3PresenterGestureAndZoneEvaluateWithoutServerRecognition(t *testing.T) {
	core, _ := reviewSession(t)
	core.checkpointWriter = nil
	var gesture, zone v2Cue
	_ = json.Unmarshal([]byte(`{"id":"gesture","trigger":{"kind":"gesture","actor":{"kind":"presenter"},"gesture":"swipeLeft"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`), &gesture)
	_ = json.Unmarshal([]byte(`{"id":"zone","trigger":{"kind":"zoneEdge","actor":{"kind":"presenter"},"zoneId":"z","edge":"enter"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`), &zone)
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	step.Cues = []v2Cue{gesture, zone}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	core.definition.Stage.Zones = map[string]v2TrackingZone{"z": {ID: "z", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{0, 0, 0}}}
	if err := core.BeginInputSynchronization(context.Background(), realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED, false); err != nil {
		t.Fatal(err)
	}
	ready := v3Acknowledge(t, core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := &realtimev2.GestureInputCommand{ClientEventId: v3TestEventID("gesture"), CommandEpoch: 1, InputContext: ready.InputContext, Gesture: 1}
	first, events, err := core.GestureInputContext(context.Background(), identity, command)
	if err != nil || first.GetAccepted().GetCueCommitted().GetCueId() != "gesture" || len(events) != 2 || events[0].GetGestureInputAccepted() == nil {
		t.Fatalf("gesture=%v events=%v error=%v", first, events, err)
	}
	at := uint64(100)
	command.CapturedAtClientMonotonicMs = &at
	duplicate, events, err := core.GestureInputContext(context.Background(), identity, command)
	if err != nil || !proto.Equal(first, duplicate) || len(events) != 0 {
		t.Fatal("diagnostic timestamp changed fingerprint")
	}
	command.ClientEventId = v3TestEventID("second-gesture")
	second, _, err := core.GestureInputContext(context.Background(), identity, command)
	if err != nil || second.GetAccepted().GetCueCommitted() == nil {
		t.Fatal("server imposed gesture cooldown")
	}
	zoneCommand := &realtimev2.ZoneInputCommand{ClientEventId: v3TestEventID("zone"), CommandEpoch: 1, InputContext: ready.InputContext, ZoneId: "z", Edge: 1}
	out, events, err := core.ZoneInputContext(context.Background(), identity, zoneCommand)
	if err != nil || out.GetAccepted().GetCueCommitted().GetCueId() != "zone" || len(events) != 2 || events[0].GetZoneInputAccepted() == nil {
		t.Fatalf("zone=%v events=%v error=%v", out, events, err)
	}
	command.Gesture = 2
	if _, _, err := core.GestureInputContext(context.Background(), identity, command); err != ErrV2IdempotencyKeyReused {
		t.Fatal("changed gesture reused an id")
	}
	viewer := session.Identity{Role: session.RoleViewer, ParticipantID: "viewer"}
	if _, _, err := core.ZoneInputContext(context.Background(), viewer, zoneCommand); err != ErrV2PresenterRequired {
		t.Fatal("viewer input accepted")
	}
}

func TestV3OldInputContextAndFutureEpochDoNotRecordOutcomes(t *testing.T) {
	core, _ := reviewSession(t)
	ready := v3Acknowledge(t, core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID("stale"), CommandEpoch: 1, InputContext: proto.Clone(ready.InputContext).(*realtimev2.InputContext), LogicalEventName: "missing"}
	command.InputContext.StepEntryEpoch++
	out, _, err := core.LogicalInput(identity, command)
	if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_CONTEXT_STALE || len(core.outcomes) != 0 {
		t.Fatalf("stale input=%v error=%v", out, err)
	}
	command.CommandEpoch = 2
	command.ClientEventId = "2:550e8400-e29b-41d4-a716-446655440000"
	if _, _, err := core.LogicalInput(identity, command); err != ErrV3CommandEpochFuture || len(core.outcomes) != 0 {
		t.Fatalf("future epoch error=%v", err)
	}
}

func TestV3RecoveryMetadataCapacityRejectsGlobalCommandWithoutMutation(t *testing.T) {
	core, _ := reviewSession(t)
	// Participant history remains durable even when commands are collected.
	for i := 0; protocolv2.KnownSize(core.v2Recovery()) < protocolv2.MaximumRecoveryMetadataBytes-2000; i++ {
		core.participants[fmt.Sprintf("p-%05d-%s", i, strings.Repeat("x", 100))] = session.RoleViewer
	}
	before := core.Snapshot()
	sync := core.InputSynchronization()
	out, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}))
	if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED || len(events) != 0 || len(core.outcomes) != 0 || !proto.Equal(before, core.Snapshot()) || !proto.Equal(sync, core.InputSynchronization()) {
		t.Fatalf("capacity outcome=%v error=%v", out, err)
	}
}

func TestV3SynchronizationResetsPoseSequenceOnlyAtConnectionAndCalibration(t *testing.T) {
	for _, reason := range []realtimev2.InputSynchronizationReason{realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED, realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED} {
		t.Run(reason.String(), func(t *testing.T) {
			core, _ := reviewSession(t)
			identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
			at := time.Now()
			frame := trackingTestFrame(5, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(1, 0, 0)))
			if _, _, err := core.AcceptTracking(context.Background(), identity, frame, at, 50); err != nil {
				t.Fatal(err)
			}
			if err := core.BeginInputSynchronization(context.Background(), reason, reason == realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED); err != nil {
				t.Fatal(err)
			}
			frame.FrameSequence = 1
			if _, _, err := core.AcceptTracking(context.Background(), identity, frame, at.Add(time.Second), 1); err != nil {
				t.Fatalf("new stream could not restart sequence: %v", err)
			}
		})
	}
}

func TestV3TerminatedCheckpointCannotRestoreAsPaused(t *testing.T) {
	core, _ := reviewSession(t)
	completion := &recordingV2Completion{}
	core.ConfigureCompletion(completion)
	if _, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "end", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END})); err != nil {
		t.Fatal(err)
	}
	restored, _ := reviewSession(t)
	if err := restored.RestoreCheckpoint(completion.envelope); err == nil {
		t.Fatal("terminated checkpoint was reopened")
	}
}

func TestV3OversizedRecognitionSynchronizationRollsBackCommand(t *testing.T) {
	core, _ := reviewSession(t)
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	core.definition.Stage.Zones = map[string]v2TrackingZone{}
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("zone-%03d-%s", i, strings.Repeat("z", 60))
		core.definition.Stage.Zones[id] = v2TrackingZone{ID: id, Owner: v2Owner{Kind: "presentation"}}
		var cue v2Cue
		_ = json.Unmarshal([]byte(fmt.Sprintf(`{"id":"cue-%d","trigger":{"kind":"zoneEdge","actor":{"kind":"presenter"},"zoneId":"%s","edge":"enter"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`, i, id)), &cue)
		step.Cues = append(step.Cues, cue)
	}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	before := core.Snapshot()
	sync := core.InputSynchronization()
	out, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "calibrate", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RECALIBRATE}))
	if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED || len(events) != 0 || len(core.outcomes) != 0 || !proto.Equal(before, core.Snapshot()) || !proto.Equal(sync, core.InputSynchronization()) {
		t.Fatalf("oversized sync outcome=%v error=%v", out, err)
	}
}

func TestV3RecordedOutcomeSurvivesElapsedTimeAndProcessRecovery(t *testing.T) {
	core, writer := reviewSession(t)
	var cue v2Cue
	_ = json.Unmarshal([]byte(`{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"next":{"kind":"stay"}}`), &cue)
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	step.Cues = []v2Cue{cue}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	ready := v3Acknowledge(t, core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	command := &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID("durable"), CommandEpoch: 1, InputContext: ready.InputContext, LogicalEventName: "next"}
	first, _, err := core.LogicalInput(identity, command)
	if err != nil || first.GetAccepted() == nil {
		t.Fatalf("first=%v error=%v", first, err)
	}
	if _, err := core.AdvanceTo(context.Background(), uint64(time.Hour/time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	repeated, events, err := core.LogicalInput(identity, command)
	if err != nil || !proto.Equal(first, repeated) || len(events) != 0 {
		t.Fatal("elapsed time invalidated outcome")
	}
	restored, _ := reviewSession(t)
	flushV2(t, core)
	if err := restored.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	repeated, events, err = restored.LogicalInput(identity, command)
	if err != nil || !proto.Equal(first, repeated) || len(events) != 0 || len(restored.outcomes) != 1 {
		t.Fatalf("recovered replay=%v events=%v error=%v", repeated, events, err)
	}
}

func TestV3ActionCapacityRejectsWithoutPartialMutation(t *testing.T) {
	core, _ := reviewSession(t)
	core.definition.Flow.Variables = map[string]v2Variable{"message": {ID: "message", Owner: v2Owner{Kind: "presentation"}, Type: "string", InitialValue: ""}}
	core.snapshot.Variables = []*realtimev2.VariableState{{VariableId: "message", Value: &presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_StringValue{StringValue: ""}}}}
	core.checkpointWriter = nil
	var cue v2Cue
	value, _ := json.Marshal(map[string]any{"kind": "literal", "value": strings.Repeat("x", protocolv2.MaximumCanonicalSnapshotBytes)})
	cue.ID = "large"
	cue.Trigger.Kind = "logicalInput"
	cue.Trigger.Actor.Kind = "presenter"
	cue.Trigger.Action = "large"
	cue.FirePolicy.Kind = "repeatable"
	cue.Next.Kind = "step"
	cue.Next.StepID = "start"
	cue.Actions = []v2Action{{Kind: "variable.set", VariableID: "message", Value: value}}
	group := core.definition.Flow.Groups["intro"]
	step := group.Steps["start"]
	step.Cues = []v2Cue{cue}
	group.Steps["start"] = step
	core.definition.Flow.Groups["intro"] = group
	ready := v3Acknowledge(t, core)
	before := core.Snapshot()
	previousSync := core.InputSynchronization()
	out, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID("large"), CommandEpoch: 1, InputContext: ready.InputContext, LogicalEventName: "large"})
	if err != nil || out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED || len(events) != 0 || len(core.outcomes) != 0 || !proto.Equal(before, core.Snapshot()) || !proto.Equal(previousSync, core.InputSynchronization()) {
		t.Fatalf("capacity mutation outcome=%v error=%v", out, err)
	}
}

func TestV3RequiredSynchronizationIsVisibleWithoutCheckpointCommit(t *testing.T) {
	core, _ := reviewSession(t)
	v3Acknowledge(t, core)
	core.checkpointWriter = failingV2Checkpoint{}
	if err := core.BeginInputSynchronization(context.Background(), realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED, false); err != nil {
		t.Fatal(err)
	}
	if core.InputSynchronization().Phase != realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED {
		t.Fatal("required synchronization missing")
	}
	v3Acknowledge(t, core)
}

func TestV3PoseCloneDoesNotAliasLatestSamples(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(3, 0, 0)))
	if _, _, err := evaluator.Accept(frame, time.Now(), 1, v2TrackingDefinition{}, 0); err != nil {
		t.Fatal(err)
	}
	clone := evaluator.Clone()
	sample := clone.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY]
	sample.Pose.Position.X = 10
	if evaluator.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY].Pose.Position.X != 3 {
		t.Fatal("Pose clone aliases original")
	}
}
