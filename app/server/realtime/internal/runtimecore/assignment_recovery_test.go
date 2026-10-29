package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestAssignmentRecoveryPreservesRunsHistoryAndDurableCut(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"panel":{"id":"panel","kind":"container","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":0},"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"host":{"id":"host","kind":"surface","surfaceId":"surface","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface":{"id":"surface","hostNodeId":"host","initialStateId":"first","states":{"first":{"id":"first","enabledInteractionIds":[]},"second":{"id":"second","enabledInteractionIds":[]}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"play"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"fade","completion":"nonBlocking","conflict":"reject"},{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":2,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}},{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[{"id":"timer","trigger":{"kind":"timer","afterMilliseconds":30},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"group","groupId":"intro"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"panel","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":0,"durationMilliseconds":400}}}}}`)

	original, err := newV3RegressionSessionWithBundle(raw, bundle)
	if err != nil {
		t.Fatal(err)
	}
	template, _ := reviewSession(t)
	writer := &recordingV2Checkpoint{}
	if err := original.ConfigureDurability(writer, template.checkpointMetadata, original.validationCatalog); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(original)
	presenter := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for _, action := range []string{"play", "next"} {
		if _, _, err := original.LogicalInput(presenter, v3TestLogicalInput(original, &realtimev2.LogicalInputCommand{ClientEventId: action, LogicalEventName: action})); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := original.AdvanceTo(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	original.snapshot.LastIngressSequence = 7
	if err := original.JoinParticipant(context.Background(), session.Identity{Role: session.RoleViewer, ParticipantID: "viewer-1"}); err != nil {
		t.Fatal(err)
	}
	flushV2(t, original)
	envelope := writer.envelope
	for _, epoch := range []uint64{2, 5} {
		before := original.Snapshot()
		recovered, err := newV3RegressionSessionWithBundle(raw, bundle)
		if err != nil {
			t.Fatal(err)
		}
		target := proto.Clone(template.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
		target.AssignmentEpoch = epoch
		target.RuntimeId = "new-runtime"
		saved := &recordingV2Checkpoint{}
		if err := recovered.ConfigureDurability(saved, target, recovered.validationCatalog); err != nil {
			t.Fatal(err)
		}
		source := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
		if err := recovered.RestoreCheckpointFromAssignment(envelope, source); err != nil {
			t.Fatal(err)
		}
		after := recovered.Snapshot()
		if after.ReliableSequence != before.ReliableSequence || after.LastIngressSequence != before.LastIngressSequence || after.LastAllocatedRunSequence != before.LastAllocatedRunSequence || after.Clock.RuntimeTimeMs != before.Clock.RuntimeTimeMs {
			t.Fatalf("durable cut changed: before seq/ingress/alloc/time %d/%d/%d/%d after %d/%d/%d/%d", before.ReliableSequence, before.LastIngressSequence, before.LastAllocatedRunSequence, before.Clock.RuntimeTimeMs, after.ReliableSequence, after.LastIngressSequence, after.LastAllocatedRunSequence, after.Clock.RuntimeTimeMs)
		}
		if !proto.Equal(before.StepExecution, after.StepExecution) || len(recovered.participants) != len(original.participants) || len(recovered.outcomes) != len(original.outcomes) {
			t.Fatal("timer, participant or command history lost")
		}
		if after.Clock.GetPaused().GetReason() != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED || len(after.StepStartHistory) != 2 {
			t.Fatal("pause or history lost")
		}
		ids := 0
		var walk func(protoreflect.Message)
		walk = func(m protoreflect.Message) {
			if m.Descriptor().FullName() == "unframe.presentation.RuntimeRunId" {
				ids++
				if m.Get(m.Descriptor().Fields().ByName("assignment_epoch")).Uint() != epoch {
					t.Fatal("stale run id")
				}
				return
			}
			m.Range(func(f protoreflect.FieldDescriptor, v protoreflect.Value) bool {
				if f.IsList() && f.Message() != nil {
					for i := 0; i < v.List().Len(); i++ {
						walk(v.List().Get(i).Message())
					}
				} else if f.Message() != nil {
					walk(v.Message())
				}
				return true
			})
		}
		walk(after.ProtoReflect())
		if ids < 4 {
			t.Fatalf("insufficient current/history run IDs: %d", ids)
		}
		if saved.envelope == nil || saved.envelope.CheckpointSequence != envelope.CheckpointSequence+1 || saved.envelope.AssignmentEpoch != epoch {
			t.Fatal("recovery not saved under next durable fence")
		}
		if recovered.inputSynchronization.GetNextCommandEpoch() <= original.commandEpoch || recovered.inputSynchronization.Phase == realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY {
			t.Fatal("command synchronization not fenced")
		}
		prior := recovered.Snapshot()
		if _, err := recovered.AdvanceFromWall(context.Background(), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		if recovered.Snapshot().Clock.RuntimeTimeMs != prior.Clock.RuntimeTimeMs {
			t.Fatal("downtime advanced paused runtime")
		}
		envelope = saved.envelope
		original = recovered
	}
	recovered, _ := newV3RegressionSessionWithBundle(raw, bundle)
	target := proto.Clone(template.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
	target.AssignmentEpoch = 6
	if err := recovered.ConfigureDurability(failingV2Checkpoint{}, target, recovered.validationCatalog); err != nil {
		t.Fatal(err)
	}
	if err := recovered.RestoreCheckpointFromAssignment(envelope, envelope); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatalf("durability failure=%v", err)
	}
	if recovered.Snapshot().ReliableSequence != 0 {
		t.Fatal("failed recovered snapshot became visible")
	}
}

func TestAssignmentRecoveryCandidateHiddenUntilDurableCommit(t *testing.T) {
	original, w := reviewSession(t)
	if err := original.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer-1", Role: session.RoleViewer}); err != nil {
		t.Fatal(err)
	}
	flushV2(t, original)
	recovered, _ := reviewSession(t)
	recovered.checkpointMetadata.AssignmentEpoch = 2
	entered, release := make(chan struct{}), make(chan struct{})
	recovered.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { close(entered); <-release; return nil })
	before := recovered.Snapshot()
	done := make(chan error, 1)
	go func() { done <- recovered.RestoreCheckpointFromAssignment(w.envelope, w.envelope) }()
	<-entered
	observed := v2SnapshotWithin(t, recovered)
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(before, observed) {
		t.Fatal("uncommitted recovery leaked")
	}
	if recovered.Snapshot().InputEpoch <= before.InputEpoch {
		t.Fatal("committed recovery missing")
	}
}

func TestAssignmentRecoveryRebasesSurfaceMediaAndBlockingRuns(t *testing.T) {
	actions := `[{"kind":"surface.setState","surfaceId":"a","stateId":"alt","transition":{"kind":"crossfade","durationMilliseconds":100,"easing":"linear","completion":"blocking"}},{"kind":"media.play","surfaceId":"b"}]`
	original, writer := v2MediaConflictSession(t, actions)
	v2MediaActorInput(t, original, "act-1", "act")
	flushV2(t, original)
	before := original.Snapshot()
	if before.Progression.GetTransitioning() == nil {
		t.Fatal("fixture lacks blocking run")
	}
	recovered, saved := v2MediaConflictSession(t, actions)
	recovered.checkpointMetadata.AssignmentEpoch = 2
	recovered.checkpointMetadata.RuntimeId = "replacement"
	if err := recovered.RestoreCheckpointFromAssignment(writer.envelope, writer.envelope); err != nil {
		t.Fatal(err)
	}
	after := recovered.Snapshot()
	if after.Progression.GetTransitioning().BlockingRunIds[0].AssignmentEpoch != 2 {
		t.Fatal("blocking run retained old epoch")
	}
	references := 0
	for _, surface := range after.SurfaceStates {
		if surface.TransitionRunId != nil {
			references++
			if surface.TransitionRunId.AssignmentEpoch != 2 {
				t.Fatal("transition retained old epoch")
			}
		}
	}
	for _, media := range after.MediaStates {
		if media.GetActive() != nil {
			references++
			if media.GetActive().RunId.AssignmentEpoch != 2 {
				t.Fatal("media retained old epoch")
			}
		}
	}
	if references != 2 || after.LastAllocatedRunSequence != before.LastAllocatedRunSequence || saved.envelope.CheckpointSequence != writer.envelope.CheckpointSequence+1 {
		t.Fatal("run identity or durable sequence changed")
	}
}
