package auth

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestBearerStreamServerInterceptorBindsVerifiedIdentity(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	server := newJWKSServer(t, "key-1", publicKey)
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	token := issueToken(t, privateKey, "key-1", validClaims(now))
	stream := testServerStream{ctx: metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", "Bearer "+token))}

	err := NewBearerStreamServerInterceptor(verifier)(nil, stream, nil, func(_ any, stream grpcgo.ServerStream) error {
		identity, err := (ContextIdentityResolver{}).Resolve(stream.Context())
		if err != nil {
			t.Fatalf("resolve identity: %v", err)
		}
		if identity != (session.Identity{SessionID: "session-1", ParticipantID: "participant-1", Role: session.RolePresenter, EdgeID: "edge-1", AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 7, ProtocolVersion: 1}) {
			t.Errorf("identity = %#v", identity)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("intercept stream: %v", err)
	}
}

func TestBearerStreamServerInterceptorRejectsInvalidAuthorizationWithoutLeakingIt(t *testing.T) {
	t.Parallel()

	verifier := mustVerifier(t)
	authorization := "Bearer sensitive-token"
	stream := testServerStream{ctx: metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", authorization))}
	err := NewBearerStreamServerInterceptor(verifier)(nil, stream, nil, func(any, grpcgo.ServerStream) error {
		t.Fatal("handler called for invalid authorization")
		return nil
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("status code = %s, want %s", status.Code(err), codes.Unauthenticated)
	}
	if status.Convert(err).Message() == authorization {
		t.Errorf("status leaked authorization: %v", err)
	}
}

func mustVerifier(t *testing.T) *BearerTokenVerifier {
	t.Helper()
	publicKey := make(ed25519.PublicKey, ed25519.PublicKeySize)
	server := newJWKSServer(t, "key-1", publicKey)
	t.Cleanup(server.Close)
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{Issuer: "test", JWKSURL: server.URL})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return verifier
}

type testServerStream struct {
	grpcgo.ServerStream
	ctx context.Context
}

func (s testServerStream) Context() context.Context { return s.ctx }
