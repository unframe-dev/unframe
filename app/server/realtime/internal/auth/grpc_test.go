package auth

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestBearerStreamServerInterceptorBindsVerifiedIdentity(t *testing.T) {
	t.Parallel()

	now := time.Now()
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
		if identity != (session.Identity{SessionID: "session-1", ParticipantID: "participant-1", Role: session.RolePresenter, RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationID: "presentation-1", PresentationRevision: 7, ProtocolVersion: 3}) {
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

func TestBearerStreamServerInterceptorAllowsPublicHealthWatch(t *testing.T) {
	t.Parallel()

	called := false
	err := NewBearerStreamServerInterceptor(nil)(nil, testServerStream{ctx: context.Background()}, &grpcgo.StreamServerInfo{
		FullMethod: healthv1.Health_Watch_FullMethodName,
	}, func(any, grpcgo.ServerStream) error {
		called = true
		return nil
	})
	if err != nil {
		t.Fatalf("intercept health watch: %v", err)
	}
	if !called {
		t.Fatal("health watch handler was not called")
	}
}

func mustVerifier(t *testing.T) *BearerTokenVerifier {
	t.Helper()
	publicKey := make(ed25519.PublicKey, ed25519.PublicKeySize)
	server := newJWKSServer(t, "key-1", publicKey)
	t.Cleanup(server.Close)
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{Issuer: "test", Audience: "test", JWKSURL: server.URL})
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

func TestBearerStreamServerInterceptorUsesEarlierCredentialOrClientDeadline(t *testing.T) {
	now := time.Now()
	private, public := testKey(t)
	server := newJWKSServer(t, "key-1", public)
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	claims := validClaims(now)
	expires := time.Unix(claims["exp"].(int64), 0)
	token := issueToken(t, private, "key-1", claims)
	for _, test := range []struct {
		name     string
		deadline time.Time
		want     time.Time
	}{
		{name: "credential", deadline: now.Add(time.Hour), want: expires},
		{name: "client", deadline: now.Add(10 * time.Second), want: now.Add(10 * time.Second)},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithDeadline(context.Background(), test.deadline)
			defer cancel()
			stream := testServerStream{ctx: metadata.NewIncomingContext(ctx, metadata.Pairs("authorization", "Bearer "+token))}
			err := NewBearerStreamServerInterceptor(verifier)(nil, stream, nil, func(_ any, stream grpcgo.ServerStream) error {
				deadline, ok := stream.Context().Deadline()
				if !ok || !deadline.Equal(test.want) {
					t.Errorf("deadline = %v, want %v", deadline, test.want)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

type testTransferStream struct {
	testServerStream
	transfer func(any) error
}

func (s testTransferStream) SendMsg(message any) error { return s.transfer(message) }
func (s testTransferStream) RecvMsg(message any) error { return s.transfer(message) }

func TestBearerStreamServerInterceptorRejectsCanceledTransfers(t *testing.T) {
	now := time.Now()
	private, public := testKey(t)
	server := newJWKSServer(t, "key-1", public)
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	token := issueToken(t, private, "key-1", validClaims(now))
	for _, operation := range []string{"send", "receive"} {
		for _, when := range []string{"before", "during"} {
			t.Run(operation+"/"+when, func(t *testing.T) {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				stream := testTransferStream{testServerStream: testServerStream{ctx: metadata.NewIncomingContext(ctx, metadata.Pairs("authorization", "Bearer "+token))}, transfer: func(any) error {
					if when == "before" {
						t.Error("canceled transfer reached transport")
					}
					cancel()
					return nil
				}}
				err := NewBearerStreamServerInterceptor(verifier)(nil, stream, nil, func(_ any, stream grpcgo.ServerStream) error {
					if when == "before" {
						cancel()
					}
					if operation == "send" {
						return stream.SendMsg(nil)
					}
					return stream.RecvMsg(nil)
				})
				if status.Code(err) != codes.Canceled {
					t.Fatalf("canceled transfer error = %v", err)
				}
			})
		}
	}
}
