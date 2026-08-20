package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestBearerTokenVerifierVerifiesVenueEdgeClaimsAndRequiredScope(t *testing.T) {
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
		EdgeID:               "edge-1",
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
	if _, err := verifier.Verify(context.Background(), issueToken(t, privateKey, "new-key", validClaims(now)), "realtime:connect"); err != nil {
		t.Fatalf("verify token after unknown-kid refresh: %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("JWKS requests = %d, want 2", got)
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
		{name: "wrong audience", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "aud", "unframe-realtime")), want: ErrInvalidTokenClaims},
		{name: "expired", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "exp", now.Add(-time.Second).Unix())), want: ErrInvalidTokenClaims},
		{name: "not yet valid", token: issueToken(t, privateKey, "key-1", withClaim(validClaims(now), "nbf", now.Add(time.Second).Unix())), want: ErrInvalidTokenClaims},
		{name: "missing subject", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "sub")), want: ErrInvalidTokenClaims},
		{name: "missing session", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "session_id")), want: ErrInvalidTokenClaims},
		{name: "missing required claim", token: issueToken(t, privateKey, "key-1", withoutClaim(validClaims(now), "edge_id")), want: ErrInvalidTokenClaims},
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
			} else if err != nil && contains(err.Error(), test.token) {
				t.Errorf("error leaked token: %v", err)
			}
		})
	}
}

func newTestVerifier(t *testing.T, jwksURL string, now *time.Time) *BearerTokenVerifier {
	t.Helper()
	verifier, err := NewBearerTokenVerifier(BearerTokenVerifierConfig{
		Issuer:  "https://control-plane.example.test",
		JWKSURL: jwksURL,
		Clock:   func() time.Time { return *now },
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
	return map[string]any{"keys": []map[string]any{{"kty": "OKP", "crv": "Ed25519", "kid": keyID, "alg": "EdDSA", "use": "sig", "x": base64.RawURLEncoding.EncodeToString(publicKey)}}}
}

func validClaims(now time.Time) map[string]any {
	return map[string]any{
		"iss":                   "https://control-plane.example.test",
		"aud":                   "unframe-venue-edge",
		"sub":                   "participant-1",
		"session_id":            "session-1",
		"role":                  "presenter",
		"edge_id":               "edge-1",
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

func contains(value, substring string) bool {
	return strings.Contains(value, substring)
}
