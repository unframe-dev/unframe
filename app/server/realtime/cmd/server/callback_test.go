package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"google.golang.org/protobuf/proto"
)

func TestV2PersistenceAcceptsDuplicateAfterRetry(t *testing.T) {
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
	envelope := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, CheckpointSequence: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 3, Publication: &presentationv2.PublicationFence{PresentationId: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64), CanonicalSnapshotHash: "sha256:" + hex.EncodeToString(digest[:]), CanonicalSnapshotPayload: payload, ReliableSequence: 10}
	for _, operation := range []string{"checkpoint", "completion"} {
		t.Run(operation, func(t *testing.T) {
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts++
				if attempts == 1 {
					http.Error(w, "response lost after commit", http.StatusServiceUnavailable)
					return
				}
				_, _ = w.Write([]byte(`{"applied":false}`))
			}))
			defer server.Close()
			writer := v2CheckpointCallback{client: persistencehttp.NewClient(persistencehttp.Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true, RetryDelay: func(int) time.Duration { return 0 }}), revision: 4}
			var err error
			if operation == "checkpoint" {
				err = writer.WriteCheckpoint(context.Background(), envelope)
			} else {
				err = writer.CompleteCheckpoint(context.Background(), envelope, "2026-10-02T00:00:00Z", "2026-10-02T00:01:00Z", []runtimecore.V2Participant{{UserID: "presenter-1", Role: "presenter"}})
			}
			if err != nil {
				t.Fatalf("durably committed duplicate must succeed: %v", err)
			}
			if attempts != 2 {
				t.Fatalf("attempts=%d want 2", attempts)
			}
		})
	}
}
