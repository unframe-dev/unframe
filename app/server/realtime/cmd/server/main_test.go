package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
)

type bootstrapReaderFunc func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error)

func (f bootstrapReaderFunc) Bootstrap(ctx context.Context, request persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
	return f(ctx, request)
}

type leaseReaderFunc func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error)

func (f leaseReaderFunc) Lease(ctx context.Context, request persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error) {
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
	reader := leaseReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error) {
		return persistencehttp.RuntimeLease{Assignment: persistencehttp.BootstrapAssignment{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision, LeaseExpiresAt: issued.Add(2 * time.Minute)}, Publication: pin}, nil
	})
	if err := refreshV2Lease(context.Background(), reader, guard, request, pin); err != nil || !guard.Assignment().LeaseExpiresAt.Equal(issued.Add(2*time.Minute)) {
		t.Fatalf("lease=%#v err=%v", guard.Assignment(), err)
	}
	reader = leaseReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error) {
		changed := pin
		changed.PublicationEpoch++
		return persistencehttp.RuntimeLease{Assignment: persistencehttp.BootstrapAssignment{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision, LeaseExpiresAt: issued.Add(3 * time.Minute)}, Publication: changed}, nil
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

	if err := run(context.Background(), listener, testDependencies(t), func(context.Context) error { return nil }, testShutdownBudget(t)); err == nil {
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
	if err := run(context.Background(), listener, testDependencies(t), func(context.Context) error { return readinessErr }, testShutdownBudget(t)); !errors.Is(err, readinessErr) {
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
	return transportgrpc.Dependencies{Verifier: verifier, Guard: guard, V2: &transportgrpc.V2Service{}}
}

func TestBootstrapRenewsExpiredEnvironmentLeaseBeforeReadiness(t *testing.T) {
	issued := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	initial := assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "runtime.internal:9090", AssignmentEpoch: 2, PresentationRevision: 4, IssuedAt: issued, LeaseExpiresAt: issued.Add(time.Minute)}
	guard, err := assignment.NewAssignmentGuard(initial, func() time.Time { return issued.Add(90 * time.Second) })
	if err != nil {
		t.Fatal(err)
	}
	reader := bootstrapReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
		return persistencehttp.RuntimeBootstrap{Assignment: persistencehttp.BootstrapAssignment{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision, LeaseExpiresAt: issued.Add(2 * time.Minute)}}, nil
	})
	request := persistencehttp.BootstrapRequest{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
	if _, err := loadV2Bootstrap(context.Background(), reader, guard, request); err != nil {
		t.Fatal(err)
	}
	claim := assignment.AssignmentClaim{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
	if err := guard.AllowNewConnection(claim); err != nil {
		t.Fatalf("authoritative bootstrap lease must be ready before server start: %v", err)
	}
}

func TestLoadConfigBrowserOrigins(t *testing.T) {
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
	for _, test := range []struct {
		origins string
		valid   bool
		count   int
	}{{"", true, 0}, {"https://audience.example, https://second.example:444", true, 2}, {"http://audience.example", false, 0}, {"https://audience.example/path", false, 0}, {"https://user@audience.example", false, 0}, {"https://audience.example?token=secret", false, 0}, {"null", false, 0}} {
		t.Run(test.origins, func(t *testing.T) {
			values["REALTIME_BROWSER_ORIGINS"] = test.origins
			config, err := loadConfig(func(name string) string { return values[name] })
			if (err == nil) != test.valid {
				t.Fatalf("origins accepted=%v want=%v", err == nil, test.valid)
			}
			if err == nil && len(config.browserOrigins) != test.count {
				t.Fatalf("origins=%v", config.browserOrigins)
			}
		})
	}
}

func TestLeaseRefreshRevokesRejectedAssignmentBeforeHeldLeaseExpires(t *testing.T) {
	for _, status := range []int{401, 403, 404, 409, 410, 429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			now := time.Now()
			initial := assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "localhost:9090", AssignmentEpoch: 2, PresentationRevision: 4, IssuedAt: now.Add(-time.Minute), LeaseExpiresAt: now.Add(time.Hour)}
			guard, err := assignment.NewAssignmentGuard(initial, nil)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			client := persistencehttp.NewClient(persistencehttp.Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
			request := persistencehttp.BootstrapRequest{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
			if err := refreshV2Lease(context.Background(), client, guard, request, persistencehttp.BootstrapPublication{}); err == nil {
				t.Fatal("rejected lease accepted")
			}
			claim := assignment.AssignmentClaim{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
			err = guard.AllowCommand(claim)
			if status == 429 || status >= 500 {
				if err != nil {
					t.Fatalf("transient failure revoked lease: %v", err)
				}
				return
			}
			if !errors.Is(err, assignment.ErrInvalidAssignment) {
				t.Fatalf("rejected assignment remained active: %v", err)
			}
			renewal := initial
			renewal.LeaseExpiresAt = renewal.LeaseExpiresAt.Add(time.Hour)
			if err := guard.Renew(renewal); !errors.Is(err, assignment.ErrInvalidAssignment) {
				t.Fatalf("revoked assignment resumed: %v", err)
			}
		})
	}
}

func TestRevokedLeasePausesRuntimeClockAndRejectsResume(t *testing.T) {
	now := time.Now()
	initial := assignment.RuntimeAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, Endpoint: "localhost:9090", AssignmentEpoch: 2, PresentationRevision: 4, IssuedAt: now.Add(-time.Minute), LeaseExpiresAt: now.Add(time.Hour)}
	guard, err := assignment.NewAssignmentGuard(initial, nil)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := runtimecore.NewV2Session(json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	request := persistencehttp.BootstrapRequest{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
	claim := assignment.AssignmentClaim{SessionID: initial.SessionID, RuntimeID: initial.RuntimeID, RuntimeKind: initial.RuntimeKind, AssignmentEpoch: initial.AssignmentEpoch, PresentationRevision: initial.PresentationRevision}
	reader := leaseReaderFunc(func(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error) {
		return persistencehttp.RuntimeLease{}, &persistencehttp.ResponseError{Operation: "lease", StatusCode: 409}
	})
	runtime.ConfigureResumeValidation(func(ctx context.Context) error {
		return refreshV2Lease(ctx, reader, guard, request, persistencehttp.BootstrapPublication{})
	})
	if err := refreshV2Lease(context.Background(), reader, guard, request, persistencehttp.BootstrapPublication{}); err == nil {
		t.Fatal("ended Session lease accepted")
	}
	before := runtime.Snapshot().Clock.RuntimeTimeMs
	for _, tick := range []time.Time{now.Add(time.Second), now.Add(time.Hour)} {
		if err := advanceV2Runtime(context.Background(), runtime, guard, claim, tick); !errors.Is(err, assignment.ErrInvalidAssignment) {
			t.Fatalf("invalidated runtime advance: %v", err)
		}
	}
	snapshot := runtime.Snapshot()
	if snapshot.Clock.RuntimeTimeMs != before || snapshot.Clock.GetPaused().GetReason() != realtimev2.PauseReason_PAUSE_REASON_ASSIGNMENT_LEASE_EXPIRED {
		t.Fatalf("runtime continued after revocation: %v", snapshot.Clock)
	}
	command := &realtimev2.RuntimeControlCommand{ClientEventId: "1:12345678-1234-4123-8123-123456789abc", CommandEpoch: 1, PresentationOriginVersion: snapshot.PresentationOrigin.Version, Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME}
	if _, events, err := runtime.RuntimeControl(context.Background(), session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}, command); !errors.Is(err, assignment.ErrInvalidAssignment) || len(events) != 0 {
		t.Fatalf("revoked runtime resume: events=%v err=%v", events, err)
	}
}

func TestStandaloneCloudRuntimeRequiresManagedFreshAssignment(t *testing.T) {
	if err := validateStandaloneRuntimeKind(assignment.RuntimeKindCloud); err == nil {
		t.Fatal("standalone Cloud could reuse an execution epoch")
	}
	if err := validateStandaloneRuntimeKind(assignment.RuntimeKindVenueEdge); err != nil {
		t.Fatal(err)
	}
}

func testShutdownBudget(t *testing.T) func() context.Context {
	get, cancel := newShutdownBudget()
	t.Cleanup(cancel)
	return get
}
func TestListenerAndCheckpointShareShutdownDeadline(t *testing.T) {
	get, cancel := newShutdownBudget()
	defer cancel()
	first, second := get(), get()
	a, _ := first.Deadline()
	b, _ := second.Deadline()
	if first != second || !a.Equal(b) {
		t.Fatal("shutdown stages did not share one budget")
	}
	cancel()
	if first.Err() != context.Canceled || second.Err() != context.Canceled {
		t.Fatal("shared shutdown did not cancel both stages")
	}
}
