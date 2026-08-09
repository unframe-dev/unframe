package grpc

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
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

func startRealtimeService(t *testing.T, identities ...session.Identity) (*bufconn.Listener, func()) {
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
	realtimev1.RegisterRealtimeServiceServer(server, NewRealtimeService(session.NewCoordinator(), auth.ContextIdentityResolver{}))
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
