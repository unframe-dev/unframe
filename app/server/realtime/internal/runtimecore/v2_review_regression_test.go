package runtimecore

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

const reviewDefinition = `{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`

func reviewSession(t *testing.T) (*V2Session, *recordingV2Checkpoint) {
	t.Helper()
	s, err := NewV2Session(json.RawMessage(reviewDefinition))
	if err != nil {
		t.Fatal(err)
	}
	w := &recordingV2Checkpoint{}
	m := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	if err := s.ConfigureDurability(w, m, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}); err != nil {
		t.Fatal(err)
	}
	return s, w
}
func TestV2WallTickCheckpointsAtBoundedCadence(t *testing.T) {
	s, w := reviewSession(t)
	start := s.lastTick
	for i := 1; i <= 49; i++ {
		if _, err := s.AdvanceFromWall(context.Background(), start.Add(time.Duration(i)*20*time.Millisecond)); err != nil {
			t.Fatal(err)
		}
	}
	if w.envelope != nil {
		t.Fatal("idle wall ticks wrote checkpoints before cadence")
	}
	if s.Snapshot().Clock.RuntimeTimeMs != 980 {
		t.Fatal("clock did not advance")
	}
	if _, err := s.AdvanceFromWall(context.Background(), start.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if w.envelope == nil {
		t.Fatal("clock checkpoint missing at cadence")
	}
}
func TestV2SubscriptionBoundsQueuedBytes(t *testing.T) {
	s, _ := reviewSession(t)
	_, events, closeSub := s.SnapshotAndSubscribe()
	defer closeSub()
	s.mu.Lock()
	s.publishV2Events([]*realtimev2.ProjectedReliableEvent{{EventId: strings.Repeat("x", 600<<10)}, {EventId: strings.Repeat("y", 600<<10)}})
	s.mu.Unlock()
	if _, ok := <-events; !ok {
		t.Fatal("first bounded event missing")
	}
	if _, ok := <-events; ok {
		t.Fatal("subscription exceeded 1 MiB")
	}
}
func TestV2CanonicalCatalogSupportsTransformTimelineArrays(t *testing.T) {
	for _, property := range []string{"transform.position", "transform.scale", "transform.rotation"} {
		t.Run(property, func(t *testing.T) {
			var def map[string]any
			_ = json.Unmarshal([]byte(reviewDefinition), &def)
			def["scene"].(map[string]any)["nodes"] = map[string]any{"a": map[string]any{"id": "a", "kind": "container", "owner": map[string]any{"kind": "presentation"}, "parent": map[string]any{"kind": "stage"}, "transform": map[string]any{"position": []int{0, 0, 0}, "rotation": []int{0, 0, 0, 1}, "scale": []int{1, 1, 1}}, "active": true, "visible": true, "opacity": 1}}
			value := []int{1, 2, 3}
			if property == "transform.rotation" {
				value = []int{0, 0, 0, 1}
			}
			def["flow"].(map[string]any)["timelines"] = map[string]any{"move": map[string]any{"id": "move", "owner": map[string]any{"kind": "presentation"}, "durationMilliseconds": 100, "tracks": []any{map[string]any{"target": map[string]any{"nodeId": "a", "property": property}, "keyframes": []any{map[string]any{"timeMilliseconds": 0, "value": value}, map[string]any{"timeMilliseconds": 100, "value": value}}}}}}
			raw, _ := json.Marshal(def)
			catalog, err := BuildV2CanonicalCatalog(raw)
			if err != nil {
				t.Fatal(err)
			}
			frame := catalog.Timelines[0].Tracks[0].Keyframes[0]
			if property == "transform.rotation" {
				if frame.GetQuaternion().GetValue().GetW() != 1 {
					t.Fatal("quaternion variant missing")
				}
			} else if frame.GetVector3().GetValue().GetZ() != 3 {
				t.Fatal("vector3 variant missing")
			}
		})
	}
}

type reviewCompletion struct {
	startedAt    string
	participants []V2Participant
}

func (w *reviewCompletion) CompleteCheckpoint(_ context.Context, _ *realtimev2.DurableCheckpointEnvelope, startedAt, _ string, participants []V2Participant) error {
	w.startedAt = startedAt
	w.participants = participants
	return nil
}
func TestV2RecoveryRetainsCompletionHistoryAndCommandOutcome(t *testing.T) {
	s, w := reviewSession(t)
	started := s.startedAt.UTC().Format(time.RFC3339Nano)
	viewer := session.Identity{ParticipantID: "viewer-1", Role: session.RoleViewer}
	if err := s.JoinParticipant(context.Background(), viewer); err != nil {
		t.Fatal(err)
	}
	if err := s.LeaveParticipant(context.Background(), viewer); err != nil {
		t.Fatal(err)
	}
	presenter := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	command := &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}
	first, _, err := s.RuntimeControl(context.Background(), presenter, command)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := reviewSession(t)
	if err := restored.RestoreCheckpoint(w.envelope); err != nil {
		t.Fatal(err)
	}
	second, events, err := restored.RuntimeControl(context.Background(), presenter, command)
	if err != nil || len(events) != 0 || !proto.Equal(first, second) {
		t.Fatalf("retry outcome changed: %v %v", second, err)
	}
	changed := proto.Clone(command).(*realtimev2.RuntimeControlCommand)
	changed.Kind = realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME
	if _, _, err := restored.RuntimeControl(context.Background(), presenter, changed); err != ErrV2IdempotencyKeyReused {
		t.Fatalf("fingerprint error = %v", err)
	}
	completion := &reviewCompletion{}
	restored.ConfigureCompletion(completion)
	if _, _, err := restored.RuntimeControl(context.Background(), presenter, &realtimev2.RuntimeControlCommand{ClientEventId: "end", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END}); err != nil {
		t.Fatal(err)
	}
	if completion.startedAt != started || len(completion.participants) != 1 || completion.participants[0] != (V2Participant{UserID: "viewer-1", Role: "viewer"}) {
		t.Fatalf("completion lost history: %#v", completion)
	}
}
func TestV2RecoveryRetainsOutcomeExpiration(t *testing.T) {
	s, w := reviewSession(t)
	identity := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	command := &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}
	if _, _, err := s.RuntimeControl(context.Background(), identity, command); err != nil {
		t.Fatal(err)
	}
	snapshot := s.Snapshot()
	recovery, err := protocolv2.DecodeRecoveryMetadata(w.envelope)
	if err != nil {
		t.Fatal(err)
	}
	recovery.Commands[0].RememberedAtUnixMs = time.Now().Add(-16 * time.Minute).UnixMilli()
	w.envelope.RecoveryPayload, _ = proto.MarshalOptions{Deterministic: true}.Marshal(recovery)
	checkpoint, err := protocolv2.EncodeCheckpoint(snapshot, w.envelope, s.checkpointCatalog)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := reviewSession(t)
	if err := restored.RestoreCheckpoint(checkpoint); err != nil {
		t.Fatal(err)
	}
	if _, events, err := restored.RuntimeControl(context.Background(), identity, command); err != nil || len(events) != 0 {
		t.Fatalf("expired command failed: %v %v", events, err)
	}
	if restored.committedRecovery.Commands[0].Outcome.GetNoOp() == nil {
		t.Fatal("expired accepted outcome was reused")
	}
}
func TestV2FailedOutcomeCommitDoesNotRetainCommand(t *testing.T) {
	s, _ := reviewSession(t)
	s.checkpointWriter = failingV2Checkpoint{}
	identity := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	command := &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}
	if _, _, err := s.RuntimeControl(context.Background(), identity, command); err == nil {
		t.Fatal("failed checkpoint accepted")
	}
	s.checkpointWriter = &recordingV2Checkpoint{}
	result, _, err := s.RuntimeControl(context.Background(), identity, command)
	if err != nil || result.GetNoOp() == nil {
		t.Fatalf("uncommitted outcome survived: %v %v", result, err)
	}
}
func TestV2RestoreRejectsMissingRecoveryHistory(t *testing.T) {
	s, _ := reviewSession(t)
	snapshot := s.Snapshot()
	s.checkpointMetadata.CheckpointSequence = 1
	checkpoint, err := protocolv2.EncodeCheckpoint(snapshot, s.checkpointMetadata, s.checkpointCatalog)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreCheckpoint(checkpoint); err == nil {
		t.Fatal("missing recovery history accepted")
	}
}

func TestV2SubscriptionReclaimsConsumedBytes(t *testing.T) {
	s, _ := reviewSession(t)
	_, _, events, closeSub := s.SnapshotPresenceAndSubscribe()
	defer closeSub()
	event := &realtimev2.ProjectedReliableEvent{EventId: strings.Repeat("x", 600<<10)}
	publish := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.publishV2Events([]*realtimev2.ProjectedReliableEvent{event})
	}
	publish()
	if _, ok := <-events; !ok {
		t.Fatal("first event missing")
	}
	publish()
	if _, ok := <-events; !ok {
		t.Fatal("consumed event still charged to queue")
	}
}

func TestV2RecoveryRetainsRejectedAndNoOpOutcomes(t *testing.T) {
	identity := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	for _, kind := range []string{"logical", "interaction", "control"} {
		t.Run(kind, func(t *testing.T) {
			s, w := reviewSession(t)
			execute := func(core *V2Session) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
				switch kind {
				case "logical":
					return core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "retry", LogicalEventName: "missing"})
				case "interaction":
					return core.SurfaceInteraction(identity, &realtimev2.SurfaceInteractionCommand{ClientEventId: "retry", SurfaceId: "missing", InteractionId: "click"})
				default:
					return core.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "retry", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME})
				}
			}
			first, _, err := execute(s)
			if err != nil {
				t.Fatal(err)
			}
			if w.envelope == nil {
				t.Fatal("outcome did not persist")
			}
			restored, _ := reviewSession(t)
			if err := restored.RestoreCheckpoint(w.envelope); err != nil {
				t.Fatal(err)
			}
			second, events, err := execute(restored)
			if err != nil || len(events) != 0 || !proto.Equal(first, second) {
				t.Fatalf("outcome changed across restart: %v %v", second, err)
			}
		})
	}
}

func TestV2DurableCommandFingerprintsFollowWireContract(t *testing.T) {
	identity := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	for _, test := range []struct {
		variant, want string
		origin        uint64
	}{
		{"logical_input", "sha256:fda9f3389deaf56a2b7a4dfad908829a49527954ee7917e9506c36c42b3a7c58", 0},
		{"surface_interaction", "sha256:cb7ef53765864631ae39fc3f5636d3d7c886f00652df42804b0f3993abcb1357", 5},
		{"runtime_control", "sha256:b38e9bb0dc595375c5c794ca42d1dd7e17ba86dfcf3bb49532ff9520c2a80470", 7},
	} {
		t.Run(test.variant, func(t *testing.T) {
			s, w := reviewSession(t)
			s.snapshot.PresentationOrigin.Version = test.origin
			switch test.variant {
			case "logical_input":
				_, _, _ = s.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "hash", LogicalEventName: "next", PresentationOriginVersion: test.origin})
			case "surface_interaction":
				_, _, _ = s.SurfaceInteraction(identity, &realtimev2.SurfaceInteractionCommand{ClientEventId: "hash", SurfaceId: "screen", InteractionId: "click", PresentationOriginVersion: test.origin})
			case "runtime_control":
				_, _, _ = s.RuntimeControl(context.Background(), identity, &realtimev2.RuntimeControlCommand{ClientEventId: "hash", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE, PresentationOriginVersion: test.origin})
			}
			recovery, err := protocolv2.DecodeRecoveryMetadata(w.envelope)
			if err != nil {
				t.Fatal(err)
			}
			if recovery.Commands[0].Fingerprint != test.want {
				t.Fatalf("fingerprint = %s", recovery.Commands[0].Fingerprint)
			}
		})
	}
}

func TestV2GuardFalseTimerPersistsFiredStateBeforeClockCadence(t *testing.T) {
	definition := strings.Replace(reviewDefinition, `"cues":[]`, `"cues":[{"id":"timer","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":20},"firePolicy":{"kind":"oncePerStepEntry"},"guard":{"kind":"compare","left":{"kind":"literal","value":true},"operator":"eq","right":false},"actions":[],"next":{"kind":"stay"}}]`, 1)
	s, w := reviewSession(t)
	timerSession, err := NewV2Session(json.RawMessage(definition))
	if err != nil {
		t.Fatal(err)
	}
	if err := timerSession.ConfigureDurability(w, s.checkpointMetadata, s.checkpointCatalog); err != nil {
		t.Fatal(err)
	}
	if events, err := timerSession.AdvanceFromWall(context.Background(), timerSession.lastTick.Add(20*time.Millisecond)); err != nil || len(events) != 0 {
		t.Fatalf("guard false timer: %v %v", events, err)
	}
	if w.envelope == nil {
		t.Fatal("timer fired without immediate checkpoint")
	}
	stored, err := protocolv2.DecodeCheckpoint(w.envelope, timerSession.checkpointMetadata, timerSession.checkpointCatalog)
	if err != nil || len(stored.StepExecution.Timers) != 1 || !stored.StepExecution.Timers[0].Fired {
		t.Fatalf("timer fired state lost: %v %v", stored, err)
	}
}
