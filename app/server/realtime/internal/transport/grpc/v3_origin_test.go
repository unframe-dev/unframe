package grpc

import (
	"context"
	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"net"
	"testing"
	"time"
)

func TestPresentationOriginRequiresFreshStateReadyAndChangesFence(t *testing.T) {
	c := newV2LifecycleConnection(t, false, nil)
	select {
	case <-c.stateOutput:
	case <-time.After(time.Second):
		t.Fatal("initial State timed out")
	}
	epoch := c.service.runtime.InputSynchronization().CommandEpoch
	c.controlInput <- &realtime.ControlClientItem{Item: &realtime.ControlClientItem_PresentationOrigin{PresentationOrigin: &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID(epoch, "origin"), CommandEpoch: epoch, Pose: &presentation.Pose{Position: &presentation.Vector3{Y: 0.7}, Rotation: &presentation.Quaternion{W: 1}}}}}
	var origin *realtime.ProjectedReliableEvent
	deadline := time.After(time.Second)
	for origin == nil {
		select {
		case item := <-c.controlOutput:
			if item.GetReliableEvent().GetPresentationOriginChanged() != nil {
				origin = item.GetReliableEvent()
			}
		case <-deadline:
			t.Fatal("origin update timed out")
		}
	}
	if origin.Fence.PresentationOriginVersion != 0 || origin.GetPresentationOriginChanged().Origin.Version != 1 {
		t.Fatalf("origin fence=%v", origin)
	}
	// Frames already in flight retain the old cut; no new-version State is emitted before acknowledgement.
	timer := time.NewTimer(150 * time.Millisecond)
	defer timer.Stop()
drain:
	for {
		select {
		case item := <-c.stateOutput:
			if item.GetStateFrame().Fence.PresentationOriginVersion != 0 {
				t.Fatal("State advanced before StateReady")
			}
		case <-timer.C:
			break drain
		}
	}
	c.controlInput <- &realtime.ControlClientItem{Item: &realtime.ControlClientItem_StateReady{StateReady: &realtime.StateReady{AppliedReliableSequence: c.cut.ReliableSequence, PresentationOriginVersion: 0}}}
	c.controlInput <- &realtime.ControlClientItem{Item: &realtime.ControlClientItem_StateReady{StateReady: &realtime.StateReady{AppliedReliableSequence: origin.Sequence, PresentationOriginVersion: 1}}}
	select {
	case item := <-c.stateOutput:
		if item.GetStateFrame().Fence.PresentationOriginVersion != 1 || item.GetStateFrame().BaseReliableSequence < origin.Sequence {
			t.Fatalf("new State=%v", item)
		}
	case <-time.After(time.Second):
		t.Fatal("new State timed out")
	}
}

func TestPresentationOriginSnapshotCatchUpAndLateJoinConverge(t *testing.T) {
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	identity, err := service.identities.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var updateErr error
	c := newV3LifecycleConnection(t, service, profile, false, func(item *realtime.ControlServerItem) {
		if item.GetConnectionSnapshot() != nil {
			epoch := service.runtime.InputSynchronization().CommandEpoch
			_, _, updateErr = service.runtime.PresentationOrigin(context.Background(), identity, &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID(epoch, "snapshot-origin"), CommandEpoch: epoch, Pose: &presentation.Pose{Position: &presentation.Vector3{Y: 0.7}, Rotation: &presentation.Quaternion{W: 1}}})
		}
	})
	if updateErr != nil {
		t.Fatal(updateErr)
	}
	if c.cut.Fence.PresentationOriginVersion != 0 {
		t.Fatal("snapshot cut unexpectedly changed")
	}
	var changed *realtime.ProjectedReliableEvent
	for changed == nil {
		select {
		case item := <-c.controlOutput:
			if item.GetReliableEvent().GetPresentationOriginChanged() != nil {
				changed = item.GetReliableEvent()
			}
		case <-time.After(time.Second):
			t.Fatal("snapshot missed concurrent origin")
		}
	}
	c.controlInput <- &realtime.ControlClientItem{Item: &realtime.ControlClientItem_StateReady{StateReady: &realtime.StateReady{AppliedReliableSequence: changed.Sequence, PresentationOriginVersion: 1}}}
	viewer := identity
	viewer.ParticipantID = "late-viewer"
	viewer.Role = session.RoleViewer
	viewerProfile := proto.Clone(profile).(*delivery.ProjectionProfileDescriptor)
	viewerProfile.Key.Role = presentation.SessionRole_SESSION_ROLE_VIEWER
	viewerService, err := NewV2Service(service.runtime, service.bootstrap, v2TestProjection{value: persistencehttp.RuntimeProjection{Role: "viewer", Profile: viewerProfile}}, testIdentityResolver{viewer}, allowAllAssignment{})
	if err != nil {
		t.Fatal(err)
	}
	late := newV3LifecycleConnection(t, viewerService, viewerProfile, false, nil)
	if !proto.Equal(late.cut.Snapshot.RuntimeView.PresentationOrigin, changed.GetPresentationOriginChanged().Origin) {
		t.Fatalf("late snapshot=%v update=%v", late.cut, changed)
	}
	select {
	case item := <-c.stateOutput:
		if item.GetStateFrame().Fence.PresentationOriginVersion != 1 {
			t.Fatal("existing participant retained old origin")
		}
	case <-time.After(time.Second):
		t.Fatal("existing participant did not converge")
	}
}

func TestPresentationOriginResumeAcrossChangeRequiresLatestSnapshot(t *testing.T) {
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	listener := bufconn.Listen(1024 * 1024)
	server := grpcgo.NewServer()
	realtime.RegisterRealtimeServiceServer(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, err := grpcgo.NewClient("passthrough:///origin", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := realtime.NewRealtimeServiceClient(connection)
	open := func(resume *realtime.ResumeCursor) grpcgo.BidiStreamingClient[realtime.ControlClientItem, realtime.ControlServerItem] {
		t.Helper()
		control, err := client.ConnectControl(ctx)
		if err != nil {
			t.Fatal(err)
		}
		err = control.Send(&realtime.ControlClientItem{Item: &realtime.ControlClientItem_Handshake{Handshake: &realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: profile.RequiredRuntimeCapabilities, Resume: resume}}})
		if err != nil {
			t.Fatal(err)
		}
		return control
	}
	control := open(nil)
	connected, err := control.Recv()
	if err != nil {
		t.Fatal(err)
	}
	item, err := control.Recv()
	if err != nil {
		t.Fatal(err)
	}
	cut := item.GetConnectionSnapshot()
	if cut == nil {
		t.Fatal("missing snapshot")
	}
	if err := control.CloseSend(); err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := control.Recv(); err != nil {
			break
		}
	}
	identity, err := service.identities.Resolve(ctx)
	if err != nil {
		t.Fatal(err)
	}
	epoch := service.runtime.InputSynchronization().CommandEpoch
	_, _, err = service.runtime.PresentationOrigin(ctx, identity, &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID(epoch, "offline-origin"), CommandEpoch: epoch, Pose: &presentation.Pose{Position: &presentation.Vector3{Y: 0.7}, Rotation: &presentation.Quaternion{W: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	resume := open(&realtime.ResumeCursor{PriorConnectionId: connected.GetConnected().ConnectionId, AppliedReliableSequence: cut.ReliableSequence, Fence: cut.Fence})
	item, err = resume.Recv()
	if err != nil || item.GetResyncRequired() == nil {
		t.Fatalf("resume=%v error=%v", item, err)
	}
	for {
		if _, err := resume.Recv(); err != nil {
			break
		}
	}
	fresh := open(nil)
	if _, err = fresh.Recv(); err != nil {
		t.Fatal(err)
	}
	item, err = fresh.Recv()
	if err != nil || item.GetConnectionSnapshot().GetFence().GetPresentationOriginVersion() != 1 || item.GetConnectionSnapshot().GetSnapshot().GetRuntimeView().GetPresentationOrigin().GetPose().GetPosition().GetY() != 0.7 {
		t.Fatalf("fresh snapshot=%v error=%v", item, err)
	}
}
