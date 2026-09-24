package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestBearerTokenVerifierVerifiesRuntimeAssignmentClaimsAndRequiredScope(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	server := newJWKSServer(t, "key-1", publicKey)
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	token := issueToken(t, privateKey, "key-1", validClaims(now))

	identity, err := verifier.VerifyBearer(context.Background(), "Bearer "+token, "realtime:connect")
	if err != nil {
		t.Fatalf("verify bearer token: %v", err)
	}
	want := session.Identity{
		SessionID:            "session-1",
		ParticipantID:        "participant-1",
		Role:                 session.RolePresenter,
		RuntimeID:            "runtime-1",
		RuntimeKind:          assignment.RuntimeKindCloud,
		AssignmentEpoch:      3,
		PresentationID:       "presentation-1",
		PresentationRevision: 7,
		ProtocolVersion:      1,
	}
	if identity != want {
		t.Errorf("identity = %#v, want %#v", identity, want)
	}

	if _, err := verifier.VerifyBearer(context.Background(), "Bearer "+token, "assets:read"); err != ErrInsufficientScope {
		t.Errorf("missing scope error = %v, want %v", err, ErrInsufficientScope)
	}
}

func TestBearerTokenVerifierUsesBoundedDefaults(t *testing.T) {
	t.Parallel()

	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:   "https://control-plane.example.test",
		Audience: "runtime-audience",
		JWKSURL:  "https://control-plane.example.test/.well-known/jwks.json",
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	if verifier.cacheTTL != 5*time.Minute {
		t.Errorf("cache TTL = %s, want 5m", verifier.cacheTTL)
	}
	if verifier.requestTimeout != 5*time.Second {
		t.Errorf("request timeout = %s, want 5s", verifier.requestTimeout)
	}
}

func TestNewBearerTokenVerifierRequiresAudience(t *testing.T) {
	t.Parallel()

	_, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:  "https://control-plane.example.test",
		JWKSURL: "https://control-plane.example.test/.well-known/jwks.json",
	})
	if err != ErrInvalidVerifierConfig {
		t.Errorf("new verifier error = %v, want %v", err, ErrInvalidVerifierConfig)
	}
}

func TestBearerTokenVerifierRefreshesJWKSForUnknownKeyID(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		response.Header().Set("Content-Type", "application/json")
		keyID := "old-key"
		if requestNumber > 1 {
			keyID = "new-key"
		}
		_ = json.NewEncoder(response).Encode(jwks(keyID, publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	if _, err := verifier.Verify(context.Background(), issueToken(t, privateKey, "old-key", validClaims(now)), "realtime:connect"); err != nil {
		t.Fatalf("verify token with initially cached key: %v", err)
	}
	now = now.Add(30 * time.Second)
	if _, err := verifier.Verify(context.Background(), issueToken(t, privateKey, "new-key", validClaims(now)), "realtime:connect"); err != nil {
		t.Fatalf("verify token after unknown-kid refresh: %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("JWKS requests = %d, want 2", got)
	}
}

func TestBearerTokenVerifierBoundsRefreshesForUnknownKeyIDs(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(jwks("known-key", publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	if _, err := verifier.Verify(context.Background(), issueToken(t, privateKey, "known-key", validClaims(now)), "realtime:connect"); err != nil {
		t.Fatalf("verify token with initially cached key: %v", err)
	}

	for _, keyID := range []string{"unknown-1", "unknown-2", "unknown-3"} {
		if _, err := verifier.Verify(context.Background(), issueToken(t, privateKey, keyID, validClaims(now)), "realtime:connect"); err != ErrInvalidTokenKeyID {
			t.Errorf("verify token with %s error = %v, want %v", keyID, err, ErrInvalidTokenKeyID)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("JWKS requests = %d, want 1 while unknown-key refresh is throttled", got)
	}
}

func TestBearerTokenVerifierRefreshesCachedKeyAfterTTLAndRejectsRemovedKey(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if requests.Add(1) == 1 {
			_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
			return
		}
		_ = json.NewEncoder(response).Encode(jwks("key-2", publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifierWithTTL(t, server.URL, &now, 10*time.Second)
	token := issueToken(t, privateKey, "key-1", validClaims(now))
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != nil {
		t.Fatalf("verify with initial cached key: %v", err)
	}

	now = now.Add(10 * time.Second)
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != ErrInvalidTokenKeyID {
		t.Errorf("verify after key removal error = %v, want %v", err, ErrInvalidTokenKeyID)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("JWKS requests = %d, want 2", got)
	}
}

func TestBearerTokenVerifierFailsClosedWhenTTLRefreshFails(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if requests.Add(1) == 1 {
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
			return
		}
		response.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	verifier := newTestVerifierWithTTL(t, server.URL, &now, time.Minute)
	token := issueToken(t, privateKey, "key-1", validClaims(now))
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != nil {
		t.Fatalf("verify with initial cached key: %v", err)
	}

	now = now.Add(time.Minute)
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != ErrJWKSUnavailable {
		t.Errorf("verify after failed refresh error = %v, want %v", err, ErrJWKSUnavailable)
	}
}

func TestBearerTokenVerifierCoalescesConcurrentTTLRefresh(t *testing.T) {
	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifierWithTTL(t, server.URL, &now, time.Minute)
	claims := withClaim(validClaims(now), "exp", now.Add(time.Hour).Unix())
	token := issueToken(t, privateKey, "key-1", claims)
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != nil {
		t.Fatalf("verify with initial cached key: %v", err)
	}

	now = now.Add(time.Minute)
	var group sync.WaitGroup
	errors := make(chan error, 8)
	for range cap(errors) {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := verifier.Verify(context.Background(), token, "realtime:connect")
			errors <- err
		}()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Errorf("verify after concurrent refresh: %v", err)
		}
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("JWKS requests = %d, want 2", got)
	}
}

func TestBearerTokenVerifierReadinessDeadlineIsNotBlockedByRefresh(t *testing.T) {
	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	refreshStarted := make(chan struct{})
	releaseRefresh := make(chan struct{})
	var startOnce sync.Once
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseRefresh) }) }
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		startOnce.Do(func() { close(refreshStarted) })
		<-releaseRefresh
		_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
	}))
	defer func() {
		release()
		server.Close()
	}()
	verifier := newTestVerifier(t, server.URL, &now)
	token := issueToken(t, privateKey, "key-1", validClaims(now))
	verifyDone := make(chan error, 1)
	go func() {
		_, err := verifier.Verify(context.Background(), token, "realtime:connect")
		verifyDone <- err
	}()

	select {
	case <-refreshStarted:
	case <-time.After(time.Second):
		t.Fatal("JWKS refresh did not start")
	}
	readinessContext, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	readyDone := make(chan error, 1)
	go func() { readyDone <- verifier.Ready(readinessContext) }()
	select {
	case err := <-readyDone:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("Ready() error = %v, want context deadline exceeded", err)
		}
	case <-time.After(250 * time.Millisecond):
		t.Error("Ready() did not respect its context deadline")
	}

	release()
	select {
	case err := <-verifyDone:
		if err != nil {
			t.Errorf("Verify() after releasing refresh = %v", err)
		}
	case <-time.After(time.Second):
		t.Error("Verify() did not finish after releasing refresh")
	}
}

func TestBearerTokenVerifierRejectsJWKSRedirectOutsideConfiguredOrigin(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
	}))
	defer redirectTarget.Close()
	configuredOrigin := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, redirectTarget.URL, http.StatusFound)
	}))
	defer configuredOrigin.Close()
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:     "https://control-plane.example.test",
		Audience:   "runtime-audience",
		JWKSURL:    configuredOrigin.URL,
		HTTPClient: configuredOrigin.Client(),
		Clock:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}

	token := issueToken(t, privateKey, "key-1", validClaims(now))
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != ErrJWKSUnavailable {
		t.Fatalf("Verify() error = %v, want %v", err, ErrJWKSUnavailable)
	}
}

func TestBearerTokenVerifierAcceptsJWKSRedirectWithinConfiguredOrigin(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/jwks" {
			http.Redirect(response, request, "/keys", http.StatusFound)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
	}))
	defer server.Close()
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:     "https://control-plane.example.test",
		Audience:   "runtime-audience",
		JWKSURL:    server.URL + "/jwks",
		HTTPClient: server.Client(),
		Clock:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}

	token := issueToken(t, privateKey, "key-1", validClaims(now))
	if _, err := verifier.Verify(context.Background(), token, "realtime:connect"); err != nil {
		t.Fatalf("Verify(): %v", err)
	}
}

func TestBearerTokenVerifierRateLimitsUnknownKeyIDRefresh(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_ = json.NewEncoder(response).Encode(jwks("known", publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	for _, keyID := range []string{"unknown-1", "unknown-2"} {
		_, err := verifier.Verify(context.Background(), issueToken(t, privateKey, keyID, validClaims(now)), "realtime:connect")
		if err != ErrInvalidTokenKeyID {
			t.Fatalf("verify unknown key %q error = %v, want %v", keyID, err, ErrInvalidTokenKeyID)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("JWKS requests = %d, want 1", got)
	}
}

func TestBearerTokenVerifierReadyEnsuresValidJWKSCache(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	_, publicKey := testKey(t)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_ = json.NewEncoder(response).Encode(jwks("key-1", publicKey))
	}))
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	if err := verifier.Ready(context.Background()); err != nil {
		t.Fatalf("ready: %v", err)
	}
	if err := verifier.Ready(context.Background()); err != nil {
		t.Fatalf("ready from cache: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("JWKS requests = %d, want 1", got)
	}
}

func TestBearerTokenVerifierReadyRejectsUnavailableJWKS(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	if err := newTestVerifier(t, server.URL, &now).Ready(context.Background()); err != ErrJWKSUnavailable {
		t.Errorf("ready error = %v, want %v", err, ErrJWKSUnavailable)
	}
}

func TestBearerTokenVerifierReadyRateLimitsFailedJWKSRefresh(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(response, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)
	for range 2 {
		if err := verifier.Ready(context.Background()); err != ErrJWKSUnavailable {
			t.Fatalf("ready error = %v, want %v", err, ErrJWKSUnavailable)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("JWKS requests during cooldown = %d, want 1", got)
	}
	now = now.Add(30 * time.Second)
	if err := verifier.Ready(context.Background()); err != ErrJWKSUnavailable {
		t.Fatalf("ready after cooldown error = %v, want %v", err, ErrJWKSUnavailable)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("JWKS requests after cooldown = %d, want 2", got)
	}
}

func TestBearerTokenVerifierRejectsInvalidHeaderSignatureAndClaimsWithoutLeakingToken(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)
	privateKey, publicKey := testKey(t)
	server := newJWKSServer(t, "key-1", publicKey)
	defer server.Close()
	verifier := newTestVerifier(t, server.URL, &now)

	tests := []struct {
		name  string
		token string
		want  error
	}{
		{name: "wrong algorithm", token: issueTokenWithHeader(t, privateKey, map[string]any{"alg": "HS256", "kid": "key-1"}, validClaims(now)), want: ErrInvalidTokenAlgorithm},
		{name: "missing key ID", token: issueTokenWithHeader(t, privateKey, map[string]any{"alg": "EdDSA"}, validClaims(now)), want: ErrInvalidTokenKeyID},
		{name: "invalid signature", token: issueToken(t, privateKey, "key-1", validClaims(now)) + "x", want: ErrInvalidTokenSignature},
		{name: "wrong issuer", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "iss", "other-issuer")), want: ErrInvalidTokenClaims},
		{name: "wrong audience", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "aud", "another-runtime")), want: ErrInvalidTokenClaims},
		{name: "expired", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "exp", now.Add(-time.Second).Unix())), want: ErrInvalidTokenClaims},
		{name: "not yet valid", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "nbf", now.Add(time.Second).Unix())), want: ErrInvalidTokenClaims},
		{name: "missing subject", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "sub")), want: ErrInvalidTokenClaims},
		{name: "missing session", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "session_id")), want: ErrInvalidTokenClaims},
		{name: "missing runtime ID", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "runtime_id")), want: ErrInvalidTokenClaims},
		{name: "unknown runtime kind", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "runtime_kind", "Unknown")), want: ErrInvalidTokenClaims},
		{name: "zero assignment epoch", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "assignment_epoch", 0)), want: ErrInvalidTokenClaims},
		{name: "missing presentation", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "presentation_id")), want: ErrInvalidTokenClaims},
		{name: "zero presentation revision", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "presentation_revision", 0)), want: ErrInvalidTokenClaims},
		{name: "missing scope", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "scope")), want: ErrInvalidTokenClaims},
		{name: "zero protocol version", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "protocol_version", 0)), want: ErrInvalidTokenClaims},
		{name: "unsupported protocol version", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "protocol_version", 2)), want: ErrInvalidTokenClaims},
		{name: "unknown role", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "role", "admin")), want: ErrInvalidTokenClaims},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := verifier.Verify(context.Background(), test.token, "realtime:connect"); err != test.want {
				t.Errorf("verify error = %v, want %v", err, test.want)
			} else if err != nil && strings.Contains(err.Error(), test.token) {
				t.Errorf("error leaked token: %v", err)
			}
		})
	}
}

func newTestVerifier(t *testing.T, jwksURL string, now *time.Time) *BearerTokenVerifier {
	return newTestVerifierWithTTL(t, jwksURL, now, 5*time.Minute)
}

func newTestVerifierWithTTL(t *testing.T, jwksURL string, now *time.Time, cacheTTL time.Duration) *BearerTokenVerifier {
	t.Helper()
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:   "https://control-plane.example.test",
		Audience: "runtime-audience",
		JWKSURL:  jwksURL,
		Clock:    func() time.Time { return *now },
		CacheTTL: cacheTTL,
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return verifier
}

func testKey(t *testing.T) (ed25519.PrivateKey, ed25519.PublicKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	return privateKey, publicKey
}

func newJWKSServer(t *testing.T, keyID string, publicKey ed25519.PublicKey) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(jwks(keyID, publicKey))
	}))
}

func jwks(keyID string, publicKey ed25519.PublicKey) map[string]any {
	return map[string]any{"keys": []map[string]any{{"kty": "OKP", "crv": "Ed25519", "kid": keyID, "alg": "EdDSA", "use": "sig", "key_ops": []string{"verify"}, "x": base64.RawURLEncoding.EncodeToString(publicKey)}}}
}

func validClaims(now time.Time) map[string]any {
	return map[string]any{
		"iss":                   "https://control-plane.example.test",
		"aud":                   "runtime-audience",
		"sub":                   "participant-1",
		"session_id":            "session-1",
		"role":                  "presenter",
		"runtime_id":            "runtime-1",
		"runtime_kind":          "Cloud",
		"assignment_epoch":      3,
		"presentation_id":       "presentation-1",
		"presentation_revision": 7,
		"scope":                 "realtime:connect",
		"protocol_version":      1,
		"nbf":                   now.Add(-time.Second).Unix(),
		"exp":                   now.Add(time.Minute).Unix(),
	}
}

func issueToken(t *testing.T, privateKey ed25519.PrivateKey, keyID string, claims map[string]any) string {
	t.Helper()
	return issueTokenWithHeader(t, privateKey, map[string]any{"alg": "EdDSA", "kid": keyID}, claims)
}

func issueTokenWithHeader(t *testing.T, privateKey ed25519.PrivateKey, header, claims map[string]any) string {
	t.Helper()
	headerJSON, err := json.Marshal(header)
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(claimsJSON)
	signature := ed25519.Sign(privateKey, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func withClaim(claims map[string]any, key string, value any) map[string]any {
	copy := mapsClone(claims)
	copy[key] = value
	return copy
}

func withoutClaim(claims map[string]any, key string) map[string]any {
	copy := mapsClone(claims)
	delete(copy, key)
	return copy
}

func mapsClone(input map[string]any) map[string]any {
	copy := make(map[string]any, len(input))
	for key, value := range input {
		copy[key] = value
	}
	return copy
}
