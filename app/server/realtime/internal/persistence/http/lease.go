package http

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

const maximumLeaseBytes = 16 << 10

type RuntimeLease struct {
	Assignment  BootstrapAssignment  `json:"assignment"`
	Publication BootstrapPublication `json:"publication"`
}

func (c *Client) Lease(ctx context.Context, request BootstrapRequest) (RuntimeLease, error) {
	if !validBootstrapRequest(request) {
		return RuntimeLease{}, ErrInvalidBootstrap
	}
	query := url.Values{"sessionId": {request.SessionID}, "runtimeId": {request.RuntimeID}, "assignmentEpoch": {strconv.FormatUint(request.AssignmentEpoch, 10)}}
	body, err := c.getBounded(ctx, "lease", "/internal/runtime/lease", query, maximumLeaseBytes)
	if err != nil {
		return RuntimeLease{}, err
	}
	var value RuntimeLease
	if err := json.Unmarshal(body, &value); err != nil || !validRuntimeFence(request, value.Assignment, value.Publication) {
		return RuntimeLease{}, ErrInvalidBootstrap
	}
	return value, nil
}

func validBootstrapRequest(request BootstrapRequest) bool {
	return request.SessionID != "" && request.RuntimeID != "" && (request.RuntimeKind == assignment.RuntimeKindCloud || request.RuntimeKind == assignment.RuntimeKindVenueEdge) && request.AssignmentEpoch != 0 && request.PresentationRevision != 0
}

func validRuntimeFence(request BootstrapRequest, value BootstrapAssignment, publication BootstrapPublication) bool {
	return value.SessionID == request.SessionID && value.RuntimeID == request.RuntimeID && value.RuntimeKind == request.RuntimeKind && value.AssignmentEpoch == request.AssignmentEpoch && value.PresentationRevision == request.PresentationRevision && !value.LeaseExpiresAt.IsZero() && publication.PresentationID != "" && publication.PublicationEpoch != 0 && bootstrapHash.MatchString(publication.PublicationManifestHash) && bootstrapHash.MatchString(publication.DefinitionHash) && bootstrapHash.MatchString(publication.RenderBundleHash)
}
