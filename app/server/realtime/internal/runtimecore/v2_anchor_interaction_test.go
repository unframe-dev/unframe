package runtimecore

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestV2AnchorSurfaceInteractionRequiresAvailableTracking(t *testing.T) {
	for _, nested := range []bool{false, true} {
		for _, scenario := range []string{"fresh", "missing", "expired", "missing position", "missing rotation", "changed origin"} {
			t.Run(scenario+map[bool]string{false: " direct", true: " ancestor"}[nested], func(t *testing.T) {
				var def map[string]any
				if err := json.Unmarshal([]byte(reviewDefinition), &def); err != nil {
					t.Fatal(err)
				}
				parent := map[string]any{"kind": "anchor", "target": "body", "owner": map[string]any{"kind": "presenter"}, "followPosition": true, "followRotation": false}
				if scenario == "missing rotation" {
					parent["followRotation"] = true
				}
				transform := map[string]any{"position": []int{0, 0, 0}, "rotation": []int{0, 0, 0, 1}, "scale": []int{1, 1, 1}}
				host := map[string]any{"id": "host", "kind": "surface", "surfaceId": "screen", "owner": map[string]any{"kind": "presentation"}, "parent": parent, "transform": transform, "active": true, "visible": true, "opacity": 1}
				nodes := map[string]any{"host": host}
				if nested {
					nodes["badge"] = map[string]any{"id": "badge", "kind": "container", "owner": map[string]any{"kind": "presentation"}, "parent": parent, "transform": transform, "active": true, "visible": true, "opacity": 1}
					host["parent"] = map[string]any{"kind": "node", "nodeId": "badge"}
				}
				def["scene"] = map[string]any{"nodes": nodes, "surfaces": map[string]any{"screen": map[string]any{"id": "screen", "hostNodeId": "host", "initialStateId": "idle", "physicalSizeMeters": []int{1, 1}, "logicalSize": []int{100, 100}, "fit": "contain", "interactions": map[string]any{"tap": map[string]any{"id": "tap", "event": "trusted"}}, "states": map[string]any{"idle": map[string]any{"enabledInteractionIds": []string{"tap"}}}}}}
				def["flow"].(map[string]any)["groups"].(map[string]any)["intro"].(map[string]any)["steps"].(map[string]any)["start"].(map[string]any)["cues"] = []any{map[string]any{"id": "semantic", "trigger": map[string]any{"kind": "semanticEvent", "event": "trusted", "actor": map[string]any{"kind": "presenter"}}, "firePolicy": map[string]any{"kind": "oncePerStepEntry"}, "next": map[string]any{"kind": "stay"}}}
				raw, err := json.Marshal(def)
				if err != nil {
					t.Fatal(err)
				}
				core, err := NewV2Session(raw)
				if err != nil {
					t.Fatal(err)
				}
				id := session.Identity{ParticipantID: "p", Role: session.RolePresenter}
				if scenario != "missing" {
					sample := trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(3, 0, 0))
					if scenario == "missing position" {
						sample.PositionAvailable = false
					}
					if scenario == "missing rotation" {
						sample.RotationAvailable = false
					}
					received := time.Now()
					if scenario == "expired" {
						received = received.Add(-time.Second)
					}
					if _, _, err := core.AcceptTracking(context.Background(), id, trackingTestFrame(1, trackingTestPose(0, 0, 0), sample), received, 1); err != nil {
						t.Fatal(err)
					}
				}
				if scenario == "changed origin" {
					core.snapshot.PresentationOrigin.Version++
				}
				out, _, err := core.SurfaceInteraction(id, &realtimev2.SurfaceInteractionCommand{ClientEventId: "tap", SurfaceId: "screen", InteractionId: "tap", PresentationOriginVersion: core.Snapshot().PresentationOrigin.Version})
				if err != nil {
					t.Fatal(err)
				}
				if scenario == "fresh" {
					if out.GetAccepted().GetCueCommitted().GetCueId() != "semantic" {
						t.Fatalf("fresh anchor interaction: %v", out)
					}
				} else if out.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INTERACTION_UNAVAILABLE {
					t.Fatalf("unavailable anchor interaction: %v", out)
				}
			})
		}
	}
}
