package main

import (
	"errors"
	"net/url"
	"strconv"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/edge"
)

var ErrInvalidConfiguration = errors.New("realtime server configuration is invalid")

type serverConfig struct {
	issuer     string
	jwksURL    string
	assignment edge.EdgeSessionAssignment
}

func loadConfig(getenv func(string) string) (serverConfig, error) {
	issuer, issuerOK := requiredHTTPSURL(getenv, "REALTIME_ISSUER")
	jwksURL, jwksOK := requiredHTTPSURL(getenv, "REALTIME_JWKS_URL")
	sessionID, sessionOK := requiredEnvironment(getenv, "REALTIME_SESSION_ID")
	edgeID, edgeOK := requiredEnvironment(getenv, "REALTIME_EDGE_ID")
	epoch, epochOK := requiredPositiveUint64(getenv, "REALTIME_ASSIGNMENT_EPOCH")
	presentationRevision, revisionOK := requiredPositiveUint64(getenv, "REALTIME_PRESENTATION_REVISION")
	issuedAt, issuedOK := requiredRFC3339Time(getenv, "REALTIME_ASSIGNMENT_ISSUED_AT")
	leaseExpiresAt, leaseOK := requiredRFC3339Time(getenv, "REALTIME_LEASE_EXPIRES_AT")
	if !issuerOK || !jwksOK || !sessionOK || !edgeOK || !epochOK || !revisionOK || !issuedOK || !leaseOK {
		return serverConfig{}, ErrInvalidConfiguration
	}
	assignment := edge.EdgeSessionAssignment{
		SessionID:            sessionID,
		EdgeID:               edgeID,
		AssignmentEpoch:      epoch,
		PresentationRevision: presentationRevision,
		IssuedAt:             issuedAt,
		LeaseExpiresAt:       leaseExpiresAt,
	}
	if err := assignment.Validate(); err != nil {
		return serverConfig{}, ErrInvalidConfiguration
	}
	return serverConfig{issuer: issuer, jwksURL: jwksURL, assignment: assignment}, nil
}

func requiredEnvironment(getenv func(string) string, name string) (string, bool) {
	value := getenv(name)
	return value, value != ""
}

func requiredHTTPSURL(getenv func(string) string, name string) (string, bool) {
	value, ok := requiredEnvironment(getenv, name)
	if !ok {
		return "", false
	}
	parsed, err := url.ParseRequestURI(value)
	return value, err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func requiredPositiveUint64(getenv func(string) string, name string) (uint64, bool) {
	value, ok := requiredEnvironment(getenv, name)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	return parsed, err == nil && parsed > 0
}

func requiredRFC3339Time(getenv func(string) string, name string) (time.Time, bool) {
	value, ok := requiredEnvironment(getenv, name)
	if !ok {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, value)
	return parsed, err == nil
}
