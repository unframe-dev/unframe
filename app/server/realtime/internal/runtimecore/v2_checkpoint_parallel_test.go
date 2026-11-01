package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func v2SnapshotWithin(t *testing.T, core *V2Session) *realtimev2.CanonicalRuntimeSnapshot {
	t.Helper()
	read := make(chan *realtimev2.CanonicalRuntimeSnapshot, 1)
	go func() { read <- core.Snapshot() }()
	select {
	case cut := <-read:
		return cut
	case <-time.After(250 * time.Millisecond):
		t.Fatal("checkpoint callback blocked snapshot reader")
		return nil
	}
}

func v2ParallelCore(t *testing.T, definition json.RawMessage, writer V2CheckpointWriter) *V2Session {
	t.Helper()
	core, err := newV3RegressionSession(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 1, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	return core
}

func TestV2LeaseExpiryDoesNotWaitForCheckpoint(t *testing.T) {
	core, _ := reviewSession(t)
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	core.checkpointWriter = checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { close(entered); <-release; return nil })
	go func() { _ = core.FlushCheckpoint(context.Background()) }()
	<-entered
	done := make(chan struct{})
	go func() { core.PauseLeaseExpired(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("lease fencing blocked on storage")
	}
	if core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED {
		t.Fatal("lease fence lost")
	}
}

type v2CompletionObserver func(*realtimev2.DurableCheckpointEnvelope) error

func (observe v2CompletionObserver) CompleteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope, _, _ string, _ []V2Participant) error {
	return observe(envelope)
}

func TestV2CompletionCallbackKeepsPreviousCutReadable(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	for _, test := range []struct {
		name string
		err  error
	}{{name: "saved"}, {name: "failed", err: errors.New("completion callback unavailable")}} {
		t.Run(test.name, func(t *testing.T) {
			core := v2ParallelCore(t, definition, checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { return nil }))
			entered, release := make(chan struct{}), make(chan struct{})
			defer func() {
				select {
				case <-release:
				default:
					close(release)
				}
			}()
			core.ConfigureCompletion(v2CompletionObserver(func(*realtimev2.DurableCheckpointEnvelope) error {
				close(entered)
				<-release
				return test.err
			}))
			finished := make(chan error, 1)
			go func() {
				_, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "end-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END}))
				finished <- err
			}()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("completion callback did not start")
			}
			type subscription struct {
				cut         *realtimev2.CanonicalRuntimeSnapshot
				sub         <-chan *realtimev2.ProjectedReliableEvent
				unsubscribe func()
			}
			read := make(chan subscription, 1)
			go func() {
				cut, _, sub, unsubscribe, _ := core.SnapshotPresenceAndSubscribe()
				read <- subscription{cut: cut, sub: sub, unsubscribe: unsubscribe}
			}()
			var observed subscription
			select {
			case observed = <-read:
				defer observed.unsubscribe()
			case <-time.After(250 * time.Millisecond):
				t.Fatal("completion callback blocked snapshot subscription")
			}
			cut, sub := observed.cut, observed.sub
			if cut.ReliableSequence != 0 || cut.Clock.GetRunning() == nil {
				t.Fatalf("terminating candidate leaked: %#v", cut)
			}
			close(release)
			err := <-finished
			if test.err != nil {
				if err == nil || core.Snapshot().ReliableSequence != 0 || core.Snapshot().Clock.GetRunning() == nil {
					t.Fatalf("failed completion published: cut=%#v err=%v", core.Snapshot(), err)
				}
				select {
				case event := <-sub:
					t.Fatalf("failed completion emitted event: %#v", event)
				default:
				}
				return
			}
			if err != nil || core.Snapshot().Clock.GetTerminating() == nil {
				t.Fatalf("completion was not committed: cut=%#v err=%v", core.Snapshot(), err)
			}
			select {
			case event := <-sub:
				if event == nil || event.Sequence != 1 {
					t.Fatalf("completion subscriber first event=%#v", event)
				}
			case <-time.After(time.Second):
				t.Fatal("completion subscriber missed committed event")
			}
		})
	}
}

func TestV2ResumeValidatorRunsWithoutSessionMutex(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core := v2ParallelCore(t, definition, checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { return nil }))
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE})); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	core.ConfigureResumeValidation(func(context.Context) error { close(entered); <-release; return nil })
	resumed := make(chan error, 1)
	go func() {
		_, _, err := core.RuntimeControl(context.Background(), identity, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME}))
		resumed <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("resume validator did not start")
	}
	read := make(chan *realtimev2.CanonicalRuntimeSnapshot, 1)
	go func() { read <- core.Snapshot() }()
	select {
	case cut := <-read:
		if cut.ReliableSequence != 1 || cut.Clock.GetPaused() == nil {
			t.Fatalf("resume candidate leaked: %#v", cut)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("resume validator blocked snapshot read")
	}
	close(release)
	if err := <-resumed; err != nil || core.Snapshot().Clock.GetRunning() == nil {
		t.Fatalf("resume failed after external validation: %#v %v", core.Snapshot(), err)
	}
}

func TestV2AdvanceFromWallIgnoresOlderTickAfterSerialization(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := newV3RegressionSession(definition)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Unix(100, 0)
	core.lastTick = t0
	for _, at := range []time.Time{t0.Add(20 * time.Millisecond), t0.Add(10 * time.Millisecond), t0.Add(30 * time.Millisecond)} {
		if _, err := core.AdvanceFromWall(context.Background(), at); err != nil {
			t.Fatal(err)
		}
	}
	if cut := core.Snapshot(); cut.Clock.RuntimeTimeMs != 30 {
		t.Fatalf("older tick counted elapsed time twice: %d", cut.Clock.RuntimeTimeMs)
	}
}
