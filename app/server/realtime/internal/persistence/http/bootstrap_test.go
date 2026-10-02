package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

func TestRuntimeBootstrapAndProjectionUseServiceIdentityAndTrustedFence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer service-token" {
			t.Errorf("missing service bearer")
		}
		switch request.URL.Path {
		case "/internal/runtime/bootstrap":
			if request.URL.Query().Get("sessionId") != "session-1" || request.URL.Query().Get("runtimeId") != "runtime-1" || request.URL.Query().Get("assignmentEpoch") != "3" {
				t.Errorf("bootstrap query = %q", request.URL.RawQuery)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"assignment":  map[string]any{"sessionId": "session-1", "runtimeId": "runtime-1", "runtimeKind": "Cloud", "assignmentEpoch": 3, "presentationRevision": 4, "leaseExpiresAt": "2026-10-02T01:00:00Z"},
				"publication": map[string]any{"presentationId": "presentation-1", "publicationEpoch": 2, "publicationManifestHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "definitionHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "renderBundleHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
				"definition":  map[string]any{"schemaVersion": 2}, "renderBundle": map[string]any{"schemaVersion": 2, "surfaces": map[string]any{}, "models": map[string]any{}}, "checkpoint": nil,
			})
		case "/internal/runtime/projection":
			if request.URL.Query().Get("participantId") != "participant-1" || request.URL.Query().Has("capabilityProfileId") {
				t.Errorf("projection query = %q", request.URL.RawQuery)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"role": "viewer", "profile": map[string]any{"projectionProfileId": "profile-1", "runtimeCatalog": map[string]any{"catalogContractVersion": 2}, "requiredRuntimeCapabilities": []int{1}}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	bootstrap, err := client.Bootstrap(context.Background(), BootstrapRequest{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4})
	if err != nil || bootstrap.Assignment.AssignmentEpoch != 3 || bootstrap.Publication.PresentationID != "presentation-1" || string(bootstrap.Definition) == "" || string(bootstrap.RenderBundle) == "" {
		t.Fatalf("bootstrap = %#v, error = %v", bootstrap, err)
	}
	projection, err := client.Projection(context.Background(), ProjectionRequest{SessionID: "session-1", ParticipantID: "participant-1"})
	if err != nil || projection.Role != "viewer" || projection.Profile.GetProjectionProfileId() != "profile-1" || projection.Profile.GetRuntimeCatalog().GetCatalogContractVersion() != 2 {
		t.Fatalf("projection = %#v, error = %v", projection, err)
	}
}

func TestRuntimeBootstrapRejectsAssignmentMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(response).Encode(map[string]any{
			"assignment":  map[string]any{"sessionId": "other-session", "runtimeId": "runtime-1", "runtimeKind": "Cloud", "assignmentEpoch": 3, "presentationRevision": 4, "leaseExpiresAt": "2026-10-02T01:00:00Z"},
			"publication": map[string]any{"presentationId": "presentation-1", "publicationEpoch": 2, "publicationManifestHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "definitionHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "renderBundleHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
			"definition":  map[string]any{"schemaVersion": 2}, "checkpoint": nil,
		})
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	if _, err := client.Bootstrap(context.Background(), BootstrapRequest{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}); err != ErrInvalidBootstrap {
		t.Fatalf("mismatched bootstrap error = %v", err)
	}
}
