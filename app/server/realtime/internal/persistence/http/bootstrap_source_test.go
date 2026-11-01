package http

import (
	"context"
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestBootstrapValidatesIndependentCheckpointSource(t *testing.T) {
	for _, test := range []struct {
		name   string
		source any
		valid  bool
	}{
		{"missing", nil, false},
		{"authorized previous assignment", map[string]any{"runtimeId": "runtime-1", "runtimeKind": "Cloud", "assignmentEpoch": 3, "checkpointSequence": 2}, true},
		{"wrong sequence", map[string]any{"runtimeId": "runtime-1", "runtimeKind": "Cloud", "assignmentEpoch": 3, "checkpointSequence": 1}, false},
		{"future epoch", map[string]any{"runtimeId": "runtime-1", "runtimeKind": "Cloud", "assignmentEpoch": 5, "checkpointSequence": 2}, false},
		{"wrong runtime", map[string]any{"runtimeId": "other", "runtimeKind": "Cloud", "assignmentEpoch": 3, "checkpointSequence": 2}, false},
		{"wrong kind", map[string]any{"runtimeId": "runtime-1", "runtimeKind": "VenueEdge", "assignmentEpoch": 3, "checkpointSequence": 2}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			envelope := callbackEnvelope(t)
			envelope.SessionId = "session-1"
			encoded, err := protojson.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"assignment":  map[string]any{"sessionId": "session-1", "runtimeId": "new-runtime", "runtimeKind": "Cloud", "assignmentEpoch": 4, "presentationRevision": 4, "leaseExpiresAt": "2026-10-02T01:00:00Z"},
					"publication": map[string]any{"presentationId": "presentation-1", "publicationEpoch": 2, "publicationManifestHash": "sha256:" + strings.Repeat("a", 64), "definitionHash": "sha256:" + strings.Repeat("b", 64), "renderBundleHash": "sha256:" + strings.Repeat("c", 64)},
					"definition":  map[string]any{"schemaVersion": 1}, "renderBundle": map[string]any{"schemaVersion": 1}, "checkpoint": json.RawMessage(encoded), "checkpointSource": test.source,
				})
			}))
			defer server.Close()
			_, err = NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true}).Bootstrap(context.Background(), BootstrapRequest{SessionID: "session-1", RuntimeID: "new-runtime", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 4, PresentationRevision: 4})
			if test.valid && err != nil || !test.valid && err != ErrInvalidBootstrap {
				t.Fatalf("checkpoint source validity=%v error=%v", test.valid, err)
			}
		})
	}
}
