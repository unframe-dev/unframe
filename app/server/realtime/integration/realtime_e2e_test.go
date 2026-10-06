package integration_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type projectionProvider struct {
	profile *deliveryv2.ProjectionProfileDescriptor
}

func (p projectionProvider) Projection(context.Context, persistencehttp.ProjectionRequest) (persistencehttp.RuntimeProjection, error) {
	return persistencehttp.RuntimeProjection{Role: "presenter", Profile: p.profile}, nil
}

func TestV2AuthenticatedControlAndLegacyRejectionOverTCP(t *testing.T) {
	now := time.Now().UTC()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{"kty": "OKP", "crv": "Ed25519", "kid": "e2e-key", "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"}, "x": base64.RawURLEncoding.EncodeToString(publicKey)}}})
	}))
	defer jwks.Close()
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "https://control-plane.example.test", Audience: "realtime-runtime-test", JWKSURL: jwks.URL})
	if err != nil {
		t.Fatal(err)
	}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: "session-e2e", RuntimeID: "runtime-e2e", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "127.0.0.1:9090", AssignmentEpoch: 1, PresentationRevision: 1, IssuedAt: now.Add(-time.Minute), LeaseExpiresAt: now.Add(time.Hour)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-e2e","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}}},"variables":{},"timelines":{}}`)
	runtime, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	publication := persistencehttp.BootstrapPublication{PresentationID: "presentation-e2e", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	bootstrap := persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: "session-e2e", RuntimeID: "runtime-e2e", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationRevision: 1}, Publication: publication, Definition: definition}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile-1", Key: &deliveryv2.ProjectionProfileKey{Publication: &presentationv2.PublicationFence{PresentationId: publication.PresentationID, PublicationEpoch: publication.PublicationEpoch, PublicationManifestHash: publication.PublicationManifestHash}, ProjectionContractVersion: 1, Role: presentationv2.SessionRole_SESSION_ROLE_PRESENTER, CapabilityProfileId: "capability-1"}, RequiredRuntimeCapabilities: []presentationv2.RuntimeCapability{presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_RUNTIME_TRANSPORT}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}}
	service, err := transportgrpc.NewV2Service(runtime, bootstrap, projectionProvider{profile}, auth.ContextIdentityResolver{}, guard)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, err := transportgrpc.NewServer(listener, transportgrpc.Dependencies{Verifier: verifier, Guard: guard, V2: service})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	}()
	conn, err := grpcgo.NewClient(listener.Addr().String(), grpcgo.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := realtimev2.NewRealtimeServiceClient(conn)
	identity := e2eIdentity("presenter-e2e", session.RolePresenter)
	authorized := metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+issueToken(t, privateKey, identity, now))
	controlCtx, closeControl := context.WithCancel(authorized)
	defer closeControl()
	control, err := client.ConnectControl(controlCtx)
	if err != nil {
		t.Fatal(err)
	}
	if err := control.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}); err != nil {
		t.Fatal(err)
	}
	connected, err := control.Recv()
	if err != nil || connected.GetConnected() == nil {
		t.Fatalf("connected = %v, error = %v", connected, err)
	}
	snapshot, err := control.Recv()
	if err != nil || snapshot.GetConnectionSnapshot() == nil {
		t.Fatalf("snapshot = %v, error = %v", snapshot, err)
	}
	nonce, err := control.Recv()
	if err != nil || len(nonce.GetStateConnectionNonce().GetNonce()) != 32 {
		t.Fatalf("nonce = %v, error = %v", nonce, err)
	}

	t.Run("legacy JWT rejected by v2", func(t *testing.T) {
		legacy := identity
		legacy.ProtocolVersion = 1
		stream, err := client.ConnectControl(metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+issueToken(t, privateKey, legacy, now)))
		if err == nil {
			_, err = stream.Recv()
		}
		if status.Code(err) != codes.Unauthenticated {
			t.Fatalf("legacy JWT status = %v", err)
		}
	})
	t.Run("legacy service unavailable", func(t *testing.T) {
		stream, err := conn.NewStream(authorized, &grpcgo.StreamDesc{ServerStreams: true, ClientStreams: true}, "/unframe.realtime.v1.RealtimeService/Connect")
		if err == nil {
			err = stream.RecvMsg(&emptypb.Empty{})
		}
		if status.Code(err) != codes.Unimplemented {
			t.Fatalf("legacy service status = %v", err)
		}
	})
	t.Run("legacy handshake rejected", func(t *testing.T) {
		stream, err := client.ConnectControl(authorized)
		if err != nil {
			t.Fatal(err)
		}
		_ = stream.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v1", ProgressionContractVersion: 1, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}})
		_, err = stream.Recv()
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("legacy handshake status = %v", err)
		}
	})
	closeControl()
}

func e2eIdentity(participantID string, role session.Role) session.Identity {
	return session.Identity{
		SessionID: "session-e2e", ParticipantID: participantID, Role: role,
		RuntimeID: "runtime-e2e", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 1, PresentationID: "presentation-e2e",
		PresentationRevision: 1, ProtocolVersion: 2,
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
