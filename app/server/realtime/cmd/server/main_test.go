package main

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
)

type bootstrapReaderFunc func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error)

func (f bootstrapReaderFunc) Bootstrap(ctx context.Context, request persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
	return f(ctx, request)
}

func TestRefreshV2LeaseKeepsPublicationPinAndExtendsOnlyTrustedAssignment(t *testing.T) {
	issued := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	initial := assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "runtime.internal:9090", AssignmentEpoch: 2, PresentationRevision: 4, IssuedAt: issued, LeaseExpiresAt: issued.Add(time.Minute)}
	guard, err := assignment.NewAssignmentGuard(initial, func() time.Time { return issued.Add(30 * time.Second) })
	if err != nil {
		t.Fatal(err)
	}
	request := persistencehttp.BootstrapRequest{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
	pin := persistencehttp.BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	reader := bootstrapReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
		return persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision, LeaseExpiresAt: issued.Add(2 * time.Minute)}, Publication: pin}, nil
	})
	if err := refreshV2Lease(context.Background(), reader, guard, request, pin); err != nil || !guard.Assignment().LeaseExpiresAt.Equal(issued.Add(2*time.Minute)) {
		t.Fatalf("lease=%#v err=%v", guard.Assignment(), err)
	}
	reader = bootstrapReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
		changed := pin
		changed.PublicationEpoch++
		return persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision, LeaseExpiresAt: issued.Add(3 * time.Minute)}, Publication: changed}, nil
	})
	if err := refreshV2Lease(context.Background(), reader, guard, request, pin); err == nil || !guard.Assignment().LeaseExpiresAt.Equal(issued.Add(2*time.Minute)) {
		t.Fatalf("changed publication accepted lease=%#v err=%v", guard.Assignment(), err)
	}
}

func TestRunReturnsServeFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	if err := run(context.Background(), listener, testDependencies(t), func(context.Context) error { return nil }); err == nil {
		t.Fatal("run() error = nil, want Serve failure")
	}
}

func TestRunRejectsFailedApplicationReadiness(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	readinessErr := errors.New("jwks unavailable")
	if err := run(context.Background(), listener, testDependencies(t), func(context.Context) error { return readinessErr }); !errors.Is(err, readinessErr) {
		t.Fatalf("run() error = %v, want %v", err, readinessErr)
	}
}

func TestCheckApplicationReadinessBoundsDependencyChecks(t *testing.T) {
	t.Parallel()

	err := checkApplicationReadiness(context.Background(), 10*time.Millisecond, func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("readiness error = %v, want %v", err, context.DeadlineExceeded)
	}
}

func TestMonitorApplicationReadinessPublishesDependencyChanges(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	checks := make(chan time.Time)
	results := make(chan bool, 2)
	var ready atomic.Bool
	ready.Store(true)
	go monitorApplicationReadiness(ctx, checks, time.Second, func(context.Context) error {
		if ready.Load() {
			return nil
		}
		return errors.New("lease expired")
	}, func(value bool) { results <- value })

	checks <- time.Now()
	if result := <-results; !result {
		t.Fatal("readiness result = false, want true")
	}
	ready.Store(false)
	checks <- time.Now()
	if result := <-results; result {
		t.Fatal("readiness result = true, want false")
	}
	cancel()
}

func TestLoadConfigParsesAssignmentWithoutInventingLeaseDuration(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"REALTIME_ISSUER":                "https://control-plane.example.test",
		"REALTIME_AUDIENCE":              "realtime-runtime-test",
		"REALTIME_JWKS_URL":              "https://control-plane.example.test/.well-known/jwks.json",
		"REALTIME_CONTROL_PLANE_URL":     "https://control-plane.example.test",
		"REALTIME_SERVICE_IDENTITY":      "test-service-secret-at-least-32-bytes",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_RUNTIME_ID":            "runtime-1",
		"REALTIME_RUNTIME_KIND":          "Cloud",
		"REALTIME_RUNTIME_ENDPOINT":      "runtime.internal:9090",
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
		"REALTIME_AUDIENCE":              "realtime-runtime-test",
		"REALTIME_JWKS_URL":              "://not-a-url",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_RUNTIME_ID":            "runtime-1",
		"REALTIME_RUNTIME_KIND":          "VenueEdge",
		"REALTIME_RUNTIME_ENDPOINT":      "runtime.internal:9090",
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
		"REALTIME_AUDIENCE":              "realtime-runtime-test",
		"REALTIME_JWKS_URL":              "http://control-plane.example.test/.well-known/jwks.json",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_RUNTIME_ID":            "runtime-1",
		"REALTIME_RUNTIME_KIND":          "VenueEdge",
		"REALTIME_RUNTIME_ENDPOINT":      "runtime.internal:9090",
		"REALTIME_ASSIGNMENT_EPOCH":      "1",
		"REALTIME_PRESENTATION_REVISION": "1",
		"REALTIME_ASSIGNMENT_ISSUED_AT":  "2026-08-20T12:00:00Z",
		"REALTIME_LEASE_EXPIRES_AT":      "2026-08-20T12:01:00Z",
	}
	if _, err := loadConfig(func(name string) string { return values[name] }); !errors.Is(err, ErrInvalidConfiguration) {
		t.Errorf("load config error = %v, want %v", err, ErrInvalidConfiguration)
	}
}

func TestLoadConfigRejectsUnknownRuntimeKind(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"REALTIME_ISSUER":                "https://control-plane.example.test",
		"REALTIME_AUDIENCE":              "realtime-runtime-test",
		"REALTIME_JWKS_URL":              "https://control-plane.example.test/.well-known/jwks.json",
		"REALTIME_SESSION_ID":            "session-1",
		"REALTIME_RUNTIME_ID":            "runtime-1",
		"REALTIME_RUNTIME_KIND":          "Other",
		"REALTIME_RUNTIME_ENDPOINT":      "runtime.internal:9090",
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
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: "test", Audience: "test-runtime", JWKSURL: "https://example.test/jwks"})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{
		SessionID:            "session-1",
		RuntimeID:            "runtime-1",
		RuntimeKind:          assignment.RuntimeKindCloud,
		Endpoint:             "runtime.internal:9090",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             time.Unix(0, 0),
		LeaseExpiresAt:       time.Date(2100, time.January, 1, 0, 0, 0, 0, time.UTC),
	}, nil)
	if err != nil {
		t.Fatalf("new guard: %v", err)
	}
	return transportgrpc.Dependencies{Verifier: verifier, Guard: guard, Coordinator: session.NewCoordinator()}
}
