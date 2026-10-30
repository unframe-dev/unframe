package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"google.golang.org/protobuf/proto"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestMutationPublishesWithoutCheckpointAndSurvivesSaveFailure(t *testing.T) {
	core, _ := reviewSession(t)
	core.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { return errors.New("offline") })
	identity := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	cmd := v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE})
	outcome, events, err := core.RuntimeControl(context.Background(), identity, cmd)
	if err != nil || outcome.GetAccepted() == nil || len(events) != 1 {
		t.Fatalf("memory commit: outcome=%v events=%v err=%v", outcome, events, err)
	}
	if err := core.FlushCheckpoint(context.Background()); err == nil {
		t.Fatal("save should fail")
	}
	repeated, replay, err := core.RuntimeControl(context.Background(), identity, cmd)
	if err != nil || repeated.GetAccepted() == nil || len(replay) != 0 || core.Snapshot().ReliableSequence != 1 || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_EXPLICIT_PAUSE {
		t.Fatalf("save failure changed commit: %v %v", repeated, err)
	}
}

func TestBlockedCheckpointDoesNotBlockClockOrParticipant(t *testing.T) {
	core, _ := reviewSession(t)
	entered, release := make(chan struct{}), make(chan struct{})
	core.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { close(entered); <-release; return nil })
	done := make(chan error, 1)
	go func() { done <- core.FlushCheckpoint(context.Background()) }()
	defer close(release)
	<-entered
	progressed := make(chan error, 1)
	go func() {
		if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}); err != nil {
			progressed <- err
			return
		}
		_, err := core.AdvanceFromWall(context.Background(), core.lastTick.Add(6*time.Second))
		progressed <- err
	}()
	select {
	case err := <-progressed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("save blocked progress")
	}
	if core.Snapshot().Clock.RuntimeTimeMs < 6000 || core.Snapshot().ReliableSequence != 1 {
		t.Fatal("progress missing")
	}
}

func TestWorkerRetriesIdenticalCutAndCoalescesPendingCuts(t *testing.T) {
	core, _ := reviewSession(t)
	requests := make(chan *realtimev2.DurableCheckpointEnvelope, 20)
	release := make(chan struct{})
	var attempts atomic.Int32
	core.checkpointWriter = checkpointCommitObserver(func(envelope *realtimev2.DurableCheckpointEnvelope) error {
		requests <- proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
		if attempts.Add(1) == 1 {
			<-release
			return errors.New("offline")
		}
		return nil
	})
	if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "one", Role: session.RoleViewer}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- core.runCheckpointWorker(ctx, make(chan struct{}, 1), 5*time.Millisecond) }()
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Errorf("checkpoint worker stopped with %v, want context cancellation", err)
		}
	}()
	first := awaitCheckpoint(t, requests)
	for i := 0; i < 12; i++ {
		if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: fmt.Sprintf("viewer-%d", i), Role: session.RoleViewer}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(6 * time.Millisecond)
	}
	status := core.CheckpointStatus()
	if !status.InFlight || !status.Pending || status.CurrentReliableSequence != 13 {
		t.Fatalf("bounded worker status: %+v", status)
	}
	close(release)
	retry := awaitCheckpoint(t, requests)
	if !proto.Equal(first, retry) {
		t.Fatal("retry changed version or payload")
	}
	latest := awaitCheckpoint(t, requests)
	if latest.ReliableSequence != 13 || latest.CheckpointSequence <= first.CheckpointSequence+1 {
		t.Fatalf("pending cuts did not coalesce: %v", latest)
	}
	if first.ReliableSequence != 1 {
		t.Fatal("inflight cut mutated")
	}
}

func awaitCheckpoint(t *testing.T, requests <-chan *realtimev2.DurableCheckpointEnvelope) *realtimev2.DurableCheckpointEnvelope {
	t.Helper()
	select {
	case cut := <-requests:
		return cut
	case <-time.After(2 * time.Second):
		t.Fatal("checkpoint request missing")
		return nil
	}
}

func TestRecoveryWithoutCheckpointRequiresPauseAndDurableBoundary(t *testing.T) {
	core, writer := reviewSession(t)
	if err := core.RecoverWithoutCheckpoint(context.Background()); err != nil {
		t.Fatal(err)
	}
	if writer.envelope == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED || core.InputSynchronization().GetNextCommandEpoch() == 0 {
		t.Fatal("lost execution was started as a fresh session")
	}
	before := core.Snapshot().Clock.RuntimeTimeMs
	if _, err := core.AdvanceFromWall(context.Background(), time.Now().Add(time.Hour)); err != nil || core.Snapshot().Clock.RuntimeTimeMs != before {
		t.Fatal("recovery progressed without explicit resume")
	}
}

func TestCompletionRetriesSameRequestAndPublishesOnlyAfterConfirmation(t *testing.T) {
	core, _ := reviewSession(t)
	requests := make(chan *realtimev2.DurableCheckpointEnvelope, 5)
	var attempts atomic.Int32
	completion := v2CompletionObserver(func(envelope *realtimev2.DurableCheckpointEnvelope) error {
		requests <- proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
		if attempts.Add(1) == 1 {
			return errors.New("response lost")
		}
		return nil
	})
	core.ConfigureCompletion(completion)
	_, stream, unsubscribe := core.SnapshotAndSubscribe()
	defer unsubscribe()
	cmd := v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "end", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END})
	if _, _, err := core.RuntimeControl(context.Background(), session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}, cmd); err == nil {
		t.Fatal("unconfirmed end acknowledged")
	}
	first := awaitCheckpoint(t, requests)
	if core.Snapshot().Clock.GetTerminating() != nil {
		t.Fatal("unconfirmed end exposed in snapshot")
	}
	if _, err := core.AdvanceTo(context.Background(), 6000); err != nil || core.Snapshot().Clock.RuntimeTimeMs != 0 {
		t.Fatal("pending completion progressed")
	}
	select {
	case <-stream:
		t.Fatal("unconfirmed end published")
	default:
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- core.runCheckpointWorker(ctx, make(chan struct{}, 1), 5*time.Millisecond) }()
	defer func() {
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Errorf("checkpoint worker stopped with %v, want context cancellation", err)
		}
	}()
	retry := awaitCheckpoint(t, requests)
	if !proto.Equal(first, retry) {
		t.Fatal("completion retry changed immutable payload")
	}
	select {
	case <-stream:
	case <-time.After(time.Second):
		t.Fatal("confirmed end not published")
	}
	if core.Snapshot().Clock.GetTerminating() == nil {
		t.Fatal("confirmed end missing")
	}
}

func TestCheckpointConcurrencyIsBoundedAcrossSessions(t *testing.T) {
	slots := make(chan struct{}, 1)
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var active, maximum atomic.Int32
	var workers []<-chan error
	var cancels []context.CancelFunc
	for i := 0; i < 2; i++ {
		core, _ := reviewSession(t)
		core.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error {
			current := active.Add(1)
			for old := maximum.Load(); current > old && !maximum.CompareAndSwap(old, current); old = maximum.Load() {
			}
			entered <- struct{}{}
			<-release
			active.Add(-1)
			return nil
		})
		if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		done := make(chan error, 1)
		workers = append(workers, done)
		go func() { done <- core.runCheckpointWorker(ctx, slots, 5*time.Millisecond) }()
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		for _, cancel := range cancels {
			cancel()
		}
		for _, done := range workers {
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Errorf("checkpoint worker stopped with %v, want context cancellation", err)
			}
		}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("save not started")
	}
	select {
	case <-entered:
		t.Fatal("host limit exceeded")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("other session starved")
	}
	if maximum.Load() != 1 {
		t.Fatalf("concurrency: %d", maximum.Load())
	}
}

type contextCheckpointWriter func(context.Context, *realtimev2.DurableCheckpointEnvelope) error

func (write contextCheckpointWriter) WriteCheckpoint(ctx context.Context, envelope *realtimev2.DurableCheckpointEnvelope) error {
	return write(ctx, envelope)
}

func TestCheckpointOutageBeyondFiveSecondsDoesNotPauseProgress(t *testing.T) {
	raw := strings.Replace(reviewDefinition, `"cues":[]`, `"cues":[{"id":"next","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]`, 1)
	core, err := newV3RegressionSession(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	template, _ := reviewSession(t)
	entered := make(chan struct{}, 10)
	writer := contextCheckpointWriter(func(ctx context.Context, _ *realtimev2.DurableCheckpointEnvelope) error {
		entered <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	})
	if err := core.ConfigureDurability(writer, template.checkpointMetadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	core.lastTick = time.Now()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- core.runCheckpointWorker(ctx, nil, 10*time.Millisecond) }()
	defer func() {
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Errorf("checkpoint worker stopped with %v, want context cancellation", err)
		}
	}()
	if err := core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer", Role: session.RoleViewer}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("checkpoint not blocked")
	}
	start := time.Now()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for now := range ticker.C {
		if _, err := core.AdvanceFromWall(ctx, now); err != nil {
			t.Fatal(err)
		}
		if now.Sub(start) > 5500*time.Millisecond {
			break
		}
	}
	out, events, err := core.LogicalInput(session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "during-outage", LogicalEventName: "next"}))
	if err != nil || out.GetAccepted() == nil || len(events) != 2 || core.Snapshot().Clock.GetRunning() == nil || core.Snapshot().Clock.RuntimeTimeMs < 5500 || core.CheckpointStatus().LastSuccess.IsZero() == false {
		t.Fatalf("outage stopped memory progress: %v %v", out, err)
	}
}

func TestLostExecutionWithoutParticipantsCanPersistRecoveredInitialState(t *testing.T) {
	core, err := NewV2Session(json.RawMessage(reviewDefinition))
	if err != nil {
		t.Fatal(err)
	}
	template, _ := reviewSession(t)
	metadata := proto.Clone(template.checkpointMetadata).(*realtimev2.DurableCheckpointEnvelope)
	metadata.AssignmentEpoch = 2
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	if err := core.RecoverWithoutCheckpoint(context.Background()); err != nil {
		t.Fatalf("never-checkpointed execution recovery: %v; %v", err, core.v2Recovery())
	}
	if writer.envelope == nil || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED {
		t.Fatal("initial recovery was not durably paused")
	}
}

func TestPresenterRejoinPreservesRecoveredPauseUntilExplicitResume(t *testing.T) {
	original, writer := reviewSession(t)
	presenter := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	if err := original.JoinParticipant(context.Background(), presenter); err != nil {
		t.Fatal(err)
	}
	flushV2(t, original)
	recovered, _ := reviewSession(t)
	recovered.checkpointMetadata.AssignmentEpoch = 2
	if err := recovered.RestoreCheckpointFromAssignment(writer.envelope, writer.envelope); err != nil {
		t.Fatal(err)
	}
	if err := recovered.JoinParticipant(context.Background(), presenter); err != nil {
		t.Fatal(err)
	}
	if recovered.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED {
		t.Fatal("presenter reconnect overwrote recovery pause")
	}
	if _, err := recovered.AdvanceFromWall(context.Background(), time.Now().Add(time.Hour)); err != nil || recovered.Snapshot().Clock.RuntimeTimeMs != original.Snapshot().Clock.RuntimeTimeMs {
		t.Fatal("reconnect resumed recovered clock")
	}
}
