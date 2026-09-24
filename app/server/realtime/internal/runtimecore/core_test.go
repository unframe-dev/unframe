package runtimecore

import (
	"errors"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
)

func TestCoreUsesTheSameCompositionForEveryRuntimeKind(t *testing.T) {
	t.Parallel()

	for _, kind := range []assignment.RuntimeKind{assignment.RuntimeKindCloud, assignment.RuntimeKindVenueEdge} {
		t.Run(string(kind), func(t *testing.T) {
			now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
			guard := testGuard(t, kind, &now)
			core, err := New(guard)
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			if core.Coordinator() == nil || core.Assignments() != guard {
				t.Fatal("core did not expose shared coordinator and assignment boundary")
			}
			if err := core.Ready(); err != nil {
				t.Errorf("Ready() error = %v", err)
			}
		})
	}
}

func TestCoreReadinessTracksTheAssignmentLease(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	core, err := New(testGuard(t, assignment.RuntimeKindCloud, &now))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	now = now.Add(time.Minute)
	if err := core.Ready(); !errors.Is(err, assignment.ErrLeaseExpired) {
		t.Errorf("Ready() error = %v, want %v", err, assignment.ErrLeaseExpired)
	}
}

func TestCoreRejectsMissingAssignmentBoundary(t *testing.T) {
	t.Parallel()

	if _, err := New(nil); !errors.Is(err, ErrInvalidDependencies) {
		t.Errorf("New() error = %v, want %v", err, ErrInvalidDependencies)
	}
}

func testGuard(t *testing.T, kind assignment.RuntimeKind, now *time.Time) *assignment.AssignmentGuard {
	t.Helper()
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{
		SessionID:            "session-1",
		RuntimeID:            "runtime-1",
		RuntimeKind:          kind,
		Endpoint:             "runtime.example.test:443",
		AssignmentEpoch:      1,
		PresentationRevision: 1,
		IssuedAt:             *now,
		LeaseExpiresAt:       now.Add(time.Minute),
	}, func() time.Time { return *now })
	if err != nil {
		t.Fatalf("NewAssignmentGuard() error = %v", err)
	}
	return guard
}
