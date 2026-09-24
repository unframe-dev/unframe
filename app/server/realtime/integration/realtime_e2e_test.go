package integration_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
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

func TestRealtimePageChangeOverTCP(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	presenterIdentity := e2eIdentity("presenter-e2e", session.RolePresenter)
	viewerIdentity := e2eIdentity("viewer-e2e", session.RoleViewer)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "OKP", "crv": "Ed25519", "kid": "e2e-key", "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"},
			"x": base64.RawURLEncoding.EncodeToString(publicKey),
		}}})
	}))
	defer jwks.Close()
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{
		Issuer: "https://control-plane.example.test", Audience: "realtime-runtime-test", JWKSURL: jwks.URL, Clock: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create verifier: %v", err)
	}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{
		SessionID: "session-e2e", RuntimeID: "runtime-e2e", RuntimeKind: assignment.RuntimeKindCloud,
		Endpoint: "127.0.0.1:9090", AssignmentEpoch: 1, PresentationRevision: 1,
		IssuedAt: now.Add(-time.Minute), LeaseExpiresAt: now.Add(time.Hour),
	}, func() time.Time { return now })
	if err != nil {
		t.Fatalf("create assignment guard: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server, err := transportgrpc.NewServer(listener, transportgrpc.Dependencies{Verifier: verifier, Guard: guard, Coordinator: session.NewCoordinator()})
	if err != nil {
		t.Fatalf("create server: %v", err)
	}
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
	presenter := connect(t, ctx, client, presenterIdentity, issueToken(t, privateKey, presenterIdentity, now))
	viewer := connect(t, ctx, client, viewerIdentity, issueToken(t, privateKey, viewerIdentity, now))

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

func connect(t *testing.T, ctx context.Context, client realtimev1.RealtimeServiceClient, identity session.Identity, token string) realtimev1.RealtimeService_ConnectClient {
	t.Helper()
	streamContext := metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
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

func e2eIdentity(participantID string, role session.Role) session.Identity {
	return session.Identity{
		SessionID: "session-e2e", ParticipantID: participantID, Role: role,
		RuntimeID: "runtime-e2e", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationID: "presentation-e2e",
		PresentationRevision: 1, ProtocolVersion: 1,
	}
}

func issueToken(t *testing.T, privateKey ed25519.PrivateKey, identity session.Identity, now time.Time) string {
	t.Helper()
	role := "viewer"
	if identity.Role == session.RolePresenter {
		role = "presenter"
	}
	header, err := json.Marshal(map[string]any{"alg": "EdDSA", "kid": "e2e-key"})
	if err != nil {
		t.Fatalf("marshal JWT header: %v", err)
	}
	claims, err := json.Marshal(map[string]any{
		"iss": "https://control-plane.example.test", "aud": "realtime-runtime-test",
		"sub": identity.ParticipantID, "session_id": identity.SessionID, "role": role,
		"runtime_id": identity.RuntimeID, "runtime_kind": identity.RuntimeKind, "assignment_epoch": identity.AssignmentEpoch,
		"presentation_id": identity.PresentationID, "presentation_revision": identity.PresentationRevision,
		"scope": "realtime:connect assets:read", "protocol_version": identity.ProtocolVersion,
		"nbf": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("marshal JWT claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(signingInput)))
}
