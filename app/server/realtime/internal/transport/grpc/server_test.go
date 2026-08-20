package grpc

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/edge"
)

func TestServerShutdownStopsServing(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := mustNewServer(t, listener)
	if err := server.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if err := server.Wait(); err != nil {
		t.Fatalf("wait: %v", err)
	}
}

func TestServerWaitReturnsServeFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	server := mustNewServer(t, listener)
	if err := server.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := server.Wait(); err == nil {
		t.Fatal("Wait() error = nil, want Serve failure")
	}
}

func TestServerStartReturnsErrorWhenCalledTwice(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := mustNewServer(t, listener)
	if err := server.Start(); err != nil {
		t.Fatalf("first start: %v", err)
	}
	if err := server.Start(); !errors.Is(err, ErrServerStarted) {
		t.Fatalf("second start error = %v, want %v", err, ErrServerStarted)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
}

func TestServerShutdownBeforeStartSucceeds(t *testing.T) {
	t.Parallel()

	server := mustNewServer(t, nil)
	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown before start: %v", err)
	}
}

func TestNewServerRegistersRealtimeBidiService(t *testing.T) {
	t.Parallel()

	server := mustNewServer(t, nil)
	service, ok := server.GRPCServer().GetServiceInfo()["unframe.realtime.v1.RealtimeService"]
	if !ok {
		t.Fatal("RealtimeService is not registered")
	}
	if len(service.Methods) != 1 || service.Methods[0].Name != "Connect" || !service.Methods[0].IsClientStream || !service.Methods[0].IsServerStream {
		t.Errorf("registered methods = %#v, want one bidi Connect method", service.Methods)
	}
}

func TestNewServerRejectsMissingProductionDependencies(t *testing.T) {
	t.Parallel()

	if _, err := NewServer(nil, Dependencies{}); !errors.Is(err, ErrServerConfiguration) {
		t.Errorf("NewServer() error = %v, want %v", err, ErrServerConfiguration)
	}
}

func mustNewServer(t *testing.T, listener net.Listener) *Server {
	t.Helper()
	guard, err := edge.NewAssignmentGuard(edge.EdgeSessionAssignment{
		SessionID:            "session-1",
		EdgeID:               "edge-1",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             time.Unix(0, 0),
		LeaseExpiresAt:       time.Date(2100, time.January, 1, 0, 0, 0, 0, time.UTC),
	}, nil)
	if err != nil {
		t.Fatalf("new assignment guard: %v", err)
	}
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "test", JWKSURL: "https://example.test/jwks"})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	server, err := NewServer(listener, Dependencies{Verifier: verifier, Guard: guard})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	return server
}
