package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProjectionRetainsSharedPlacementReferenceForBothRoles(t *testing.T) {
	for _, role := range []string{"presenter", "viewer"} {
		t.Run(role, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path != "/internal/runtime/projection" {
					t.Errorf("unexpected path: %s", request.URL.Path)
				}
				_ = json.NewEncoder(response).Encode(map[string]any{
					"role": role,
					"profile": map[string]any{
						"projectionProfileId": "profile-1",
						"runtimeCatalog": map[string]any{
							"catalogContractVersion":  3,
							"placementReferencePoint": map[string]float64{"x": -1, "y": 2.15, "z": -2.5},
						},
						"requiredRuntimeCapabilities": []int{1},
					},
				})
			}))
			defer server.Close()
			client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
			projection, err := client.Projection(context.Background(), ProjectionRequest{SessionID: "session-1", ParticipantID: "participant-1"})
			if err != nil {
				t.Fatal(err)
			}
			point := projection.Profile.GetRuntimeCatalog().GetPlacementReferencePoint()
			if projection.Role != role || point == nil || point.X != -1 || point.Y != 2.15 || point.Z != -2.5 {
				t.Fatalf("shared placement was lost: role=%s point=%v", projection.Role, point)
			}
		})
	}
}
