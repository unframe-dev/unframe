package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestAssetResolverUsesServiceIdentityAndRejectsChangedPublication(t *testing.T) {
	identity := session.Identity{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindVenueEdge, AssignmentEpoch: 1, PresentationRevision: 1, PresentationID: "presentation-1", ParticipantID: "viewer"}
	pin := BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64), DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "changed publication"}[changed], func(t *testing.T) {
			publication := pin
			if changed {
				publication.PublicationEpoch++
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer service-token" || r.URL.Path != "/internal/runtime/assets" || r.URL.Query().Get("participantId") != "viewer" || r.URL.Query().Get("assetId") != "image" {
					t.Errorf("unexpected resolver request")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"assignment": BootstrapAssignment{SessionID: identity.SessionID, RuntimeID: identity.RuntimeID, RuntimeKind: identity.RuntimeKind, AssignmentEpoch: 1, PresentationRevision: 1, LeaseExpiresAt: time.Now().Add(time.Minute)}, "publication": publication, "url": "https://assets.example.test/image", "checksum": "sha256:" + strings.Repeat("d", 64), "size": 42, "mediaType": "image/png"})
			}))
			defer server.Close()
			client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
			asset, err := client.Asset(context.Background(), identity, "image", pin)
			if changed {
				if err == nil {
					t.Fatal("changed publication accepted")
				}
			} else if err != nil || asset.Size != 42 {
				t.Fatalf("asset=%v err=%v", asset, err)
			}
		})
	}
}
