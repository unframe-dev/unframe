package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

const (
	venueEdgeAudience      = "unframe-venue-edge"
	currentProtocolVersion = 1
	defaultJWKSCacheTTL    = 5 * time.Minute
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
	Issuer     string
	JWKSURL    string
	HTTPClient HTTPClient
	Clock      Clock
	CacheTTL   time.Duration
}

// BearerTokenVerifier validates session-bound Venue Edge credentials. Cached
// keys are refreshed when they expire or a token references an unknown key ID.
type BearerTokenVerifier struct {
	issuer     string
	jwksURL    string
	jwksOrigin *url.URL
	httpClient HTTPClient
	clock      Clock

	mu             sync.Mutex
	keys           map[string]ed25519.PublicKey
	cacheExpiresAt time.Time
	cacheTTL       time.Duration
}

func NewBearerTokenVerifier(config BearerTokenVerifierConfig) (*BearerTokenVerifier, error) {
	if config.Issuer == "" || config.JWKSURL == "" {
		return nil, ErrInvalidVerifierConfig
	}
	jwksURL, err := url.ParseRequestURI(config.JWKSURL)
	if err != nil || !jwksURL.IsAbs() || jwksURL.Host == "" {
		return nil, ErrInvalidVerifierConfig
	}
	if config.HTTPClient == nil {
		config.HTTPClient = http.DefaultClient
	}
	if config.Clock == nil {
		config.Clock = time.Now
	}
	if config.CacheTTL <= 0 {
		config.CacheTTL = defaultJWKSCacheTTL
	}
	return &BearerTokenVerifier{
		issuer:     config.Issuer,
		jwksURL:    config.JWKSURL,
		jwksOrigin: jwksURL,
		httpClient: config.HTTPClient,
		clock:      config.Clock,
		cacheTTL:   config.CacheTTL,
	}, nil
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
	v.mu.Lock()
	defer v.mu.Unlock()
	if key := v.keys[keyID]; key != nil && v.clock().Before(v.cacheExpiresAt) {
		return key, nil
	}
	if err := v.refreshKeysLocked(ctx); err != nil {
		return nil, err
	}
	if key := v.keys[keyID]; key != nil {
		return key, nil
	}
	return nil, ErrInvalidTokenKeyID
}

func (v *BearerTokenVerifier) refreshKeysLocked(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return ErrJWKSUnavailable
	}
	response, err := v.httpClient.Do(request)
	if err != nil || response == nil || response.Body == nil {
		return ErrJWKSUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.Request == nil || !sameOrigin(v.jwksOrigin, response.Request.URL) {
		return ErrJWKSUnavailable
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrJWKSUnavailable
	}
	var document jwksDocument
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		return ErrJWKSUnavailable
	}
	keys := make(map[string]ed25519.PublicKey)
	for _, jwk := range document.Keys {
		if jwk.Kty != "OKP" || jwk.Crv != "Ed25519" || jwk.Kid == "" || jwk.Alg != "EdDSA" || (jwk.Use != "" && jwk.Use != "sig") {
			continue
		}
		key, err := base64.RawURLEncoding.DecodeString(jwk.X)
		if err != nil || len(key) != ed25519.PublicKeySize {
			continue
		}
		if _, duplicate := keys[jwk.Kid]; duplicate {
			return ErrJWKSUnavailable
		}
		keys[jwk.Kid] = ed25519.PublicKey(key)
	}
	if len(keys) == 0 {
		return ErrJWKSUnavailable
	}
	v.keys = keys
	v.cacheExpiresAt = v.clock().Add(v.cacheTTL)
	return nil
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
	if !ok || issuer != v.issuer || !hasVenueEdgeAudience(claims["aud"]) {
		return session.Identity{}, nil, ErrInvalidTokenClaims
	}
	participantID, participantOK := requiredString(claims, "sub")
	sessionID, sessionOK := requiredString(claims, "session_id")
	edgeID, edgeOK := requiredString(claims, "edge_id")
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
	if !participantOK || !sessionOK || !edgeOK || !presentationOK || !roleOK || !epochOK || !revisionOK || !protocolOK || !expiresOK || !notBeforeOK || !scopesOK || !expiresAt.After(notBefore) || !now.Before(expiresAt) || now.Before(notBefore) {
		return session.Identity{}, nil, ErrInvalidTokenClaims
	}
	return session.Identity{
		SessionID:            sessionID,
		ParticipantID:        participantID,
		Role:                 role,
		EdgeID:               edgeID,
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
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	X   string `json:"x"`
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

func hasVenueEdgeAudience(raw json.RawMessage) bool {
	var audience string
	if err := json.Unmarshal(raw, &audience); err == nil {
		return audience == venueEdgeAudience
	}
	var audiences []string
	if err := json.Unmarshal(raw, &audiences); err != nil {
		return false
	}
	for _, audience := range audiences {
		if audience == venueEdgeAudience {
			return true
		}
	}
	return false
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
