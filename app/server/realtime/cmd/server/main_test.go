package main

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/edge"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
)

func TestRunReturnsServeFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	if err := run(context.Background(), listener, testDependencies(t)); err == nil {
		t.Fatal("run() error = nil, want Serve failure")
	}
}

func TestLoadConfigParsesAssignmentWithoutInventingLeaseDuration(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"REALTIME_ISSUER":                "https://control-plane.example.test",
		"REALTIME_JWKS_URL":              "https://control-plane.example.test/.well-known/jwks.json",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_EDGE_ID":               "edge-1",
		"REALTIME_ASSIGNMENT_EPOCH":      "2",
		"REALTIME_PRESENTATION_REVISION": "4",
		"REALTIME_ASSIGNMENT_ISSUED_AT":  "2026-08-20T12:00:00Z",
		"REALTIME_LEASE_EXPIRES_AT":      "2026-08-20T12:01:00Z",
	}
	config, err := loadConfig(func(name string) string { return values[name] })
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if config.assignment.LeaseExpiresAt.Format(time.RFC3339) != values["REALTIME_LEASE_EXPIRES_AT"] {
		t.Errorf("lease expiry = %s, want input %s", config.assignment.LeaseExpiresAt.Format(time.RFC3339), values["REALTIME_LEASE_EXPIRES_AT"])
	}
}

func TestLoadConfigRejectsInvalidAssignmentInput(t *testing.T) {
	t.Parallel()

	if _, err := loadConfig(func(string) string { return "" }); !errors.Is(err, ErrInvalidConfiguration) {
		t.Errorf("load config error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func TestLoadConfigRejectsMalformedJWKSURL(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"REALTIME_ISSUER":                "issuer",
		"REALTIME_JWKS_URL":              "://not-a-url",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_EDGE_ID":               "edge-1",
		"REALTIME_ASSIGNMENT_EPOCH":      "1",
		"REALTIME_PRESENTATION_REVISION": "1",
		"REALTIME_ASSIGNMENT_ISSUED_AT":  "2026-08-20T12:00:00Z",
		"REALTIME_LEASE_EXPIRES_AT":      "2026-08-20T12:01:00Z",
	}
	if _, err := loadConfig(func(name string) string { return values[name] }); !errors.Is(err, ErrInvalidConfiguration) {
		t.Errorf("load config error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func TestLoadConfigRejectsInsecureIssuerAndJWKSURLs(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"REALTIME_ISSUER":                "http://control-plane.example.test",
		"REALTIME_JWKS_URL":              "http://control-plane.example.test/.well-known/jwks.json",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_EDGE_ID":               "edge-1",
		"REALTIME_ASSIGNMENT_EPOCH":      "1",
		"REALTIME_PRESENTATION_REVISION": "1",
		"REALTIME_ASSIGNMENT_ISSUED_AT":  "2026-08-20T12:00:00Z",
		"REALTIME_LEASE_EXPIRES_AT":      "2026-08-20T12:01:00Z",
	}
	if _, err := loadConfig(func(name string) string { return values[name] }); !errors.Is(err, ErrInvalidConfiguration) {
		t.Errorf("load config error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func testDependencies(t *testing.T) transportgrpc.Dependencies {
	t.Helper()
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "test", JWKSURL: "https://example.test/jwks"})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	guard, err := edge.NewAssignmentGuard(edge.EdgeSessionAssignment{
		SessionID:            "session-1",
		EdgeID:               "edge-1",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             time.Unix(0, 0),
		LeaseExpiresAt:       time.Date(2100, time.January, 1, 0, 0, 0, 0, time.UTC),
	}, nil)
	if err != nil {
		t.Fatalf("new guard: %v", err)
	}
	return transportgrpc.Dependencies{Verifier: verifier, Guard: guard}
}
