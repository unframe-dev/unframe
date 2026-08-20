package grpc

import (
	"context"
	"errors"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/edge"
	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/protocol"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestRealtimeServiceFansOutPresenterPageChange(t *testing.T) {
	t.Parallel()

	presenterIdentity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter}
	viewerIdentity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	listener, stop := startRealtimeService(t, presenterIdentity, viewerIdentity)
	defer stop()
	presenter := connectClient(t, listener, presenterIdentity.ParticipantID)
	viewer := connectClient(t, listener, viewerIdentity.ParticipantID)

	sendHandshake(t, presenter)
	sendHandshake(t, viewer)
	assertConnected(t, presenter, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	assertConnected(t, viewer, realtimev1.SessionRole_SESSION_ROLE_VIEWER)

	if err := presenter.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "command-1", PageIndex: 4}}}); err != nil {
		t.Fatalf("send page change: %v", err)
	}
	for name, client := range map[string]realtimev1.RealtimeService_ConnectClient{"presenter": presenter, "viewer": viewer} {
		event := receive(t, client).GetReliableEvent()
		if event == nil || event.GetSequence() != 1 || event.GetCommandMessageId() != "command-1" || event.GetPageChanged().GetPageIndex() != 4 {
			t.Errorf("%s event = %#v, want sequence=1 message=command-1 page=4", name, event)
		}
	}
}

func TestRealtimeServiceRejectsViewerCommand(t *testing.T) {
	t.Parallel()

	viewerIdentity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	listener, stop := startRealtimeService(t, viewerIdentity)
	defer stop()
	viewer := connectClient(t, listener, viewerIdentity.ParticipantID)
	sendHandshake(t, viewer)
	assertConnected(t, viewer, realtimev1.SessionRole_SESSION_ROLE_VIEWER)
	if err := viewer.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "viewer-command", PageIndex: 1}}}); err != nil {
		t.Fatalf("send viewer command: %v", err)
	}
	_, err := viewer.Recv()
	if status.Code(err) != codes.PermissionDenied {
		t.Errorf("viewer command code = %s, want %s (error: %v)", status.Code(err), codes.PermissionDenied, err)
	}
}

func TestRealtimeServiceRejectsConnectionWhenAssignmentLeaseExpired(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer, EdgeID: "edge-1", AssignmentEpoch: 1}
	listener, stop := startRealtimeServiceWithAssignment(t, rejectingAssignment{connection: edge.ErrLeaseExpired}, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	sendHandshake(t, client)
	if _, err := client.Recv(); status.Code(err) != codes.FailedPrecondition {
		t.Errorf("expired assignment connection code = %s, want %s (error: %v)", status.Code(err), codes.FailedPrecondition, err)
	}
}

func TestRealtimeServiceRejectsCommandWhenAssignmentDoesNotMatch(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, EdgeID: "edge-1", AssignmentEpoch: 1}
	listener, stop := startRealtimeServiceWithAssignment(t, rejectingAssignment{command: edge.ErrAssignmentEpochMismatch}, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	sendHandshake(t, client)
	assertConnected(t, client, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	if err := client.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "command-1", PageIndex: 1}}}); err != nil {
		t.Fatalf("send page change: %v", err)
	}
	if _, err := client.Recv(); status.Code(err) != codes.PermissionDenied {
		t.Errorf("assignment mismatch command code = %s, want %s (error: %v)", status.Code(err), codes.PermissionDenied, err)
	}
}

func TestRealtimeServiceStopsReliableDeliveryWhenLeaseExpires(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter, EdgeID: "edge-1", AssignmentEpoch: 1}
	listener, stop := startRealtimeServiceWithAssignment(t, rejectingAssignment{delivery: edge.ErrLeaseExpired}, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	sendHandshake(t, client)
	assertConnected(t, client, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	if err := client.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "command-1", PageIndex: 1}}}); err != nil {
		t.Fatalf("send page change: %v", err)
	}
	if _, err := client.Recv(); status.Code(err) != codes.FailedPrecondition {
		t.Errorf("expired assignment delivery code = %s, want %s (error: %v)", status.Code(err), codes.FailedPrecondition, err)
	}
}

func TestRealtimeServiceRequiresHandshakeBeforeClientCloses(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	listener, stop := startRealtimeService(t, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	if err := client.CloseSend(); err != nil {
		t.Fatalf("close send: %v", err)
	}
	_, err := client.Recv()
	if status.Code(err) != codes.FailedPrecondition {
		t.Errorf("missing handshake code = %s, want %s (error: %v)", status.Code(err), codes.FailedPrecondition, err)
	}
}

func TestRealtimeServiceRejectsOversizedMessageID(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter}
	listener, stop := startRealtimeService(t, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	sendHandshake(t, client)
	assertConnected(t, client, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	if err := client.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{
		MessageId: string(make([]byte, 129)),
		PageIndex: 1,
	}}}); err != nil {
		t.Fatalf("send page change: %v", err)
	}
	_, err := client.Recv()
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("oversized message ID code = %s, want %s (error: %v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestRealtimeServiceKeepsSendingAfterClientHalfClose(t *testing.T) {
	t.Parallel()

	presenterIdentity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter}
	viewerIdentity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	listener, stop := startRealtimeService(t, presenterIdentity, viewerIdentity)
	defer stop()
	presenter := connectClient(t, listener, presenterIdentity.ParticipantID)
	viewer := connectClient(t, listener, viewerIdentity.ParticipantID)
	sendHandshake(t, presenter)
	sendHandshake(t, viewer)
	assertConnected(t, presenter, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	assertConnected(t, viewer, realtimev1.SessionRole_SESSION_ROLE_VIEWER)
	if err := viewer.CloseSend(); err != nil {
		t.Fatalf("half-close viewer: %v", err)
	}
	if err := presenter.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "command-1", PageIndex: 4}}}); err != nil {
		t.Fatalf("send page change: %v", err)
	}
	if event := receive(t, viewer).GetReliableEvent(); event == nil || event.GetCommandMessageId() != "command-1" {
		t.Errorf("viewer event = %#v, want command-1 after half-close", event)
	}
}

func TestRealtimeServiceSendsAcceptedEventBeforeLaterCommandError(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "presenter-1", Role: session.RolePresenter}
	listener, stop := startRealtimeService(t, identity)
	defer stop()
	client := connectClient(t, listener, identity.ParticipantID)
	sendHandshake(t, client)
	assertConnected(t, client, realtimev1.SessionRole_SESSION_ROLE_PRESENTER)
	if err := client.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{MessageId: "command-1", PageIndex: 4}}}); err != nil {
		t.Fatalf("send valid page change: %v", err)
	}
	if err := client.Send(&realtimev1.ClientEnvelope{}); err != nil {
		t.Fatalf("send invalid command: %v", err)
	}
	if event := receive(t, client).GetReliableEvent(); event == nil || event.GetCommandMessageId() != "command-1" {
		t.Errorf("first response = %#v, want accepted command-1 event", event)
	}
	_, err := client.Recv()
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("later invalid command code = %s, want %s (error: %v)", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestRealtimeServiceReturnsQueueOverflowWhileSendIsBlocked(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	coordinator := session.NewCoordinator()
	service := NewRealtimeService(coordinator, testIdentityResolver{identity: identity}, allowAllAssignment{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := newBlockingSendStream(ctx)
	stream.received <- &realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_Handshake{Handshake: &realtimev1.Handshake{ProtocolVersion: protocol.Version}}}
	result := make(chan error, 1)
	go func() { result <- service.Connect(stream) }()

	waitForSignal(t, stream.connected, "connected message")
	presenter, err := coordinator.Connect(session.Identity{SessionID: identity.SessionID, ParticipantID: "presenter-1", Role: session.RolePresenter})
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(presenter)
	if _, err := coordinator.ChangePage(presenter, session.PageChangeCommand{MessageID: "command-1", PageIndex: 1}); err != nil {
		t.Fatalf("send first command: %v", err)
	}
	waitForSignal(t, stream.blocked, "blocked reliable event send")
	receiveSessionEvent(t, presenter.Events())
	for index := 2; index <= 65; index++ {
		if _, err := coordinator.ChangePage(presenter, session.PageChangeCommand{MessageID: "command-" + strconv.Itoa(index), PageIndex: uint32(index)}); err != nil {
			t.Fatalf("fill queue at %d: %v", index, err)
		}
		receiveSessionEvent(t, presenter.Events())
	}
	if _, err := coordinator.ChangePage(presenter, session.PageChangeCommand{MessageID: "overflow", PageIndex: 66}); err != nil {
		t.Fatalf("overflow command: %v", err)
	}
	receiveSessionEvent(t, presenter.Events())

	select {
	case err := <-result:
		if status.Code(err) != codes.ResourceExhausted {
			t.Fatalf("Connect error code = %s, want %s (error: %v)", status.Code(err), codes.ResourceExhausted, err)
		}
	case <-time.After(time.Second):
		t.Fatal("Connect waited for blocked Send after queue overflow")
	}
	if replacement, err := coordinator.Connect(identity); err != nil {
		t.Errorf("reconnect same identity after overflow: %v", err)
	} else {
		coordinator.Disconnect(replacement)
	}

	cancel()
	select {
	case <-stream.sendDone:
	case <-time.After(time.Second):
		t.Fatal("blocked sender goroutine did not exit after context cancellation")
	}
}

func TestRealtimeServiceStopsBlockedSendWhenAssignmentLeaseExpires(t *testing.T) {
	t.Parallel()

	identity := session.Identity{SessionID: "session-1", ParticipantID: "viewer-1", Role: session.RoleViewer}
	coordinator := session.NewCoordinator()
	service := NewRealtimeService(coordinator, testIdentityResolver{identity: identity}, deadlineAssignment{deadline: time.Now().Add(200 * time.Millisecond)})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := newBlockingSendStream(ctx)
	stream.received <- &realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_Handshake{Handshake: &realtimev1.Handshake{ProtocolVersion: protocol.Version}}}
	result := make(chan error, 1)
	go func() { result <- service.Connect(stream) }()

	waitForSignal(t, stream.connected, "connected message")
	presenter, err := coordinator.Connect(session.Identity{SessionID: identity.SessionID, ParticipantID: "presenter-1", Role: session.RolePresenter})
	if err != nil {
		t.Fatalf("connect presenter: %v", err)
	}
	defer coordinator.Disconnect(presenter)
	if _, err := coordinator.ChangePage(presenter, session.PageChangeCommand{MessageID: "command-1", PageIndex: 1}); err != nil {
		t.Fatalf("send command: %v", err)
	}
	waitForSignal(t, stream.blocked, "blocked reliable event send")

	select {
	case err := <-result:
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("Connect error code = %s, want %s (error: %v)", status.Code(err), codes.FailedPrecondition, err)
		}
	case <-time.After(time.Second):
		t.Fatal("Connect waited for blocked Send after assignment lease expiry")
	}
	cancel()
	waitForSignal(t, stream.sendDone, "blocked sender shutdown")
}

func TestDeliveryTrackerIgnoresAcknowledgementAfterCancellation(t *testing.T) {
	t.Parallel()

	tracker := newDeliveryTracker()
	delivery := tracker.expect("command-1")
	tracker.cancelAll()
	tracker.acknowledge("command-1")
	if tracker.wait("command-1", delivery) {
		t.Fatal("cancelled delivery was acknowledged")
	}
}

func waitForSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func receiveSessionEvent(t *testing.T, events <-chan session.ReliableEvent) session.ReliableEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("session event channel closed")
		}
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for session event")
		return session.ReliableEvent{}
	}
}

type testIdentityResolver struct{ identity session.Identity }

func (r testIdentityResolver) Resolve(context.Context) (session.Identity, error) {
	return r.identity, nil
}

type allowAllAssignment struct{}

func (allowAllAssignment) AllowNewConnection(edge.AssignmentClaim) error { return nil }

func (allowAllAssignment) AllowCommand(edge.AssignmentClaim) error { return nil }

func (allowAllAssignment) ReliableDeliveryDeadline(edge.AssignmentClaim) (time.Time, error) {
	return time.Now().Add(time.Hour), nil
}

type deadlineAssignment struct{ deadline time.Time }

func (deadlineAssignment) AllowNewConnection(edge.AssignmentClaim) error { return nil }

func (deadlineAssignment) AllowCommand(edge.AssignmentClaim) error { return nil }

func (a deadlineAssignment) ReliableDeliveryDeadline(edge.AssignmentClaim) (time.Time, error) {
	return a.deadline, nil
}

type rejectingAssignment struct {
	connection error
	command    error
	delivery   error
}

func (a rejectingAssignment) AllowNewConnection(edge.AssignmentClaim) error { return a.connection }

func (a rejectingAssignment) AllowCommand(edge.AssignmentClaim) error { return a.command }

func (a rejectingAssignment) ReliableDeliveryDeadline(edge.AssignmentClaim) (time.Time, error) {
	return time.Now().Add(time.Hour), a.delivery
}

type blockingSendStream struct {
	grpcgo.ServerStream
	ctx       context.Context
	received  chan *realtimev1.ClientEnvelope
	connected chan struct{}
	blocked   chan struct{}
	sendDone  chan struct{}
}

func newBlockingSendStream(ctx context.Context) *blockingSendStream {
	return &blockingSendStream{
		ctx:       ctx,
		received:  make(chan *realtimev1.ClientEnvelope, 1),
		connected: make(chan struct{}),
		blocked:   make(chan struct{}),
		sendDone:  make(chan struct{}),
	}
}

func (s *blockingSendStream) Context() context.Context { return s.ctx }

func (s *blockingSendStream) Recv() (*realtimev1.ClientEnvelope, error) {
	select {
	case message := <-s.received:
		return message, nil
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}

func (s *blockingSendStream) Send(message *realtimev1.ServerEnvelope) error {
	if message.GetConnected() != nil {
		close(s.connected)
		return nil
	}
	if message.GetReliableEvent() == nil {
		return errors.New("unexpected server message")
	}
	close(s.blocked)
	<-s.ctx.Done()
	close(s.sendDone)
	return s.ctx.Err()
}

func startRealtimeService(t *testing.T, identities ...session.Identity) (*bufconn.Listener, func()) {
	return startRealtimeServiceWithAssignment(t, allowAllAssignment{}, identities...)
}

func startRealtimeServiceWithAssignment(t *testing.T, assignments AssignmentAuthorizer, identities ...session.Identity) (*bufconn.Listener, func()) {
	t.Helper()
	listener := bufconn.Listen(1024 * 1024)
	byParticipant := make(map[string]session.Identity, len(identities))
	for _, identity := range identities {
		byParticipant[identity.ParticipantID] = identity
	}
	server := grpcgo.NewServer(grpcgo.StreamInterceptor(func(srv any, stream grpcgo.ServerStream, info *grpcgo.StreamServerInfo, handler grpcgo.StreamHandler) error {
		participant := metadata.ValueFromIncomingContext(stream.Context(), "test-participant")
		identity, ok := byParticipant[first(participant)]
		if !ok {
			return status.Error(codes.Unauthenticated, "test identity is unavailable")
		}
		return handler(srv, contextServerStream{ServerStream: stream, context: auth.ContextWithIdentity(stream.Context(), identity)})
	}))
	realtimev1.RegisterRealtimeServiceServer(server, NewRealtimeService(session.NewCoordinator(), auth.ContextIdentityResolver{}, assignments))
	go func() { _ = server.Serve(listener) }()
	return listener, func() {
		server.Stop()
		_ = listener.Close()
	}
}

func connectClient(t *testing.T, listener *bufconn.Listener, participantID string) realtimev1.RealtimeService_ConnectClient {
	t.Helper()
	connection, err := grpcgo.NewClient("passthrough:///bufnet", grpcgo.WithContextDialer(func(context.Context, string) (net.Conn, error) {
		return listener.Dial()
	}), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial realtime service: %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	client, err := realtimev1.NewRealtimeServiceClient(connection).Connect(metadata.AppendToOutgoingContext(context.Background(), "test-participant", participantID))
	if err != nil {
		t.Fatalf("open realtime stream: %v", err)
	}
	return client
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func sendHandshake(t *testing.T, client realtimev1.RealtimeService_ConnectClient) {
	t.Helper()
	if err := client.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_Handshake{Handshake: &realtimev1.Handshake{ProtocolVersion: protocol.Version}}}); err != nil {
		t.Fatalf("send handshake: %v", err)
	}
}

func assertConnected(t *testing.T, client realtimev1.RealtimeService_ConnectClient, role realtimev1.SessionRole) {
	t.Helper()
	connected := receive(t, client).GetConnected()
	if connected == nil || connected.GetProtocolVersion() != protocol.Version || connected.GetRole() != role {
		t.Fatalf("connected = %#v, want version=%s role=%s", connected, protocol.Version, role)
	}
}

func receive(t *testing.T, client realtimev1.RealtimeService_ConnectClient) *realtimev1.ServerEnvelope {
	t.Helper()
	result := make(chan *realtimev1.ServerEnvelope, 1)
	failure := make(chan error, 1)
	go func() {
		message, err := client.Recv()
		if err != nil {
			failure <- err
			return
		}
		result <- message
	}()
	select {
	case message := <-result:
		return message
	case err := <-failure:
		t.Fatalf("receive: %v", err)
	case <-time.After(time.Second):
		t.Fatal("receive timed out")
	}
	return nil
}

type contextServerStream struct {
	grpcgo.ServerStream
	context context.Context
}

func (s contextServerStream) Context() context.Context { return s.context }
