package grpc

import (
	"context"
	"strings"
	"testing"
	"time"

	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func TestControlResumeSynchronizesLogicalInputsForEachRole(t *testing.T) {
	for _, initiallyPaused := range []bool{true, false} {
		name := "after-running-pause"
		if initiallyPaused {
			name = "paused-snapshot"
		}
		t.Run(name, func(t *testing.T) {
			service, profile := newV2LeaseTestService(t, allowAllAssignment{})
			catalog, err := runtimecore.BuildV2CanonicalCatalog(service.bootstrap.Definition)
			if err != nil {
				t.Fatal(err)
			}
			metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 1, SessionId: service.bootstrap.Assignment.SessionID, RuntimeId: service.bootstrap.Assignment.RuntimeID, RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: service.bootstrap.Assignment.AssignmentEpoch, Publication: profile.Key.Publication, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
			if err := service.runtime.ConfigureDurability(&switchableV2Checkpoint{}, metadata, catalog); err != nil {
				t.Fatal(err)
			}
			if initiallyPaused {
				seed, err := service.identities.Resolve(context.Background())
				if err != nil {
					t.Fatal(err)
				}
				seed.ParticipantID = "prior-viewer"
				seed.Role = session.RoleViewer
				if err := service.runtime.JoinParticipant(context.Background(), seed); err != nil {
					t.Fatal(err)
				}
				if err := service.runtime.LeaveParticipant(context.Background(), seed); err != nil {
					t.Fatal(err)
				}
			}
			presenter := newV3LifecycleConnection(t, service, profile, initiallyPaused, nil)
			viewerProfile := proto.Clone(profile).(*deliveryv2.ProjectionProfileDescriptor)
			viewerProfile.Key.Role = presentationv2.SessionRole_SESSION_ROLE_VIEWER
			identity := presenter.identity
			identity.ParticipantID = "viewer-1"
			identity.Role = session.RoleViewer
			viewerService, err := NewV2Service(presenter.service.runtime, presenter.service.bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "viewer", Profile: viewerProfile}}, testIdentityResolver{identity}, allowAllAssignment{})
			if err != nil {
				t.Fatal(err)
			}
			viewer := newV3LifecycleConnection(t, viewerService, viewerProfile, false, nil)
			if len(viewer.cut.Snapshot.RuntimeView.EnabledLogicalInputs) != 0 {
				t.Fatal("Viewer Snapshot exposes Presenter inputs")
			}
			if initiallyPaused {
				if len(presenter.cut.Snapshot.RuntimeView.EnabledLogicalInputs) != 0 {
					t.Fatal("paused Snapshot exposes inputs")
				}
			} else {
				presenter.runtimeControl(t, "pause-inputs", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
				assertLogicalInputView(t, presenter, false, nil)
				assertLogicalInputView(t, viewer, false, nil)
			}
			presenter.runtimeControl(t, "resume-inputs", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
			assertLogicalInputView(t, presenter, true, []string{"next"})
			assertLogicalInputView(t, viewer, true, nil)
		})
	}
}

func assertLogicalInputView(t *testing.T, c *v2LifecycleConnection, running bool, want []string) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case item := <-c.controlOutput:
			event := item.GetReliableEvent()
			view := event.GetRuntimeViewReplaced().GetRuntimeView()
			if view == nil || (view.Clock.GetRunning() != nil) != running {
				continue
			}
			if err := protocolv2.ValidateMessage(event); err != nil {
				t.Fatal(err)
			}
			if view.BaseReliableSequence != event.Sequence {
				t.Fatalf("view cut %d != event %d", view.BaseReliableSequence, event.Sequence)
			}
			if len(view.EnabledLogicalInputs) != len(want) {
				t.Fatalf("enabled inputs = %v, want %v", view.EnabledLogicalInputs, want)
			}
			for i := range want {
				if view.EnabledLogicalInputs[i] != want[i] {
					t.Fatalf("enabled inputs = %v, want %v", view.EnabledLogicalInputs, want)
				}
			}
			return
		case <-deadline:
			t.Fatalf("logical input view timed out (running=%v)", running)
		}
	}
}
