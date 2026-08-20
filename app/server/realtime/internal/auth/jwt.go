package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

const (
	currentProtocolVersion    = 1
	defaultJWKSCacheTTL       = 5 * time.Minute
	defaultRefreshCooldown    = 30 * time.Second
	defaultJWKSRequestTimeout = 5 * time.Second
	maxJWKSBodyBytes          = 1 << 20
)

var (
	ErrInvalidVerifierConfig = errors.New("bearer token verifier configuration is invalid")
	ErrInvalidAuthorization  = errors.New("bearer authorization is invalid")
	ErrInvalidToken          = errors.New("bearer token is invalid")
	ErrInvalidTokenAlgorithm = errors.New("bearer token algorithm is invalid")
	ErrInvalidTokenKeyID     = errors.New("bearer token key ID is invalid")
	ErrInvalidTokenSignature = errors.New("bearer token signature is invalid")
	ErrInvalidTokenClaims    = errors.New("bearer token claims are invalid")
	ErrInsufficientScope     = errors.New("bearer token scope is insufficient")
	ErrJWKSUnavailable       = errors.New("verification keys are unavailable")
)

// HTTPClient is shared by gRPC and HTTP authentication adapters to retrieve
// the Control Plane JWKS.
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Clock supplies the current time for JWT temporal-claim validation.
type Clock func() time.Time

type BearerTokenVerifierConfig struct {
	Issuer          string
	Audience        string
	JWKSURL         string
	CacheTTL        time.Duration
	RefreshCooldown time.Duration
	RequestTimeout  time.Duration
	HTTPClient      HTTPClient
	Clock           Clock
}

// BearerTokenVerifier validates session-bound Runtime credentials. Cached keys
// are refreshed when a token references an unknown key ID.
type BearerTokenVerifier struct {
	issuer          string
	audience        string
	jwksURL         string
	jwksOrigin      *url.URL
	cacheTTL        time.Duration
	refreshCooldown time.Duration
	requestTimeout  time.Duration
	httpClient      HTTPClient
	clock           Clock

	mu          sync.Mutex
	keys        map[string]ed25519.PublicKey
	expiresAt   time.Time
	lastRefresh time.Time
	refreshing  *jwksRefresh
}

type jwksRefresh struct {
	done chan struct{}
	err  error
}

func NewBearerTokenVerifier(config BearerTokenVerifierConfig) (*BearerTokenVerifier, error) {
	if config.Issuer == "" || config.Audience == "" || config.JWKSURL == "" {
		return nil, ErrInvalidVerifierConfig
	}
	jwksURL, err := url.ParseRequestURI(config.JWKSURL)
	if err != nil || !jwksURL.IsAbs() || jwksURL.Host == "" {
		return nil, ErrInvalidVerifierConfig
	}
	if config.CacheTTL <= 0 {
		config.CacheTTL = defaultJWKSCacheTTL
	}
	if config.RefreshCooldown <= 0 {
		config.RefreshCooldown = defaultRefreshCooldown
	}
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = defaultJWKSRequestTimeout
	}
	if config.HTTPClient == nil {
		config.HTTPClient = http.DefaultClient
	}
	if config.Clock == nil {
		config.Clock = time.Now
	}
	return &BearerTokenVerifier{
		issuer:          config.Issuer,
		audience:        config.Audience,
		jwksURL:         config.JWKSURL,
		jwksOrigin:      jwksURL,
		cacheTTL:        config.CacheTTL,
		refreshCooldown: config.RefreshCooldown,
		requestTimeout:  config.RequestTimeout,
		httpClient:      config.HTTPClient,
		clock:           config.Clock,
	}, nil
}

// Ready confirms that an unexpired JWKS cache with at least one usable
// verification key is available for application readiness checks.
func (v *BearerTokenVerifier) Ready(ctx context.Context) error {
	if err := v.ensureFreshKeys(ctx); err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if len(v.keys) == 0 || !v.clock().Before(v.expiresAt) {
		return ErrJWKSUnavailable
	}
	return nil
}

// VerifyBearer parses an HTTP or gRPC Bearer authorization value and verifies
// that it grants every required scope.
func (v *BearerTokenVerifier) VerifyBearer(ctx context.Context, authorization string, requiredScopes ...string) (session.Identity, error) {
	scheme, token, ok := strings.Cut(authorization, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" || strings.ContainsAny(token, " \t\r\n") {
		return session.Identity{}, ErrInvalidAuthorization
	}
	return v.Verify(ctx, token, requiredScopes...)
}

// Verify validates a raw compact JWT and maps its verified claims to a
// transport-independent session identity.
func (v *BearerTokenVerifier) Verify(ctx context.Context, token string, requiredScopes ...string) (session.Identity, error) {
	headerSegment, claimsSegment, signatureSegment, ok := splitCompactJWT(token)
	if !ok {
		return session.Identity{}, ErrInvalidToken
	}
	header, err := decodeJWTHeader(headerSegment)
	if err != nil {
		return session.Identity{}, err
	}
	publicKey, err := v.keyFor(ctx, header.Kid)
	if err != nil {
		return session.Identity{}, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(signatureSegment)
	if err != nil || !ed25519.Verify(publicKey, []byte(headerSegment+"."+claimsSegment), signature) {
		return session.Identity{}, ErrInvalidTokenSignature
	}
	claimsJSON, err := base64.RawURLEncoding.DecodeString(claimsSegment)
	if err != nil {
		return session.Identity{}, ErrInvalidToken
	}
	identity, scopes, err := v.validateClaims(claimsJSON)
	if err != nil {
		return session.Identity{}, err
	}
	for _, requiredScope := range requiredScopes {
		if requiredScope == "" || !scopes[requiredScope] {
			return session.Identity{}, ErrInsufficientScope
		}
	}
	return identity, nil
}

func (v *BearerTokenVerifier) keyFor(ctx context.Context, keyID string) (ed25519.PublicKey, error) {
	if err := v.ensureFreshKeys(ctx); err != nil {
		return nil, err
	}
	if key := v.cachedKey(keyID); key != nil {
		return key, nil
	}
	if err := v.refreshForUnknownKey(ctx); err != nil {
		return nil, err
	}
	if key := v.cachedKey(keyID); key != nil {
		return key, nil
	}
	return nil, ErrInvalidTokenKeyID
}

func (v *BearerTokenVerifier) cachedKey(keyID string) ed25519.PublicKey {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.keys[keyID]
}

func (v *BearerTokenVerifier) ensureFreshKeys(ctx context.Context) error {
	v.mu.Lock()
	now := v.clock()
	if len(v.keys) > 0 && now.Before(v.expiresAt) {
		v.mu.Unlock()
		return nil
	}
	if refresh := v.refreshing; refresh != nil {
		v.mu.Unlock()
		return waitForJWKSRefresh(ctx, refresh)
	}
	if len(v.keys) == 0 && !v.refreshAllowed(now) {
		v.mu.Unlock()
		return ErrJWKSUnavailable
	}
	refresh := v.beginRefreshLocked(now)
	v.mu.Unlock()
	return v.runRefresh(ctx, refresh)
}

func (v *BearerTokenVerifier) refreshForUnknownKey(ctx context.Context) error {
	v.mu.Lock()
	if refresh := v.refreshing; refresh != nil {
		v.mu.Unlock()
		return waitForJWKSRefresh(ctx, refresh)
	}
	now := v.clock()
	if !v.refreshAllowed(now) {
		v.mu.Unlock()
		return nil
	}
	refresh := v.beginRefreshLocked(now)
	v.mu.Unlock()
	return v.runRefresh(ctx, refresh)
}

func (v *BearerTokenVerifier) beginRefreshLocked(now time.Time) *jwksRefresh {
	refresh := &jwksRefresh{done: make(chan struct{})}
	v.lastRefresh = now
	v.refreshing = refresh
	return refresh
}

func (v *BearerTokenVerifier) runRefresh(ctx context.Context, refresh *jwksRefresh) error {
	keys, err := v.fetchKeys(ctx)
	v.mu.Lock()
	if err == nil {
		v.keys = keys
		v.expiresAt = v.clock().Add(v.cacheTTL)
	}
	refresh.err = err
	v.refreshing = nil
	close(refresh.done)
	v.mu.Unlock()
	return err
}

func waitForJWKSRefresh(ctx context.Context, refresh *jwksRefresh) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-refresh.done:
		return refresh.err
	}
}

func (v *BearerTokenVerifier) refreshAllowed(now time.Time) bool {
	return v.lastRefresh.IsZero() || now.Sub(v.lastRefresh) >= v.refreshCooldown
}

func (v *BearerTokenVerifier) fetchKeys(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	requestContext, cancel := context.WithTimeout(ctx, v.requestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, ErrJWKSUnavailable
	}
	response, err := v.httpClient.Do(request)
	if err != nil || response == nil || response.Body == nil {
		if requestContext.Err() != nil {
			return nil, requestContext.Err()
		}
		return nil, ErrJWKSUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.Request == nil || !sameOrigin(v.jwksOrigin, response.Request.URL) {
		return nil, ErrJWKSUnavailable
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, ErrJWKSUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxJWKSBodyBytes+1))
	if err != nil || len(body) > maxJWKSBodyBytes {
		return nil, ErrJWKSUnavailable
	}
	var document jwksDocument
	if err := json.Unmarshal(body, &document); err != nil {
		return nil, ErrJWKSUnavailable
	}
	keys := make(map[string]ed25519.PublicKey)
	for _, jwk := range document.Keys {
		if jwk.Kty != "OKP" || jwk.Crv != "Ed25519" || jwk.Kid == "" || jwk.Alg != "EdDSA" || jwk.Use != "sig" || !hasKeyOperation(jwk.KeyOps, "verify") {
			continue
		}
		key, err := base64.RawURLEncoding.DecodeString(jwk.X)
		if err != nil || len(key) != ed25519.PublicKeySize {
			continue
		}
		if _, duplicate := keys[jwk.Kid]; duplicate {
			return nil, ErrJWKSUnavailable
		}
		keys[jwk.Kid] = ed25519.PublicKey(key)
	}
	if len(keys) == 0 {
		return nil, ErrJWKSUnavailable
	}
	return keys, nil
}

func sameOrigin(trusted, actual *url.URL) bool {
	return trusted != nil && actual != nil &&
		strings.EqualFold(trusted.Scheme, actual.Scheme) &&
		strings.EqualFold(trusted.Host, actual.Host)
}

func (v *BearerTokenVerifier) validateClaims(claimsJSON []byte) (session.Identity, map[string]bool, error) {
	var claims map[string]json.RawMessage
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return session.Identity{}, nil, ErrInvalidTokenClaims
	}
	issuer, ok := requiredString(claims, "iss")
	if !ok || issuer != v.issuer || !hasAudience(claims["aud"], v.audience) {
		return session.Identity{}, nil, ErrInvalidTokenClaims
	}
	participantID, participantOK := requiredString(claims, "sub")
	sessionID, sessionOK := requiredString(claims, "session_id")
	runtimeID, runtimeOK := requiredString(claims, "runtime_id")
	runtimeKind, runtimeKindOK := parseRuntimeKind(claims["runtime_kind"])
	presentationID, presentationOK := requiredString(claims, "presentation_id")
	role, roleOK := parseRole(claims["role"])
	epoch, epochOK := requiredPositiveUint64(claims, "assignment_epoch")
	revision, revisionOK := requiredPositiveUint64(claims, "presentation_revision")
	protocolVersion, protocolOK := requiredPositiveUint64(claims, "protocol_version")
	protocolOK = protocolOK && protocolVersion == currentProtocolVersion
	expiresAt, expiresOK := requiredUnixTime(claims, "exp")
	notBefore, notBeforeOK := requiredUnixTime(claims, "nbf")
	scopes, scopesOK := parseScopes(claims["scope"])
	now := v.clock()
	if !participantOK || !sessionOK || !runtimeOK || !runtimeKindOK || !presentationOK || !roleOK || !epochOK || !revisionOK || !protocolOK || !expiresOK || !notBeforeOK || !scopesOK || !expiresAt.After(notBefore) || !now.Before(expiresAt) || now.Before(notBefore) {
		return session.Identity{}, nil, ErrInvalidTokenClaims
	}
	return session.Identity{
		SessionID:            sessionID,
		ParticipantID:        participantID,
		Role:                 role,
		RuntimeID:            runtimeID,
		RuntimeKind:          runtimeKind,
		AssignmentEpoch:      epoch,
		PresentationID:       presentationID,
		PresentationRevision: revision,
		ProtocolVersion:      protocolVersion,
	}, scopes, nil
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty    string   `json:"kty"`
	Crv    string   `json:"crv"`
	Kid    string   `json:"kid"`
	Alg    string   `json:"alg"`
	Use    string   `json:"use"`
	KeyOps []string `json:"key_ops"`
	X      string   `json:"x"`
}

func splitCompactJWT(token string) (string, string, string, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func decodeJWTHeader(segment string) (jwtHeader, error) {
	encoded, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return jwtHeader{}, ErrInvalidToken
	}
	var header jwtHeader
	if err := json.Unmarshal(encoded, &header); err != nil {
		return jwtHeader{}, ErrInvalidToken
	}
	if header.Alg != "EdDSA" {
		return jwtHeader{}, ErrInvalidTokenAlgorithm
	}
	if header.Kid == "" {
		return jwtHeader{}, ErrInvalidTokenKeyID
	}
	return header, nil
}

func requiredString(claims map[string]json.RawMessage, name string) (string, bool) {
	var value string
	if err := json.Unmarshal(claims[name], &value); err != nil || value == "" {
		return "", false
	}
	return value, true
}

func requiredPositiveUint64(claims map[string]json.RawMessage, name string) (uint64, bool) {
	var value uint64
	if err := json.Unmarshal(claims[name], &value); err != nil || value == 0 {
		return 0, false
	}
	return value, true
}

func requiredUnixTime(claims map[string]json.RawMessage, name string) (time.Time, bool) {
	var value int64
	if err := json.Unmarshal(claims[name], &value); err != nil {
		return time.Time{}, false
	}
	return time.Unix(value, 0), true
}

func hasAudience(raw json.RawMessage, expected string) bool {
	var audience string
	if err := json.Unmarshal(raw, &audience); err == nil {
		return audience == expected
	}
	var audiences []string
	if err := json.Unmarshal(raw, &audiences); err != nil {
		return false
	}
	for _, audience := range audiences {
		if audience == expected {
			return true
		}
	}
	return false
}

func parseRuntimeKind(raw json.RawMessage) (assignment.RuntimeKind, bool) {
	var kind assignment.RuntimeKind
	if err := json.Unmarshal(raw, &kind); err != nil {
		return "", false
	}
	switch kind {
	case assignment.RuntimeKindCloud, assignment.RuntimeKindVenueEdge:
		return kind, true
	default:
		return "", false
	}
}

func parseRole(raw json.RawMessage) (session.Role, bool) {
	var role string
	if err := json.Unmarshal(raw, &role); err != nil {
		return session.RoleUnknown, false
	}
	switch role {
	case "presenter":
		return session.RolePresenter, true
	case "viewer":
		return session.RoleViewer, true
	default:
		return session.RoleUnknown, false
	}
}

func parseScopes(raw json.RawMessage) (map[string]bool, bool) {
	var scope string
	if err := json.Unmarshal(raw, &scope); err != nil || scope == "" {
		return nil, false
	}
	scopes := make(map[string]bool)
	for _, item := range strings.Fields(scope) {
		scopes[item] = true
	}
	return scopes, len(scopes) > 0
}

func hasKeyOperation(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
