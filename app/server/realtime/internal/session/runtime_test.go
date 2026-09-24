package session

import (
	"errors"
	"testing"
	"time"
)

func TestRuntimeRequiresExplicitAuthorizedResume(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 13, 0, 0, 0, time.UTC)
	runtime := NewRuntime(func() time.Time { return now })
	if snapshot := runtime.Snapshot(); snapshot.Status != RuntimeRunning {
		t.Fatalf("initial status = %v, want %v", snapshot.Status, RuntimeRunning)
	}
	if err := runtime.Pause(PausePresenterDisconnected); err != nil {
		t.Fatalf("Pause(): %v", err)
	}
	paused := runtime.Snapshot()
	if paused.Status != RuntimePaused || paused.PauseReason != PausePresenterDisconnected || !paused.PausedAt.Equal(now) {
		t.Fatalf("paused snapshot = %#v", paused)
	}

	now = now.Add(30 * time.Second)
	for name, authorization := range map[string]ResumeAuthorization{
		"presenter disconnected": {LeaseValid: true, ControlPlanePresenting: true},
		"lease invalid":          {PresenterConnected: true, ControlPlanePresenting: true},
		"session not presenting": {PresenterConnected: true, LeaseValid: true},
	} {
		t.Run(name, func(t *testing.T) {
			if err := runtime.Resume(authorization); !errors.Is(err, ErrResumeUnauthorized) {
				t.Fatalf("Resume() error = %v, want %v", err, ErrResumeUnauthorized)
			}
		})
	}
	if runtime.Snapshot().Status != RuntimePaused {
		t.Fatal("unauthorized resume changed runtime status")
	}

	if err := runtime.Resume(ResumeAuthorization{
		PresenterConnected:     true,
		LeaseValid:             true,
		ControlPlanePresenting: true,
	}); err != nil {
		t.Fatalf("authorized Resume(): %v", err)
	}
	resumed := runtime.Snapshot()
	if resumed.Status != RuntimeRunning || resumed.PauseReason != PauseNone || !resumed.PausedAt.IsZero() {
		t.Fatalf("resumed snapshot = %#v", resumed)
	}
	if resumed.AccumulatedPauseDuration != 30*time.Second {
		t.Fatalf("accumulated pause = %v, want 30s", resumed.AccumulatedPauseDuration)
	}
}

func TestRuntimeTerminationIsIrreversible(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 13, 0, 0, 0, time.UTC)
	runtime := NewRuntime(func() time.Time { return now })
	if err := runtime.Terminate(); err != nil {
		t.Fatalf("Terminate(): %v", err)
	}
	if runtime.Snapshot().Status != RuntimeTerminating {
		t.Fatalf("status = %v, want %v", runtime.Snapshot().Status, RuntimeTerminating)
	}
	if err := runtime.Pause(PauseLeaseExpired); !errors.Is(err, ErrRuntimeTerminating) {
		t.Fatalf("Pause() error = %v, want %v", err, ErrRuntimeTerminating)
	}
	if err := runtime.Resume(ResumeAuthorization{
		PresenterConnected:     true,
		LeaseValid:             true,
		ControlPlanePresenting: true,
	}); !errors.Is(err, ErrRuntimeTerminating) {
		t.Fatalf("Resume() error = %v, want %v", err, ErrRuntimeTerminating)
	}
	if err := runtime.Terminate(); err != nil {
		t.Fatalf("idempotent Terminate(): %v", err)
	}
}

func TestRuntimePauseIsIdempotentAndPreservesFirstReason(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 20, 13, 0, 0, 0, time.UTC)
	runtime := NewRuntime(func() time.Time { return now })
	if err := runtime.Pause(PausePresenterDisconnected); err != nil {
		t.Fatalf("first Pause(): %v", err)
	}
	now = now.Add(time.Minute)
	if err := runtime.Pause(PauseLeaseExpired); err != nil {
		t.Fatalf("second Pause(): %v", err)
	}
	snapshot := runtime.Snapshot()
	if snapshot.PauseReason != PausePresenterDisconnected {
		t.Fatalf("pause reason = %v, want %v", snapshot.PauseReason, PausePresenterDisconnected)
	}
	if snapshot.PausedAt.Equal(now) {
		t.Fatal("idempotent pause replaced original paused time")
	}
}
