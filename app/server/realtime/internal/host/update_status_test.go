package host

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUpdateStatusPrivateRoundTripAndDrain(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "control")
	if err := SetUpdateDrain(directory, true); err != nil {
		t.Fatal(err)
	}
	drained, err := updateDrain(directory)
	if err != nil || !drained {
		t.Fatalf("drain = %v, %v", drained, err)
	}
	status := UpdateStatus{SchemaVersion: 1, PID: os.Getpid(), UpdatedAt: time.Now().UTC(), Draining: true, ActiveSessions: 2}
	if err := writeUpdateStatus(directory, status); err != nil {
		t.Fatal(err)
	}
	got, err := ReadUpdateStatus(directory, time.Now())
	if err != nil || got.ActiveSessions != 2 || !got.Draining {
		t.Fatalf("status = %+v, %v", got, err)
	}
	info, err := os.Stat(filepath.Join(directory, "status.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("status permission = %v, %v", info, err)
	}
	if _, err := ReadUpdateStatus(directory, time.Now().Add(16*time.Second)); err == nil {
		t.Fatal("accepted stale status")
	}
	if err := SetUpdateDrain(directory, false); err != nil {
		t.Fatal(err)
	}
	drained, err = updateDrain(directory)
	if err != nil || drained {
		t.Fatalf("released drain = %v, %v", drained, err)
	}
}

func TestUpdateControlRejectsPublicDirectoryAndSymlinks(t *testing.T) {
	directory := t.TempDir()
	if err := os.Chmod(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := SetUpdateDrain(directory, true); err == nil {
		t.Fatal("accepted public directory")
	}
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := SetUpdateDrain(link, true); err == nil {
		t.Fatal("accepted symlink directory")
	}
}

func TestSupervisorPublishesOnlyAcknowledgedDrainAndAssignmentCount(t *testing.T) {
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 32), responses: make(chan heartbeatResult, 32)}
	s := testSupervisor(cp)
	s.UpdateDirectory = directory
	s.Start = func(context.Context, Assignment, <-chan Assignment) (Execution, error) {
		return &fakeExecution{done: make(chan struct{})}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	defer func() {
		cancel()
		if err := receive(t, done); err != nil {
			t.Error(err)
		}
	}()
	if !receive(t, cp.requests).Accepting {
		t.Fatal("initial heartbeat rejected new assignments")
	}
	if _, err := os.Stat(filepath.Join(directory, "status.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("status before heartbeat acknowledgement: %v", err)
	}
	cp.responses <- heartbeatResult{assignments: []Assignment{hostAssignment()}}
	waitStatus := func(check func(UpdateStatus) bool) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			status, err := ReadUpdateStatus(directory, time.Now())
			if err == nil && check(status) {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("expected status was not published")
	}
	waitStatus(func(s UpdateStatus) bool { return !s.Draining && s.ActiveSessions == 1 })
	if err := SetUpdateDrain(directory, true); err != nil {
		t.Fatal(err)
	}
	// An already in-flight accepting heartbeat must finish before drain is acknowledged.
	cp.responses <- heartbeatResult{assignments: []Assignment{hostAssignment()}}
	waitStatus(func(s UpdateStatus) bool { return s.Draining })
	if err := SetUpdateDrain(directory, false); err != nil {
		t.Fatal(err)
	}
	for !receive(t, cp.requests).Accepting {
	}
}
