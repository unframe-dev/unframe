package host

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type heartbeatResult struct {
	assignments []Assignment
	err         error
}
type fakeControlPlane struct {
	requests  chan Heartbeat
	responses chan heartbeatResult
}

func (f *fakeControlPlane) Start(context.Context, Registration) (uint64, error) { return 1, nil }
func (f *fakeControlPlane) Heartbeat(ctx context.Context, r Heartbeat) (HeartbeatResponse, error) {
	select {
	case f.requests <- r:
	case <-ctx.Done():
		return HeartbeatResponse{}, ctx.Err()
	}
	if !r.Accepting {
		return HeartbeatResponse{Generation: 1, Assignments: []Assignment{}}, nil
	}
	select {
	case result := <-f.responses:
		return HeartbeatResponse{Generation: 1, Assignments: result.assignments}, result.err
	case <-ctx.Done():
		return HeartbeatResponse{}, ctx.Err()
	}
}

type fakeExecution struct {
	stopped  atomic.Bool
	revoked  atomic.Bool
	renewals atomic.Int32
	done     chan struct{}
	stopHook func(context.Context) error
}

func (f *fakeExecution) Done() <-chan struct{}  { return f.done }
func (f *fakeExecution) Revoke()                { f.revoked.Store(true) }
func (f *fakeExecution) Renew(Assignment) error { f.renewals.Add(1); return nil }
func (f *fakeExecution) Stop(ctx context.Context) error {
	f.stopped.Store(true)
	if f.stopHook != nil {
		return f.stopHook(ctx)
	}
	return nil
}
func hostAssignment() Assignment {
	return Assignment{SessionID: "session-1", RuntimeID: "host-1", RuntimeKind: "Cloud", Endpoint: "https://runtime.test", AssignmentEpoch: 1, PresentationRevision: 2, IssuedAt: time.Now().Add(-time.Minute), LeaseExpiresAt: time.Now().Add(2 * time.Minute)}
}
func receive[T any](t *testing.T, c <-chan T) T {
	t.Helper()
	select {
	case v := <-c:
		return v
	case <-time.After(3 * time.Second):
		t.Fatal("host boundary timed out")
		var zero T
		return zero
	}
}
func testSupervisor(cp *fakeControlPlane) Supervisor {
	return Supervisor{RuntimeID: "host-1", Endpoint: "https://runtime.test", BootID: "boot-1", BootStartedAt: time.Now(), Capacity: 2, Interval: time.Millisecond, ControlPlane: cp}
}
func TestSupervisorSessionsStartIndependentlyAndNeverReuseCrashedEpoch(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 32), responses: make(chan heartbeatResult, 32)}
	s := testSupervisor(cp)
	blocked := make(chan struct{})
	started := make(chan *fakeExecution, 8)
	var attempts atomic.Int32
	s.Start = func(ctx context.Context, a Assignment, _ <-chan Assignment) (Execution, error) {
		if a.SessionID == "session-1" {
			select {
			case <-blocked:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		attempts.Add(1)
		e := &fakeExecution{done: make(chan struct{})}
		started <- e
		return e, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	first := receive(t, cp.requests)
	if len(first.Sessions) != 0 || first.Capacity != 2 || first.Generation != 1 {
		t.Fatalf("registration: %+v", first)
	}
	a := hostAssignment()
	b := a
	b.SessionID = "session-2"
	assignments := []Assignment{a, b}
	cp.responses <- heartbeatResult{assignments: assignments}
	second := receive(t, started)
	var report Heartbeat
	for i := 0; i < 5; i++ {
		report = receive(t, cp.requests)
		if len(report.Sessions) == 2 && report.Sessions[1].State == "ready" {
			break
		}
		cp.responses <- heartbeatResult{assignments: assignments}
	}
	if len(report.Sessions) != 2 || report.Sessions[0].State != "starting" || report.Sessions[1].State != "ready" {
		t.Fatalf("blocked session stopped peer: %+v", report)
	}
	close(second.done)
	cp.responses <- heartbeatResult{assignments: assignments}
	for i := 0; i < 5; i++ {
		report = receive(t, cp.requests)
		if report.Sessions[1].State == "stopped" {
			break
		}
		cp.responses <- heartbeatResult{assignments: assignments}
	}
	if !second.revoked.Load() || report.Sessions[1].State != "stopped" {
		t.Fatal("failed execution did not confirm stop")
	}
	cp.responses <- heartbeatResult{assignments: assignments}
	receive(t, cp.requests)
	if attempts.Load() != 1 {
		t.Fatal("crashed epoch was reused")
	}
	close(blocked)
	cp.responses <- heartbeatResult{assignments: assignments}
	receive(t, started)
	receive(t, cp.requests)
	cancel()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
}
func TestSupervisorRejectsAssignmentsBeyondCapacity(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 8), responses: make(chan heartbeatResult, 8)}
	s := testSupervisor(cp)
	s.Capacity = 1
	s.Start = func(context.Context, Assignment, <-chan Assignment) (Execution, error) {
		t.Error("overcapacity assignment was started")
		return nil, errors.New("unexpected")
	}
	a := hostAssignment()
	b := a
	b.SessionID = "session-2"
	cp.responses <- heartbeatResult{assignments: []Assignment{a, b}}
	if err := s.Run(context.Background()); err == nil {
		t.Fatal("host accepted overcapacity assignments")
	}
}

func TestSupervisorLeaseExpiryStopsOnlyAffectedSession(t *testing.T) {
	base := time.Now()
	var clock atomic.Int64
	clock.Store(base.UnixNano())
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 32), responses: make(chan heartbeatResult, 32)}
	s := testSupervisor(cp)
	s.Clock = func() time.Time { return time.Unix(0, clock.Load()) }
	started := make(chan struct {
		id        string
		execution *fakeExecution
	}, 2)
	s.Start = func(_ context.Context, a Assignment, _ <-chan Assignment) (Execution, error) {
		e := &fakeExecution{done: make(chan struct{})}
		started <- struct {
			id        string
			execution *fakeExecution
		}{a.SessionID, e}
		return e, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	a := hostAssignment()
	a.LeaseExpiresAt = base.Add(time.Second)
	b := a
	b.SessionID = "session-2"
	b.LeaseExpiresAt = base.Add(time.Minute)
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignments: []Assignment{a, b}}
	executions := make(map[string]*fakeExecution)
	for i := 0; i < 2; i++ {
		v := receive(t, started)
		executions[v.id] = v.execution
	}
	receive(t, cp.requests)
	clock.Store(base.Add(2 * time.Second).UnixNano())
	cp.responses <- heartbeatResult{err: context.DeadlineExceeded}
	receive(t, cp.requests)
	if !executions[a.SessionID].revoked.Load() {
		t.Fatal("expired session authority remained active")
	}
	if executions[b.SessionID].revoked.Load() {
		t.Fatal("peer session was revoked by another session expiry")
	}
	cancel()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorUsesOneShutdownBudgetForAllSessions(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 16), responses: make(chan heartbeatResult, 16)}
	s := testSupervisor(cp)
	var shutdown context.Context
	var cancelShutdown context.CancelFunc
	s.ShutdownContext = func() context.Context {
		if shutdown == nil {
			shutdown, cancelShutdown = context.WithTimeout(context.Background(), 20*time.Millisecond)
		}
		return shutdown
	}
	defer func() {
		if cancelShutdown != nil {
			cancelShutdown()
		}
	}()
	stopped := make(chan time.Time, 2)
	started := make(chan struct{}, 2)
	s.Start = func(context.Context, Assignment, <-chan Assignment) (Execution, error) {
		e := &fakeExecution{done: make(chan struct{}), stopHook: func(ctx context.Context) error {
			deadline, _ := ctx.Deadline()
			stopped <- deadline
			<-ctx.Done()
			return ctx.Err()
		}}
		started <- struct{}{}
		return e, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	a := hostAssignment()
	b := a
	b.SessionID = "session-2"
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignments: []Assignment{a, b}}
	receive(t, started)
	receive(t, started)
	receive(t, cp.requests)
	cancel()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
	first, second := receive(t, stopped), receive(t, stopped)
	if !first.Equal(second) {
		t.Fatal("session shutdowns used independent budgets")
	}
}
