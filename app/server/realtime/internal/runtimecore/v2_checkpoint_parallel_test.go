package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
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
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
		t.Fatal(err)
	}
	return core
}

func TestV2LeaseExpiryWaitsForCheckpointAndRemainsPaused(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	entered, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	core := v2ParallelCore(t, definition, checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error {
		close(entered)
		<-release
		return nil
	}))
	joined := make(chan error, 1)
	go func() {
		joined <- core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer-1", Role: session.RoleViewer})
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("checkpoint callback did not start")
	}
	if cut := v2SnapshotWithin(t, core); cut.ReliableSequence != 0 || cut.Clock.GetRunning() == nil {
		t.Fatalf("unacknowledged join leaked: %#v", cut)
	}
	paused := make(chan struct{})
	go func() { core.PauseLeaseExpired(); close(paused) }()
	select {
	case <-paused:
		t.Fatal("lease pause overtook pending checkpoint")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-joined; err != nil {
		t.Fatal(err)
	}
	select {
	case <-paused:
	case <-time.After(time.Second):
		t.Fatal("lease pause was lost after checkpoint acknowledgement")
	}
	cut := core.Snapshot()
	if cut.ReliableSequence != 1 || cut.Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED {
		t.Fatalf("lease pause was overwritten: %#v", cut)
	}
}

type v2CompletionObserver func(*realtimev2.DurableCheckpointEnvelope) error

func (observe v2CompletionObserver) CompleteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope, _, _ string, _ []V2Participant) error {
	return observe(envelope)
}

func TestV2CompletionCallbackKeepsPreviousCutReadable(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
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
				_, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "end-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END})
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
				cut, _, sub, unsubscribe := core.SnapshotPresenceAndSubscribe()
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
				if err == nil || core.Snapshot().ReliableSequence != 0 || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED {
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
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core := v2ParallelCore(t, definition, checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { return nil }))
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "pause-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}); err != nil {
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
		_, _, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "resume-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})
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

func TestV2TrackingCheckpointFailureRestoresEphemeralEvaluator(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","stage":{"zones":{"zone":{"id":"zone","owner":{"kind":"presentation"},"center":[0,0,0],"size":[2,2,2]}}},"scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"enter","priority":1,"order":0,"trigger":{"kind":"zoneEdge","actor":{"kind":"system","source":"tracking"},"subject":{"kind":"participant","owner":{"kind":"presenter"}},"zoneId":"zone","edge":"enter","dwellMilliseconds":0,"hysteresisMeters":0},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	entered, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	core := v2ParallelCore(t, definition, checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error {
		close(entered)
		<-release
		return errors.New("checkpoint unavailable")
	}))
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	calibration := trackingTestPose(0, 0, 0)
	outside := trackingTestFrame(1, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, events, err := core.AcceptTracking(context.Background(), identity, outside, time.Unix(100, 0), 1); err != nil || len(events) != 0 {
		t.Fatalf("outside seed: events=%#v err=%v", events, err)
	}
	core.mu.Lock()
	before := core.tracking.Clone()
	core.mu.Unlock()
	inside := trackingTestFrame(2, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	failed := make(chan error, 1)
	go func() {
		_, _, err := core.AcceptTracking(context.Background(), identity, inside, time.Unix(100, 1), 2)
		failed <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("tracking checkpoint callback did not start")
	}
	readTracking := make(chan v2TrackingEvaluator, 1)
	go func() {
		core.mu.Lock()
		defer core.mu.Unlock()
		readTracking <- core.tracking.Clone()
	}()
	var during v2TrackingEvaluator
	select {
	case during = <-readTracking:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("checkpoint callback blocked tracking reader")
	}
	if !reflect.DeepEqual(before, during) || core.Snapshot().ReliableSequence != 0 {
		t.Fatal("unacknowledged tracking edge or canonical cut leaked")
	}
	close(release)
	if err := <-failed; err == nil {
		t.Fatal("failed tracking checkpoint was accepted")
	}
	core.mu.Lock()
	after := core.tracking.Clone()
	core.mu.Unlock()
	if !reflect.DeepEqual(before, after) || core.Snapshot().ReliableSequence != 0 || core.Snapshot().Clock.GetPaused().Reason != realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED {
		t.Fatal("failed tracking checkpoint did not roll back detector and pause")
	}
}

func TestV2AdvanceFromWallIgnoresOlderTickAfterSerialization(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
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
