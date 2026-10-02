package http

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/encoding/protojson"
)

const maximumBootstrapBytes = 64 << 20

var (
	ErrInvalidBootstrap  = errors.New("invalid runtime bootstrap")
	ErrInvalidProjection = errors.New("invalid runtime projection")
	bootstrapHash        = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

type BootstrapRequest struct {
	SessionID            string
	RuntimeID            string
	RuntimeKind          assignment.RuntimeKind
	AssignmentEpoch      uint64
	PresentationRevision uint64
}

type BootstrapAssignment struct {
	SessionID            string                 `json:"sessionId"`
	RuntimeID            string                 `json:"runtimeId"`
	RuntimeKind          assignment.RuntimeKind `json:"runtimeKind"`
	AssignmentEpoch      uint64                 `json:"assignmentEpoch"`
	PresentationRevision uint64                 `json:"presentationRevision"`
	LeaseExpiresAt       time.Time              `json:"leaseExpiresAt"`
}

type BootstrapPublication struct {
	PresentationID          string `json:"presentationId"`
	PublicationEpoch        uint64 `json:"publicationEpoch"`
	PublicationManifestHash string `json:"publicationManifestHash"`
	DefinitionHash          string `json:"definitionHash"`
	RenderBundleHash        string `json:"renderBundleHash"`
}

type RuntimeBootstrap struct {
	Assignment   BootstrapAssignment  `json:"assignment"`
	Publication  BootstrapPublication `json:"publication"`
	Definition   json.RawMessage      `json:"definition"`
	RenderBundle json.RawMessage      `json:"renderBundle"`
	Checkpoint   json.RawMessage      `json:"checkpoint"`
}

type ProjectionRequest struct {
	SessionID     string
	ParticipantID string
}

type RuntimeProjection struct {
	Role    string
	Profile *deliveryv2.ProjectionProfileDescriptor
}

func (c *Client) Bootstrap(ctx context.Context, request BootstrapRequest) (RuntimeBootstrap, error) {
	if request.SessionID == "" || request.RuntimeID == "" || (request.RuntimeKind != assignment.RuntimeKindCloud && request.RuntimeKind != assignment.RuntimeKindVenueEdge) || request.AssignmentEpoch == 0 || request.PresentationRevision == 0 {
		return RuntimeBootstrap{}, ErrInvalidBootstrap
	}
	query := url.Values{"sessionId": {request.SessionID}, "runtimeId": {request.RuntimeID}, "assignmentEpoch": {strconv.FormatUint(request.AssignmentEpoch, 10)}}
	body, err := c.get(ctx, "bootstrap", "/internal/runtime/bootstrap", query)
	if err != nil {
		return RuntimeBootstrap{}, err
	}
	var value RuntimeBootstrap
	if err := json.Unmarshal(body, &value); err != nil || value.Assignment.SessionID != request.SessionID || value.Assignment.RuntimeID != request.RuntimeID || value.Assignment.RuntimeKind != request.RuntimeKind || value.Assignment.AssignmentEpoch != request.AssignmentEpoch || value.Assignment.PresentationRevision != request.PresentationRevision || value.Assignment.LeaseExpiresAt.IsZero() || value.Publication.PresentationID == "" || value.Publication.PublicationEpoch == 0 || !bootstrapHash.MatchString(value.Publication.PublicationManifestHash) || !bootstrapHash.MatchString(value.Publication.DefinitionHash) || !bootstrapHash.MatchString(value.Publication.RenderBundleHash) || !json.Valid(value.Definition) || string(value.Definition) == "null" || !json.Valid(value.RenderBundle) || string(value.RenderBundle) == "null" {
		return RuntimeBootstrap{}, ErrInvalidBootstrap
	}
	if len(value.Checkpoint) != 0 && string(value.Checkpoint) != "null" {
		checkpoint := &realtimev2.DurableCheckpointEnvelope{}
		if err := protojson.Unmarshal(value.Checkpoint, checkpoint); err != nil {
			return RuntimeBootstrap{}, ErrInvalidBootstrap
		}
	}
	return value, nil
}

func (c *Client) Projection(ctx context.Context, request ProjectionRequest) (RuntimeProjection, error) {
	if request.SessionID == "" || request.ParticipantID == "" {
		return RuntimeProjection{}, ErrInvalidProjection
	}
	query := url.Values{"sessionId": {request.SessionID}, "participantId": {request.ParticipantID}}
	body, err := c.get(ctx, "projection", "/internal/runtime/projection", query)
	if err != nil {
		return RuntimeProjection{}, err
	}
	var value struct {
		Role    string          `json:"role"`
		Profile json.RawMessage `json:"profile"`
	}
	if err := json.Unmarshal(body, &value); err != nil || (value.Role != "presenter" && value.Role != "viewer") {
		return RuntimeProjection{}, ErrInvalidProjection
	}
	profile := &deliveryv2.ProjectionProfileDescriptor{}
	if err := protojson.Unmarshal(value.Profile, profile); err != nil || profile.ProjectionProfileId == "" || profile.RuntimeCatalog == nil || len(profile.RequiredRuntimeCapabilities) == 0 {
		return RuntimeProjection{}, ErrInvalidProjection
	}
	return RuntimeProjection{Role: value.Role, Profile: profile}, nil
}

func (c *Client) get(ctx context.Context, operation, path string, query url.Values) ([]byte, error) {
	endpoint, err := c.callbackEndpoint(path)
	if err != nil {
		return nil, err
	}
	endpoint.RawQuery = query.Encode()
	requestContext, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	request, err := stdhttp.NewRequestWithContext(requestContext, stdhttp.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, ErrInvalidConfig
	}
	request.Header.Set("Authorization", "Bearer "+c.serviceIdentity)
	response, err := c.httpClient.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &requestError{operation: operation}
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &ResponseError{Operation: operation, StatusCode: response.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximumBootstrapBytes+1))
	if err != nil || len(body) > maximumBootstrapBytes {
		return nil, ErrInvalidBootstrap
	}
	return body, nil
}
