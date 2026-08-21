package asset

import (
	"context"
	"errors"
	"net/http"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

var ErrAccessDenied = errors.New("asset access is denied")

type BearerVerifier interface {
	VerifyBearer(context.Context, string, ...string) (session.Identity, error)
}

type CurrentAssignmentValidator interface {
	ValidateCurrent(assignment.AssignmentClaim) error
}

type VenueEdgeAccessValidator struct {
	verifier    BearerVerifier
	assignments CurrentAssignmentValidator
}

func NewVenueEdgeAccessValidator(verifier BearerVerifier, assignments CurrentAssignmentValidator) (*VenueEdgeAccessValidator, error) {
	if verifier == nil || assignments == nil {
		return nil, errors.New("asset credential verifier and assignment validator are required")
	}
	return &VenueEdgeAccessValidator{verifier: verifier, assignments: assignments}, nil
}

func (v *VenueEdgeAccessValidator) Validate(request *http.Request, sessionID string, manifest Manifest) error {
	identity, err := v.verifier.VerifyBearer(request.Context(), request.Header.Get("Authorization"), "assets:read")
	if err != nil {
		return ErrAccessDenied
	}
	if identity.RuntimeKind != assignment.RuntimeKindVenueEdge {
		return ErrAccessDenied
	}
	claim := assignment.AssignmentClaim{
		SessionID:            identity.SessionID,
		RuntimeID:            identity.RuntimeID,
		RuntimeKind:          identity.RuntimeKind,
		AssignmentEpoch:      identity.AssignmentEpoch,
		PresentationRevision: identity.PresentationRevision,
	}
	if err := v.assignments.ValidateCurrent(claim); err != nil {
		return ErrAccessDenied
	}
	if identity.SessionID != sessionID || identity.PresentationID != manifest.PresentationID || identity.PresentationRevision != manifest.PresentationRevision {
		return ErrAccessDenied
	}
	return nil
}
