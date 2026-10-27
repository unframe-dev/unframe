package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assetgateway"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

// Asset rechecks the live assignment and selected participant projection before
// disclosing a short-lived Cloud origin URL to the Runtime.
func (c *Client) Asset(ctx context.Context, identity session.Identity, assetID string, pin BootstrapPublication) (assetgateway.Asset, error) {
	query := url.Values{"sessionId": {identity.SessionID}, "runtimeId": {identity.RuntimeID}, "assignmentEpoch": {strconv.FormatUint(identity.AssignmentEpoch, 10)}, "participantId": {identity.ParticipantID}, "assetId": {assetID}}
	body, err := c.getBounded(ctx, "asset", "/internal/runtime/assets", query, 64<<10)
	if err != nil {
		return assetgateway.Asset{}, err
	}
	var result struct {
		assetgateway.Asset
		Assignment  BootstrapAssignment  `json:"assignment"`
		Publication BootstrapPublication `json:"publication"`
	}
	if err = json.Unmarshal(body, &result); err != nil {
		return assetgateway.Asset{}, err
	}
	request := BootstrapRequest{SessionID: identity.SessionID, RuntimeID: identity.RuntimeID, RuntimeKind: identity.RuntimeKind, AssignmentEpoch: identity.AssignmentEpoch, PresentationRevision: identity.PresentationRevision}
	if identity.RuntimeKind != assignment.RuntimeKindVenueEdge || identity.PresentationID != pin.PresentationID || result.Publication != pin || !validRuntimeFence(request, result.Assignment, result.Publication) {
		return assetgateway.Asset{}, errors.New("asset runtime fence changed")
	}
	return result.Asset, nil
}
