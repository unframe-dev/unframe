package runtimecore

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

var idleViewer = session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}

func idleSession(t *testing.T) (*V2Session, *recordingV2Checkpoint, *recordingV2Completion, *time.Time) {
	t.Helper()
	core, writer := reviewSession(t)
	core.participants = make(map[string]session.Role)
	core.committedRecovery = core.v2Recovery()
	now := time.Now().UTC()
	core.now = func() time.Time { return now }
	core.lastTick = now
	completion := &recordingV2Completion{}
	core.ConfigureCompletion(completion)
	return core, writer, completion, &now
}

func idleJoin(t *testing.T, core *V2Session, identity session.Identity) {
	t.Helper()
	if err := core.JoinParticipant(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
}
func idleLeave(t *testing.T, core *V2Session, identity session.Identity) {
	t.Helper()
	if err := core.LeaveParticipant(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
}
func idleAdvance(t *testing.T, core *V2Session, now time.Time) {
	t.Helper()
	if _, err := core.AdvanceFromWall(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}

func TestUnoccupiedRuntimeEndsAfterTenMinutesDisconnected(t *testing.T) {
	core, writer, completion, now := idleSession(t)
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, idleViewer)
	saved, err := protocolv2.DecodeRecoveryMetadata(writer.envelope)
	if err != nil || saved.EmptySince == nil {
		t.Fatalf("missing durable empty time: %v", err)
	}
	start := *now
	*now = start.Add(599 * time.Second)
	idleAdvance(t, core, *now)
	if core.DurablyEnded() || completion.envelope != nil {
		t.Fatal("ended before ten minutes")
	}
	*now = start.Add(600 * time.Second)
	idleAdvance(t, core, *now)
	if !core.DurablyEnded() || completion.envelope == nil || core.Snapshot().Clock.GetTerminating().GetReason() != realtimev2.TerminationReason_TERMINATION_REASON_IDLE_TIMEOUT {
		t.Fatal("disconnected room did not complete durably at the deadline")
	}
}

func TestNeverConnectedRoomHasNoIdleTimerEvenAfterRecovery(t *testing.T) {
	core, writer, _, now := idleSession(t)
	*now = now.Add(24 * time.Hour)
	idleAdvance(t, core, *now)
	if core.DurablyEnded() {
		t.Fatal("unused room ended")
	}
	if err := core.FlushCheckpoint(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovered, _, _, recoveredNow := idleSession(t)
	*recoveredNow = *now
	if err := recovered.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	idleAdvance(t, recovered, now.Add(24*time.Hour))
	if recovered.DurablyEnded() {
		t.Fatal("unused recovered room ended")
	}
}

func TestPresenterDisconnectDoesNotEndRoomWhileViewerRemains(t *testing.T) {
	core, _, _, now := idleSession(t)
	presenter := session.Identity{ParticipantID: "presenter", Role: session.RolePresenter}
	idleJoin(t, core, presenter)
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, presenter)
	*now = now.Add(time.Hour)
	idleAdvance(t, core, *now)
	if core.DurablyEnded() {
		t.Fatal("connected viewer was ignored")
	}
	idleLeave(t, core, idleViewer)
	*now = now.Add(10 * time.Minute)
	idleAdvance(t, core, *now)
	if !core.DurablyEnded() {
		t.Fatal("last viewer disconnect did not start timer")
	}
}

func TestReentryCancelsAndNextDisconnectResetsDurableDeadline(t *testing.T) {
	core, writer, _, now := idleSession(t)
	start := *now
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, idleViewer)
	*now = start.Add(599 * time.Second)
	idleJoin(t, core, idleViewer)
	recovery, err := protocolv2.DecodeRecoveryMetadata(writer.envelope)
	if err != nil || recovery.EmptySince != nil {
		t.Fatalf("cancel was not durable: %v", err)
	}
	*now = start.Add(700 * time.Second)
	idleLeave(t, core, idleViewer)
	*now = start.Add(1299 * time.Second)
	idleAdvance(t, core, *now)
	if core.DurablyEnded() {
		t.Fatal("old deadline was retained")
	}
	*now = start.Add(1300 * time.Second)
	idleAdvance(t, core, *now)
	if !core.DurablyEnded() {
		t.Fatal("reset deadline was ignored")
	}
}

func TestDeadlineExpiredJoinCompletesBeforeAdmissionEvenWithoutTick(t *testing.T) {
	core, _, _, now := idleSession(t)
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, idleViewer)
	*now = now.Add(10 * time.Minute)
	if err := core.JoinParticipant(context.Background(), idleViewer); err == nil {
		t.Fatal("expired room revived")
	}
	if !core.DurablyEnded() {
		t.Fatal("expired join did not complete room")
	}
}

func TestIdleRecoveryKeepsSavedDeadlineAndPreservesConnectedHistory(t *testing.T) {
	for _, disconnected := range []bool{false, true} {
		t.Run(map[bool]string{false: "first-join-crash", true: "idle-crash"}[disconnected], func(t *testing.T) {
			core, writer, _, now := idleSession(t)
			start := *now
			idleJoin(t, core, idleViewer)
			if disconnected {
				idleLeave(t, core, idleViewer)
			}
			recovered, _, _, recoveredNow := idleSession(t)
			*recoveredNow = start.Add(5 * time.Minute)
			if err := recovered.RestoreCheckpoint(writer.envelope); err != nil {
				t.Fatal(err)
			}
			deadline := start.Add(10 * time.Minute)
			if !disconnected {
				deadline = recoveredNow.Add(10 * time.Minute)
			}
			*recoveredNow = deadline.Add(-time.Second)
			idleAdvance(t, recovered, *recoveredNow)
			if recovered.DurablyEnded() {
				t.Fatal("recovery advanced deadline")
			}
			*recoveredNow = deadline
			idleAdvance(t, recovered, *recoveredNow)
			if !recovered.DurablyEnded() {
				t.Fatal("recovery lost idle deadline or connection history")
			}
		})
	}
}

func TestCrashAfterDurableReentryDoesNotRestoreCancelledDeadline(t *testing.T) {
	original, writer, _, now := idleSession(t)
	start := *now
	idleJoin(t, original, idleViewer)
	idleLeave(t, original, idleViewer)
	*now = start.Add(9 * time.Minute)
	idleJoin(t, original, idleViewer)
	recovered, _, _, recoveredNow := idleSession(t)
	*recoveredNow = start.Add(11 * time.Minute)
	if err := recovered.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	idleAdvance(t, recovered, *recoveredNow)
	if recovered.DurablyEnded() {
		t.Fatal("cancelled pre-crash deadline was restored")
	}
	*recoveredNow = recoveredNow.Add(10 * time.Minute)
	idleAdvance(t, recovered, *recoveredNow)
	if !recovered.DurablyEnded() {
		t.Fatal("connected crash did not start recovery timer")
	}
}

func TestPresenceDurabilityFailureRejectsFirstJoinAndIdleCancellation(t *testing.T) {
	core, writer, _, now := idleSession(t)
	core.checkpointWriter = failingV2Checkpoint{}
	if err := core.JoinParticipant(context.Background(), idleViewer); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatalf("first join accepted without durable history: %v", err)
	}
	if len(core.presence) != 0 {
		t.Fatal("failed first join became connected")
	}
	*now = now.Add(time.Hour)
	idleAdvance(t, core, *now)
	if core.DurablyEnded() {
		t.Fatal("failed first join started timer")
	}
	core.checkpointWriter = writer
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, idleViewer)
	core.checkpointWriter = failingV2Checkpoint{}
	*now = now.Add(9 * time.Minute)
	if err := core.JoinParticipant(context.Background(), idleViewer); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatal("cancel accepted without durability")
	}
	if len(core.presence) != 0 {
		t.Fatal("failed reentry became connected")
	}
	*now = now.Add(time.Minute)
	idleAdvance(t, core, *now)
	if !core.DurablyEnded() {
		t.Fatal("failed cancel removed durable idle timer")
	}
}

func TestFailedDisconnectSaveRetriesOriginalTimestampAndCompletionRemainsFenced(t *testing.T) {
	core, writer, completion, now := idleSession(t)
	start := *now
	idleJoin(t, core, idleViewer)
	core.checkpointWriter = failingV2Checkpoint{}
	if err := core.LeaveParticipant(context.Background(), idleViewer); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatalf("disconnect save: %v", err)
	}
	if len(core.presence) != 0 {
		t.Fatal("disconnected participant remained present")
	}
	core.checkpointWriter = writer
	*now = start.Add(599 * time.Second)
	idleAdvance(t, core, *now)
	core.ConfigureCompletion(failingV2Completion{})
	*now = start.Add(600 * time.Second)
	if _, err := core.AdvanceFromWall(context.Background(), *now); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatalf("completion failure: %v", err)
	}
	if core.DurablyEnded() {
		t.Fatal("failed completion advertised success")
	}
	pending := proto.Clone(core.durability.completion.envelope)
	if err := core.JoinParticipant(context.Background(), idleViewer); !errors.Is(err, ErrV2PersistenceUnavailable) {
		t.Fatal("join revived pending completion")
	}
	core.ConfigureCompletion(completion)
	if err := core.FlushCheckpoint(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !core.DurablyEnded() || !proto.Equal(pending, completion.envelope) {
		t.Fatal("completion retry changed its durable cut")
	}
}

func TestExpiredJoinAndTickAreSerialized(t *testing.T) {
	core, _, _, now := idleSession(t)
	idleJoin(t, core, idleViewer)
	idleLeave(t, core, idleViewer)
	*now = now.Add(10 * time.Minute)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := core.JoinParticipant(context.Background(), idleViewer); err == nil {
			t.Error("join won expired deadline")
		}
	}()
	go func() {
		defer wg.Done()
		if _, err := core.AdvanceFromWall(context.Background(), *now); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()
	if !core.DurablyEnded() {
		t.Fatal("concurrent deadline was lost")
	}
}

func TestRejectedPresenterSynchronizationDoesNotCancelIdleDeadline(t *testing.T) {
	core, _, _, _ := idleSession(t)
	presenter := session.Identity{ParticipantID: "presenter", Role: session.RolePresenter}
	idleJoin(t, core, presenter)
	idleLeave(t, core, presenter)
	deadlineStart := core.emptySince
	core.inputSynchronization.SynchronizationRevision = ^uint64(0)
	core.committedRecovery = core.v2Recovery()
	if err := core.JoinParticipant(context.Background(), presenter); err == nil {
		t.Fatal("overflowed synchronization was admitted")
	}
	if !core.emptySince.Equal(deadlineStart) || len(core.presence) != 0 {
		t.Fatal("rejected synchronization cancelled idle deadline")
	}
}
