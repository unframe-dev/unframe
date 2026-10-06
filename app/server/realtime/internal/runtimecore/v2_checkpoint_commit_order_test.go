package runtimecore

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func TestV2CheckpointCallbackDoesNotBlockCommittedCutReaders(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}
	entered := make(chan struct{})
	release := make(chan struct{})
	var writes atomic.Int32
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	if err := core.ConfigureDurability(checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error {
		if writes.Add(1) == 1 {
			close(entered)
			<-release
		}
		return nil
	}), metadata, catalog); err != nil {
		t.Fatal(err)
	}
	committed := make(chan error, 1)
	go func() {
		_, _, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "pause-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE})
		committed <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("checkpoint callback did not start")
	}
	read := make(chan *realtimev2.CanonicalRuntimeSnapshot, 1)
	go func() { read <- core.Snapshot() }()
	select {
	case cut := <-read:
		if cut.ReliableSequence != 0 || cut.Clock.GetRunning() == nil {
			t.Fatalf("candidate cut leaked before checkpoint acknowledgement: %#v", cut)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("snapshot reader blocked on checkpoint callback")
	}
	type readCut struct {
		sequence uint64
		presence int
		anchors  int
		replay   int
		sub      <-chan *realtimev2.ProjectedReliableEvent
		closeSub func()
		err      error
	}
	reads := make(chan readCut, 1)
	go func() {
		cut, presence, sub, unsubscribe := core.SnapshotPresenceAndSubscribe()
		anchors, anchorErr := core.ProjectedAnchorBindings(nil, 1)
		log, replayErr := core.ReplayThrough(0, 0)
		result := readCut{sequence: cut.ReliableSequence, presence: len(presence.Participants), anchors: len(anchors), replay: len(log), sub: sub, closeSub: unsubscribe, err: errors.Join(anchorErr, replayErr)}
		reads <- result
	}()
	var subscribed readCut
	select {
	case result := <-reads:
		subscribed = result
		defer result.closeSub()
		if result.err != nil || result.sequence != 0 || result.presence != 0 || result.anchors != 0 || result.replay != 0 {
			t.Fatalf("reader saw uncommitted cut: %#v", result)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("presence, replay, or anchor reader blocked on checkpoint callback")
	}
	select {
	case event := <-subscribed.sub:
		t.Fatalf("event published before checkpoint acknowledgement: %#v", event)
	default:
	}
	joined := make(chan error, 1)
	go func() {
		joined <- core.JoinParticipant(context.Background(), session.Identity{ParticipantID: "viewer-1", Role: session.RoleViewer})
	}()
	select {
	case err := <-joined:
		t.Fatalf("second mutation finished before first checkpoint acknowledgement: %v", err)
	case <-time.After(50 * time.Millisecond):
		if writes.Load() != 1 {
			t.Fatalf("concurrent checkpoint callbacks: %d", writes.Load())
		}
	}
	close(release)
	if err := <-committed; err != nil {
		t.Fatal(err)
	}
	if err := <-joined; err != nil {
		t.Fatal(err)
	}
	if writes.Load() != 2 || core.Snapshot().ReliableSequence != 2 {
		t.Fatalf("serialized checkpoint sequence: writes=%d snapshot=%#v", writes.Load(), core.Snapshot())
	}
	select {
	case event := <-subscribed.sub:
		if event == nil || event.Sequence != 1 {
			t.Fatalf("subscriber missed first committed event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber did not receive first committed event")
	}
}

type checkpointCommitObserver func(*realtimev2.DurableCheckpointEnvelope) error

func (observe checkpointCommitObserver) WriteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope) error {
	return observe(envelope)
}

func TestV2CheckpointContainsCommittedCutBeforeEventPublication(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}}},"variables":{},"timelines":{}}`)
	metadata := &realtimev2.DurableCheckpointEnvelope{
		SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1",
		RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1,
		Publication: &presentationv2.PublicationFence{
			PresentationId: "presentation-1", PublicationEpoch: 1,
			PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		DefinitionHash:   "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
	}
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}

	for _, test := range []struct {
		name       string
		writerErr  error
		wantReason realtimev2.PauseReason
	}{
		{name: "saved"},
		{name: "callback_failed", writerErr: errors.New("callback unavailable"), wantReason: realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED},
		{name: "duplicate_rejected", writerErr: errors.New("checkpoint callback was not applied"), wantReason: realtimev2.PauseReason_PAUSE_REASON_ATOMIC_COMMIT_FAILED},
	} {
		t.Run(test.name, func(t *testing.T) {
			core, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			var saved *realtimev2.DurableCheckpointEnvelope
			writer := checkpointCommitObserver(func(envelope *realtimev2.DurableCheckpointEnvelope) error {
				cut := core.Snapshot()
				published, err := core.ReplayThrough(0, 0)
				if cut.ReliableSequence != 0 || err != nil || len(published) != 0 {
					t.Fatal("reliable event was published before checkpoint acknowledgement")
				}
				decoded, err := protocolv2.DecodeCheckpoint(envelope, metadata, catalog)
				if err != nil || decoded.ReliableSequence != 1 || decoded.Clock.GetPaused() == nil {
					t.Fatalf("checkpoint cut is not recoverable: sequence=%v error=%v", decoded.GetReliableSequence(), err)
				}
				saved = proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
				return test.writerErr
			})
			if err := core.ConfigureDurability(writer, metadata, catalog); err != nil {
				t.Fatal(err)
			}
			_, published, err := core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{
				ClientEventId: "pause-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE,
			})
			if saved == nil {
				t.Fatal("checkpoint writer was not called")
			}
			if test.writerErr != nil {
				cut := core.Snapshot()
				log, replayErr := core.ReplayThrough(0, 0)
				if err == nil || len(published) != 0 || replayErr != nil || len(log) != 0 || cut.ReliableSequence != 0 || cut.Clock.GetPaused().Reason != test.wantReason {
					t.Fatalf("failed checkpoint published mutation: events=%d log=%d snapshot=%v error=%v", len(published), len(log), cut, err)
				}
				return
			}
			log, replayErr := core.ReplayThrough(0, core.Snapshot().ReliableSequence)
			if err != nil || replayErr != nil || len(published) != 1 || len(log) != 1 || saved.ReliableSequence != published[0].Sequence || saved.ReliableSequence != core.Snapshot().ReliableSequence {
				t.Fatalf("published cut differs from saved checkpoint: events=%v checkpoint=%v error=%v", published, saved.ReliableSequence, err)
			}
			recovered, err := NewV2Session(definition)
			if err != nil {
				t.Fatal(err)
			}
			if err := recovered.ConfigureDurability(checkpointCommitObserver(func(*realtimev2.DurableCheckpointEnvelope) error { return nil }), metadata, catalog); err != nil {
				t.Fatal(err)
			}
			if err := recovered.RestoreCheckpoint(saved); err != nil || recovered.Snapshot().ReliableSequence != published[0].Sequence {
				t.Fatalf("published cut cannot be restored: error=%v", err)
			}
		})
	}
}
