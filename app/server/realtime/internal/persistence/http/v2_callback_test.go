package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func callbackEnvelope(t *testing.T) *realtimev2.DurableCheckpointEnvelope {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&realtimev2.CanonicalRuntimeSnapshot{
		SchemaVersion: 2, ReliableSequence: 10,
		Clock:              &realtimev2.RuntimeClockSnapshot{Status: &realtimev2.RuntimeClockSnapshot_Running{Running: &realtimev2.Running{}}},
		Progression:        &realtimev2.ProgressionRuntimeState{CurrentGroupId: "group", GroupEntryEpoch: 1, CurrentStepId: "step", StepEntryEpoch: 1, Phase: &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}},
		StepExecution:      &realtimev2.StepExecutionSnapshot{StepEntryEpoch: 1},
		PresentationOrigin: &realtimev2.PresentationOrigin{Pose: &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	return &realtimev2.DurableCheckpointEnvelope{
		SchemaVersion: 2, CheckpointSequence: 2, SessionId: "00000000-0000-4000-8000-000000000001", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 3,
		Publication:    &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)},
		DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64),
		CanonicalSnapshotHash: "sha256:" + hex.EncodeToString(digest[:]), CanonicalSnapshotPayload: payload, ReliableSequence: 10,
	}
}

func TestCheckpointEnvelopePersistsTypedV2Payload(t *testing.T) {
	envelope := callbackEnvelope(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/callbacks/checkpoints" || request.Header.Get("Authorization") != "Bearer service-token" {
			t.Errorf("unexpected callback request %s with bearer %q", request.URL.Path, request.Header.Get("Authorization"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		payload, ok := body["payload"].(map[string]any)
		if !ok || payload["schemaVersion"] != float64(2) || payload["checkpointSequence"] != "2" || body["lastSequence"] != float64(10) {
			t.Errorf("callback body = %#v", body)
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	result, err := client.CheckpointEnvelope(context.Background(), envelope, 4)
	if err != nil || !result.Applied {
		t.Fatalf("checkpoint result = %#v, error = %v", result, err)
	}
}

func TestCompletionEnvelopePersistsFinalTypedV2Payload(t *testing.T) {
	envelope := callbackEnvelope(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/callbacks/completions" {
			t.Errorf("unexpected callback path %s", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		checkpoint, ok := body["finalCheckpoint"].(map[string]any)
		if !ok || checkpoint["schemaVersion"] != float64(2) || body["participantCount"] != float64(1) || body["checkpointVersion"] != float64(2) {
			t.Errorf("completion body = %#v", body)
		}
		_, _ = response.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	result, err := client.CompleteEnvelope(context.Background(), envelope, 4, "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z", []Participant{{UserID: "presenter-1", Role: "presenter"}})
	if err != nil || !result.Applied {
		t.Fatalf("completion result = %#v, error = %v", result, err)
	}
}

func TestCheckpointEnvelopeRejectsTamperedPayloadBeforeHTTP(t *testing.T) {
	envelope := callbackEnvelope(t)
	envelope.CanonicalSnapshotPayload = append(envelope.CanonicalSnapshotPayload, 0x78, 0x01)
	client := NewClient(Config{})
	if _, err := client.CheckpointEnvelope(context.Background(), envelope, 4); err != ErrInvalidCallback {
		t.Fatalf("tampered payload error = %v", err)
	}
}

func recoveryEnvelope(t *testing.T) *realtimev2.DurableCheckpointEnvelope {
	t.Helper()
	envelope := callbackEnvelope(t)
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&realtimev2.RuntimeRecoveryMetadata{
		StartedAt:    "2026-10-02T00:00:00Z",
		Participants: []*realtimev2.RuntimeParticipantHistory{{ParticipantId: "presenter-1", Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER}},
		Commands:     []*realtimev2.RuntimeCommandHistory{{Key: "presenter-1\x00command-1", Fingerprint: "sha256:" + strings.Repeat("d", 64), RememberedAtUnixMs: 1790899260000, Outcome: &realtimev2.CommandOutcome{ClientEventId: "command-1", Result: &realtimev2.CommandOutcome_Accepted{Accepted: &realtimev2.CommandAccepted{CanonicalEventId: "event-10", ReliableSequence: 10, CueEvaluation: &realtimev2.CommandAccepted_CueNotSelected{CueNotSelected: &realtimev2.CueNotSelected{}}}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	hash := "sha256:" + hex.EncodeToString(digest[:])
	envelope.RecoveryPayload = payload
	envelope.RecoveryHash = &hash
	return envelope
}

func TestCheckpointEnvelopeRejectsTamperedRecoveryBeforeHTTP(t *testing.T) {
	envelope := recoveryEnvelope(t)
	envelope.RecoveryPayload = append(envelope.RecoveryPayload, 0x78, 0x01)
	client := NewClient(Config{})
	if _, err := client.CheckpointEnvelope(context.Background(), envelope, 4); err != ErrInvalidCallback {
		t.Fatalf("tampered recovery error=%v", err)
	}
}

func TestCheckpointEnvelopePreservesRecoveryPayloadOverHTTP(t *testing.T) {
	envelope := recoveryEnvelope(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad callback", 400)
			return
		}
		restored := new(realtimev2.DurableCheckpointEnvelope)
		if err := protojson.Unmarshal(body.Payload, restored); err != nil || !proto.Equal(envelope, restored) {
			t.Errorf("recovery did not survive callback JSON: %v", err)
		}
		_, _ = w.Write([]byte(`{"applied":true}`))
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	if _, err := client.CheckpointEnvelope(context.Background(), envelope, 4); err != nil {
		t.Fatal(err)
	}
}
