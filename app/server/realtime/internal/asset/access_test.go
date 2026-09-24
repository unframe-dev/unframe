package asset

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

type tokenVerifierStub struct {
	identity session.Identity
	err      error
	scope    string
}

func (stub *tokenVerifierStub) VerifyBearer(_ context.Context, _ string, scopes ...string) (session.Identity, error) {
	if len(scopes) == 1 {
		stub.scope = scopes[0]
	}
	return stub.identity, stub.err
}

type assignmentValidatorStub struct {
	claim assignment.AssignmentClaim
	err   error
}

func (stub *assignmentValidatorStub) ValidateCurrent(claim assignment.AssignmentClaim) error {
	stub.claim = claim
	return stub.err
}

func TestVenueEdgeAccessValidatorRequiresAssetScopeAndManifestAssignment(t *testing.T) {
	t.Parallel()

	identity := session.Identity{
		SessionID: "session-1", ParticipantID: "participant-1", Role: session.RoleViewer,
		RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindVenueEdge, AssignmentEpoch: 2, PresentationID: "presentation-1",
		PresentationRevision: 4, ProtocolVersion: 1,
	}
	verifier := &tokenVerifierStub{identity: identity}
	assignments := &assignmentValidatorStub{}
	validator, err := NewVenueEdgeAccessValidator(verifier, assignments)
	if err != nil {
		t.Fatalf("NewVenueEdgeAccessValidator(): %v", err)
	}
	request := httptest.NewRequest("GET", "/assets/asset-1", nil)
	request.Header.Set("Authorization", "Bearer credential")
	manifest := testManifest([]byte("payload"), "https://example.test/source")
	manifest.PresentationRevision = 4
	if err := validator.Validate(request, "session-1", manifest); err != nil {
		t.Fatalf("Validate(): %v", err)
	}
	if verifier.scope != "assets:read" {
		t.Fatalf("required scope = %q, want assets:read", verifier.scope)
	}
	wantClaim := assignment.AssignmentClaim{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindVenueEdge, AssignmentEpoch: 2, PresentationRevision: 4}
	if assignments.claim != wantClaim {
		t.Fatalf("assignment claim = %#v, want %#v", assignments.claim, wantClaim)
	}
}

func TestVenueEdgeAccessValidatorRejectsCredentialAssignmentAndManifestMismatch(t *testing.T) {
	t.Parallel()

	identity := session.Identity{
		SessionID: "session-1", ParticipantID: "participant-1", Role: session.RoleViewer,
		RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindVenueEdge, AssignmentEpoch: 2, PresentationID: "presentation-1",
		PresentationRevision: 4, ProtocolVersion: 1,
	}
	manifest := testManifest([]byte("payload"), "https://example.test/source")
	manifest.PresentationRevision = 4
	request := httptest.NewRequest("GET", "/assets/asset-1", nil)

	for name, test := range map[string]struct {
		verifier    *tokenVerifierStub
		assignments *assignmentValidatorStub
		mutate      func(*Manifest)
	}{
		"credential":   {verifier: &tokenVerifierStub{err: errors.New("invalid token")}, assignments: &assignmentValidatorStub{}, mutate: func(*Manifest) {}},
		"assignment":   {verifier: &tokenVerifierStub{identity: identity}, assignments: &assignmentValidatorStub{err: assignment.ErrLeaseExpired}, mutate: func(*Manifest) {}},
		"presentation": {verifier: &tokenVerifierStub{identity: identity}, assignments: &assignmentValidatorStub{}, mutate: func(value *Manifest) { value.PresentationID = "presentation-2" }},
		"revision":     {verifier: &tokenVerifierStub{identity: identity}, assignments: &assignmentValidatorStub{}, mutate: func(value *Manifest) { value.PresentationRevision = 5 }},
		"session":      {verifier: &tokenVerifierStub{identity: identity}, assignments: &assignmentValidatorStub{}, mutate: func(*Manifest) {}},
	} {
		t.Run(name, func(t *testing.T) {
			value := manifest
			test.mutate(&value)
			validator, err := NewVenueEdgeAccessValidator(test.verifier, test.assignments)
			if err != nil {
				t.Fatalf("NewVenueEdgeAccessValidator(): %v", err)
			}
			sessionID := "session-1"
			if name == "session" {
				sessionID = "session-2"
			}
			if err := validator.Validate(request, sessionID, value); !errors.Is(err, ErrAccessDenied) {
				t.Fatalf("Validate() error = %v, want %v", err, ErrAccessDenied)
			}
		})
	}
}

func TestVenueEdgeAccessValidatorRejectsCloudRuntimeCredential(t *testing.T) {
	t.Parallel()

	identity := session.Identity{
		SessionID: "session-1", ParticipantID: "participant-1", Role: session.RoleViewer,
		RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 2,
		PresentationID: "presentation-1", PresentationRevision: 4, ProtocolVersion: 1,
	}
	validator, err := NewVenueEdgeAccessValidator(&tokenVerifierStub{identity: identity}, &assignmentValidatorStub{})
	if err != nil {
		t.Fatalf("NewVenueEdgeAccessValidator(): %v", err)
	}
	request := httptest.NewRequest("GET", "/assets/asset-1", nil)
	manifest := testManifest([]byte("payload"), "https://example.test/source")
	manifest.PresentationRevision = 4
	if err := validator.Validate(request, "session-1", manifest); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("Validate() error = %v, want %v", err, ErrAccessDenied)
	}
}
