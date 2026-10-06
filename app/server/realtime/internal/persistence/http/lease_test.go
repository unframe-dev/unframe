package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

func testLeaseRequest() BootstrapRequest {
	return BootstrapRequest{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4}
}

func testLeaseValue() RuntimeLease {
	return RuntimeLease{
		Assignment:  BootstrapAssignment{SessionID: "session-1", RuntimeID: "runtime-1", RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: 3, PresentationRevision: 4, LeaseExpiresAt: time.Date(2026, 10, 2, 1, 0, 0, 0, time.UTC)},
		Publication: BootstrapPublication{PresentationID: "presentation-1", PublicationEpoch: 2, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64), DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64)},
	}
}

func TestLeaseRefreshNeedsOnlyAssignmentAndPublication(t *testing.T) {
	want := testLeaseValue()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/runtime/lease" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer service-token" || r.URL.Query().Get("sessionId") != "session-1" || r.URL.Query().Get("runtimeId") != "runtime-1" || r.URL.Query().Get("assignmentEpoch") != "3" {
			t.Error("invalid lease credentials or fence query")
		}
		_ = json.NewEncoder(w).Encode(want)
	}))
	defer server.Close()
	client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
	got, err := client.Lease(context.Background(), testLeaseRequest())
	if err != nil || got != want {
		t.Fatalf("lease=%#v err=%v", got, err)
	}
}

func TestLeaseRejectsUntrustedFenceAndOversizedResponse(t *testing.T) {
	for _, kind := range []string{"session", "runtime", "kind", "epoch", "revision", "hash", "oversized"} {
		t.Run(kind, func(t *testing.T) {
			value := testLeaseValue()
			switch kind {
			case "session":
				value.Assignment.SessionID = "other"
			case "runtime":
				value.Assignment.RuntimeID = "other"
			case "kind":
				value.Assignment.RuntimeKind = assignment.RuntimeKindVenueEdge
			case "epoch":
				value.Assignment.AssignmentEpoch++
			case "revision":
				value.Assignment.PresentationRevision++
			case "hash":
				value.Publication.DefinitionHash = "invalid"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if kind == "oversized" {
					_, _ = w.Write([]byte(strings.Repeat(" ", 64<<10)))
					return
				}
				_ = json.NewEncoder(w).Encode(value)
			}))
			defer server.Close()
			client := NewClient(Config{BaseURL: server.URL, ServiceIdentity: "service-token", AllowInsecureLoopback: true})
			if _, err := client.Lease(context.Background(), testLeaseRequest()); !errors.Is(err, ErrInvalidBootstrap) {
				t.Fatalf("invalid lease accepted: %v", err)
			}
		})
	}
}
