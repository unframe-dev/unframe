package host

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type heartbeatResult struct {
	assignment *Assignment
	err        error
}
type fakeControlPlane struct {
	requests  chan Heartbeat
	responses chan heartbeatResult
}

func (f *fakeControlPlane) Heartbeat(ctx context.Context, request Heartbeat) (*Assignment, error) {
	f.requests <- request
	if !request.Accepting {
		return nil, nil
	}
	select {
	case result := <-f.responses:
		return result.assignment, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type fakeChild struct {
	ready   atomic.Bool
	stopped atomic.Bool
	done    chan struct{}
}

func (f *fakeChild) Serving(context.Context) bool { return f.ready.Load() }
func (f *fakeChild) Done() <-chan struct{}        { return f.done }
func (f *fakeChild) Stop(context.Context) error   { f.stopped.Store(true); return nil }

func hostAssignment() *Assignment {
	return &Assignment{SessionID: "session-1", RuntimeID: "host-1", RuntimeKind: "Cloud", Endpoint: "https://runtime.test", AssignmentEpoch: 1, PresentationRevision: 2, IssuedAt: time.Now().Add(-time.Minute), LeaseExpiresAt: time.Now().Add(2 * time.Minute)}
}
func receive[T any](t *testing.T, channel <-chan T) T {
	t.Helper()
	select {
	case item := <-channel:
		return item
	case <-time.After(3 * time.Second):
		t.Fatal("host boundary operation timed out")
		var zero T
		return zero
	}
}
func TestSupervisorRegistersStartsReportsHealthAndReleases(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 16), responses: make(chan heartbeatResult, 16)}
	started := make(chan *fakeChild, 16)
	supervisor := Supervisor{RuntimeID: "host-1", Endpoint: "https://runtime.test", Interval: time.Millisecond, ControlPlane: cp, Start: func(_ Assignment) (Child, error) {
		child := &fakeChild{done: make(chan struct{})}
		started <- child
		return child, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() { finished <- supervisor.Run(ctx) }()
	first := receive(t, cp.requests)
	if !first.Accepting || first.Serving != nil {
		t.Fatalf("initial heartbeat was not an idle registration: %+v", first)
	}
	assignment := hostAssignment()
	cp.responses <- heartbeatResult{assignment: assignment}
	child := receive(t, started)
	next := receive(t, cp.requests)
	if next.Serving != nil {
		t.Fatal("unready child advertised as serving")
	}
	child.ready.Store(true)
	cp.responses <- heartbeatResult{assignment: assignment}
	next = receive(t, cp.requests)
	if next.Serving == nil || next.Serving.SessionID != assignment.SessionID || next.Serving.AssignmentEpoch != assignment.AssignmentEpoch {
		t.Fatalf("healthy assignment not advertised: %+v", next)
	}
	renewed := *assignment
	renewed.LeaseExpiresAt = renewed.LeaseExpiresAt.Add(time.Minute)
	cp.responses <- heartbeatResult{assignment: &renewed}
	receive(t, cp.requests)
	select {
	case <-started:
		t.Fatal("lease renewal restarted the child")
	default:
	}
	cp.responses <- heartbeatResult{}
	receive(t, cp.requests)
	if !child.stopped.Load() {
		t.Fatal("released assignment kept its child alive")
	}
	cancel()
	if err := receive(t, finished); err != nil {
		t.Fatal(err)
	}
	drain := receive(t, cp.requests)
	if drain.Accepting || drain.Serving != nil {
		t.Fatalf("shutdown renewed or advertised the host: %+v", drain)
	}
}
func TestSupervisorRestartsCrashedChildAndReplacesAssignment(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 16), responses: make(chan heartbeatResult, 16)}
	started := make(chan *fakeChild, 16)
	s := Supervisor{RuntimeID: "host-1", Endpoint: "https://runtime.test", Interval: time.Millisecond, ControlPlane: cp, Start: func(_ Assignment) (Child, error) {
		c := &fakeChild{done: make(chan struct{})}
		started <- c
		return c, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	a := hostAssignment()
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignment: a}
	first := receive(t, started)
	close(first.done)
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignment: a}
	second := receive(t, started)
	if !first.stopped.Load() {
		t.Fatal("crashed process group was not cleaned")
	}
	replacement := *a
	replacement.SessionID = "session-2"
	replacement.AssignmentEpoch = 2
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignment: &replacement}
	receive(t, started)
	if !second.stopped.Load() {
		t.Fatal("old assignment was not drained before replacement")
	}
	cancel()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
}
func TestSupervisorRejectsAssignmentForAnotherHost(t *testing.T) {
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 16), responses: make(chan heartbeatResult, 16)}
	s := Supervisor{RuntimeID: "host-1", Endpoint: "https://runtime.test", Interval: time.Millisecond, ControlPlane: cp, Start: func(Assignment) (Child, error) { t.Error("invalid assignment started a child"); return nil, nil }}
	a := hostAssignment()
	a.RuntimeID = "other-host"
	cp.responses <- heartbeatResult{assignment: a}
	if err := s.Run(context.Background()); err == nil {
		t.Fatal("another host assignment was accepted")
	}
}
func TestSupervisorStopsExpiredChildDuringOutageAndStartsFreshAfterRenewal(t *testing.T) {
	base := time.Now()
	var clock atomic.Int64
	clock.Store(base.UnixNano())
	cp := &fakeControlPlane{requests: make(chan Heartbeat, 16), responses: make(chan heartbeatResult, 16)}
	started := make(chan *fakeChild, 16)
	s := Supervisor{RuntimeID: "host-1", Endpoint: "https://runtime.test", Interval: time.Millisecond, Clock: func() time.Time { return time.Unix(0, clock.Load()) }, ControlPlane: cp, Start: func(Assignment) (Child, error) {
		c := &fakeChild{done: make(chan struct{})}
		started <- c
		return c, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	a := hostAssignment()
	a.LeaseExpiresAt = base.Add(time.Second)
	receive(t, cp.requests)
	cp.responses <- heartbeatResult{assignment: a}
	first := receive(t, started)
	receive(t, cp.requests)
	clock.Store(base.Add(2 * time.Second).UnixNano())
	cp.responses <- heartbeatResult{err: context.DeadlineExceeded}
	receive(t, cp.requests)
	if !first.stopped.Load() {
		t.Fatal("offline child outlived its assignment lease")
	}
	renewed := *a
	renewed.LeaseExpiresAt = base.Add(time.Minute)
	cp.responses <- heartbeatResult{assignment: &renewed}
	second := receive(t, started)
	if first == second {
		t.Fatal("renewal reused a process whose lease had expired")
	}
	cancel()
	if err := receive(t, done); err != nil {
		t.Fatal(err)
	}
}
