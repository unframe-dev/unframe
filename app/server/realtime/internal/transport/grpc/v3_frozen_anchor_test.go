package grpc

import (
	"context"
	"encoding/json"
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

func TestPauseReplacementAndResumeStateShareFrozenDisplay(t *testing.T) {
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	definition := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"badge":{"id":"badge","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"anchor","target":"body","owner":{"kind":"presenter"},"followPosition":true,"followRotation":false},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	service.runtime = core
	service.bootstrap.Definition = definition
	profile.VisibleNodeIds = []string{"badge"}
	profile.RuntimeCatalog, err = runtimecore.BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 3, SessionId: service.bootstrap.Assignment.SessionID, RuntimeId: service.bootstrap.Assignment.RuntimeID, RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: service.bootstrap.Assignment.AssignmentEpoch, Publication: &presentationv2.PublicationFence{PresentationId: service.bootstrap.Publication.PresentationID, PublicationEpoch: service.bootstrap.Publication.PublicationEpoch, PublicationManifestHash: service.bootstrap.Publication.PublicationManifestHash}, DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)}
	if err := core.ConfigureDurability(&switchableV2Checkpoint{}, metadata, profile.RuntimeCatalog); err != nil {
		t.Fatal(err)
	}
	identity, err := service.identities.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	pose := &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}
	tracking := &realtimev2.TrackingFrame{FrameSequence: 1, PresentationFromQuestLocal: pose, Samples: []*realtimev2.TrackedPoseSample{{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: &presentationv2.Pose{Position: &presentationv2.Vector3{X: 1}, Rotation: &presentationv2.Quaternion{W: 1}}, PositionAvailable: true, RotationAvailable: true}}}
	if _, _, err := core.AcceptTracking(context.Background(), identity, tracking, time.Now(), 1); err != nil {
		t.Fatal(err)
	}
	connection := newV3LifecycleConnection(t, service, profile, false, nil)
	select {
	case <-connection.stateOutput:
	case <-time.After(time.Second):
		t.Fatal("initial State timed out")
	}
	connection.runtimeControl(t, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	var replacement *realtimev2.ProjectedReliableEvent
	for replacement == nil {
		select {
		case item := <-connection.controlOutput:
			if event := item.GetReliableEvent(); event.GetRuntimeViewReplaced() != nil {
				replacement = event
			}
		case <-time.After(time.Second):
			t.Fatal("pause replacement timed out")
		}
	}
	if err := protocolv2.ValidateMessage(replacement); err != nil {
		t.Fatal("projected pause event:", err)
	}
	view := replacement.GetRuntimeViewReplaced().RuntimeView
	if view.BaseReliableSequence != replacement.Sequence || view.Clock.GetPaused() == nil || len(view.FrozenAnchors) != 1 || view.FrozenAnchors[0].Position.X != 1 || view.FrozenAnchors[0].Rotation != nil {
		t.Fatalf("atomic pause view: %v", view)
	}
	viewerProfile := proto.Clone(profile).(*deliveryv2.ProjectionProfileDescriptor)
	viewerProfile.Key.Role = presentationv2.SessionRole_SESSION_ROLE_VIEWER
	viewerIdentity := identity
	viewerIdentity.ParticipantID = "viewer-1"
	viewerIdentity.Role = session.RoleViewer
	viewerService, err := NewV2Service(core, service.bootstrap, v2TestProjection{persistencehttp.RuntimeProjection{Role: "viewer", Profile: viewerProfile}}, testIdentityResolver{viewerIdentity}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	viewer := newV3LifecycleConnection(t, viewerService, viewerProfile, false, nil)
	if frozen := viewer.cut.Snapshot.RuntimeView.FrozenAnchors; len(frozen) != 1 || frozen[0].Position.X != 1 {
		t.Fatalf("late Viewer did not receive frozen Snapshot: %v", frozen)
	}
	select {
	case item := <-connection.stateOutput:
		t.Fatalf("paused State updated display: %v", item)
	case <-time.After(600 * time.Millisecond):
	}
	connection.runtimeControl(t, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	select {
	case item := <-connection.stateOutput:
		frame := item.GetStateFrame()
		if len(frame.GetAnchorBindings()) != 1 || frame.AnchorBindings[0].GetFrozen().GetPosition().GetX() != 1 || frame.BaseReliableSequence <= replacement.Sequence {
			t.Fatalf("resume waiting for Pose: %v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("resume frozen keyframe timed out")
	}
	tracking.FrameSequence = 2
	tracking.Samples[0].QuestLocalPose.Position.X = 2
	observed := uint64(time.Since(service.trackingStarted)/time.Millisecond) + 1
	if _, _, err := core.AcceptTracking(context.Background(), identity, tracking, time.Now(), observed); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(time.Second)
	for {
		select {
		case item := <-connection.stateOutput:
			frame := item.GetStateFrame()
			if len(frame.GetAnchorBindings()) == 1 && frame.AnchorBindings[0].GetSample() != nil {
				if frame.AnchorBindings[0].GetSample().GetPosition().GetX() != 2 || len(core.Snapshot().FrozenAnchors) != 0 {
					t.Fatalf("fresh Pose did not replace frozen display: %v", frame)
				}
				return
			}
		case <-deadline:
			t.Fatal("fresh Pose keyframe timed out")
		}
	}
}
