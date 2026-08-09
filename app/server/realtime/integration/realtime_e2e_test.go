package integration_test

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/protocol"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const participantMetadataKey = "test-participant"

func TestRealtimePageChangeOverTCP(t *testing.T) {
	t.Parallel()

	presenterIdentity := session.Identity{SessionID: "session-e2e", ParticipantID: "presenter-e2e", Role: session.RolePresenter}
	viewerIdentity := session.Identity{SessionID: "session-e2e", ParticipantID: "viewer-e2e", Role: session.RoleViewer}
	identities := map[string]session.Identity{
		presenterIdentity.ParticipantID: presenterIdentity,
		viewerIdentity.ParticipantID:    viewerIdentity,
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := transportgrpc.NewServer(listener, grpcgo.StreamInterceptor(identityInterceptor(identities)))
	if err := server.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			t.Errorf("shutdown server: %v", err)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := grpcgo.NewClient(listener.Addr().String(), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("create client connection: %v", err)
	}
	t.Cleanup(func() {
		if err := connection.Close(); err != nil {
			t.Errorf("close client connection: %v", err)
		}
	})
	client := realtimev1.NewRealtimeServiceClient(connection)
	presenter := connect(t, ctx, client, presenterIdentity)
	viewer := connect(t, ctx, client, viewerIdentity)

	command := &realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{
		MessageId: "command-e2e",
		PageIndex: 4,
	}}}
	if err := presenter.Send(command); err != nil {
		t.Fatalf("presenter sends page change: %v", err)
	}
	assertPageChanged(t, presenter, 1, "command-e2e", 4)
	assertPageChanged(t, viewer, 1, "command-e2e", 4)

	if err := viewer.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_PageChange{PageChange: &realtimev1.PageChangeCommand{
		MessageId: "viewer-command-e2e",
		PageIndex: 5,
	}}}); err != nil {
		t.Fatalf("viewer sends forbidden page change: %v", err)
	}
	if _, err := viewer.Recv(); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("viewer command status = %s, want %s (error: %v)", status.Code(err), codes.PermissionDenied, err)
	}
}

func connect(t *testing.T, ctx context.Context, client realtimev1.RealtimeServiceClient, identity session.Identity) realtimev1.RealtimeService_ConnectClient {
	t.Helper()
	streamContext := metadata.AppendToOutgoingContext(ctx, participantMetadataKey, identity.ParticipantID)
	stream, err := client.Connect(streamContext)
	if err != nil {
		t.Fatalf("connect %s: %v", identity.ParticipantID, err)
	}
	if err := stream.Send(&realtimev1.ClientEnvelope{Payload: &realtimev1.ClientEnvelope_Handshake{Handshake: &realtimev1.Handshake{
		ProtocolVersion: protocol.Version,
	}}}); err != nil {
		t.Fatalf("send %s handshake: %v", identity.ParticipantID, err)
	}
	message, err := stream.Recv()
	if err != nil {
		t.Fatalf("receive %s connected: %v", identity.ParticipantID, err)
	}
	connected := message.GetConnected()
	if connected == nil || connected.GetSessionId() != identity.SessionID || connected.GetParticipantId() != identity.ParticipantID {
		t.Fatalf("%s connected = %#v, want session=%s participant=%s", identity.ParticipantID, connected, identity.SessionID, identity.ParticipantID)
	}
	return stream
}

func assertPageChanged(t *testing.T, stream realtimev1.RealtimeService_ConnectClient, sequence uint64, messageID string, pageIndex uint32) {
	t.Helper()
	message, err := stream.Recv()
	if err != nil {
		t.Fatalf("receive page change: %v", err)
	}
	event := message.GetReliableEvent()
	if event == nil || event.GetSequence() != sequence || event.GetCommandMessageId() != messageID || event.GetPageChanged().GetPageIndex() != pageIndex {
		t.Fatalf("reliable event = %#v, want sequence=%d message=%s page=%d", event, sequence, messageID, pageIndex)
	}
}

func identityInterceptor(identities map[string]session.Identity) grpcgo.StreamServerInterceptor {
	return func(server any, stream grpcgo.ServerStream, info *grpcgo.StreamServerInfo, handler grpcgo.StreamHandler) error {
		participants := metadata.ValueFromIncomingContext(stream.Context(), participantMetadataKey)
		if len(participants) != 1 {
			return status.Error(codes.Unauthenticated, "test participant identity is unavailable")
		}
		identity, ok := identities[participants[0]]
		if !ok {
			return status.Error(codes.Unauthenticated, "test participant identity is unknown")
		}
		wrapped := &identityServerStream{ServerStream: stream, context: auth.ContextWithIdentity(stream.Context(), identity)}
		return handler(server, wrapped)
	}
}

type identityServerStream struct {
	grpcgo.ServerStream
	context context.Context
}

func (s *identityServerStream) Context() context.Context {
	return s.context
}
