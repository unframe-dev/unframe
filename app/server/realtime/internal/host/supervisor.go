// Package host manages independent session executions in one Cloud Runtime process.
package host

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

type Assignment struct {
	SessionID              string    `json:"sessionId"`
	RuntimeID              string    `json:"runtimeId"`
	RuntimeKind            string    `json:"runtimeKind"`
	Endpoint               string    `json:"endpoint"`
	AssignmentEpoch        uint64    `json:"assignmentEpoch"`
	PresentationRevision   uint64    `json:"presentationRevision"`
	IssuedAt               time.Time `json:"issuedAt"`
	LeaseExpiresAt         time.Time `json:"leaseExpiresAt"`
	CertificateFingerprint *string   `json:"certificateFingerprint"`
	ProvisioningEdgeID     *string   `json:"provisioningEdgeId"`
	ReleasedAt             *string   `json:"releasedAt"`
	Recovery               bool      `json:"recovery"`
}
type Serving struct {
	SessionID       string `json:"sessionId"`
	AssignmentEpoch uint64 `json:"assignmentEpoch"`
	State           string `json:"state"`
}
type Registration struct {
	Endpoint      string    `json:"endpoint"`
	BootID        string    `json:"bootId"`
	BootStartedAt time.Time `json:"bootStartedAt"`
	Capacity      int       `json:"capacity"`
	Accepting     bool      `json:"accepting"`
}
type Heartbeat struct {
	Endpoint   string    `json:"endpoint"`
	BootID     string    `json:"bootId"`
	Generation uint64    `json:"generation"`
	Capacity   int       `json:"capacity"`
	Accepting  bool      `json:"accepting"`
	Sessions   []Serving `json:"sessions"`
}
type HeartbeatResponse struct {
	Generation  uint64       `json:"generation"`
	Assignments []Assignment `json:"assignments"`
}
type ControlPlane interface {
	Start(context.Context, Registration) (uint64, error)
	Heartbeat(context.Context, Heartbeat) (HeartbeatResponse, error)
}
type Execution interface {
	Done() <-chan struct{}
	Revoke()
	Renew(Assignment) error
	Stop(context.Context) error
}
type Supervisor struct {
	RuntimeID       string
	Endpoint        string
	BootID          string
	BootStartedAt   time.Time
	Capacity        int
	Drain           bool
	Interval        time.Duration
	Clock           func() time.Time
	ShutdownContext func() context.Context
	ControlPlane    ControlPlane
	Start           func(context.Context, Assignment, <-chan Assignment) (Execution, error)
}
type executionResult struct {
	execution Execution
	err       error
}
type managedSession struct {
	assignment    Assignment
	execution     Execution
	cancel        context.CancelFunc
	starting      <-chan executionResult
	stopping      <-chan error
	state         string
	stopRequested bool
	stopError     error
	renewals      chan Assignment
}

func (a Assignment) validate(runtimeID, endpoint string) error {
	if a.SessionID == "" || a.RuntimeID != runtimeID || a.RuntimeKind != "Cloud" || a.Endpoint != endpoint || a.AssignmentEpoch == 0 || a.PresentationRevision == 0 || a.IssuedAt.IsZero() || !a.LeaseExpiresAt.After(time.Now()) || !a.LeaseExpiresAt.After(a.IssuedAt) || a.ReleasedAt != nil || a.CertificateFingerprint != nil || a.ProvisioningEdgeID != nil {
		return errors.New("control plane returned an invalid host assignment")
	}
	return nil
}
func sameAssignment(a, b Assignment) bool {
	return a.SessionID == b.SessionID && a.RuntimeID == b.RuntimeID && a.RuntimeKind == b.RuntimeKind && a.Endpoint == b.Endpoint && a.AssignmentEpoch == b.AssignmentEpoch && a.PresentationRevision == b.PresentationRevision && a.IssuedAt.Equal(b.IssuedAt)
}
func stopExecution(execution Execution, shutdown ...context.Context) <-chan error {
	execution.Revoke()
	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if len(shutdown) > 0 {
			ctx = shutdown[0]
		}
		done <- execution.Stop(ctx)
	}()
	return done
}
func (m *managedSession) stop(shutdown ...context.Context) {
	m.stopRequested = true
	if m.starting != nil {
		m.state = "stopping"
	}
	if m.cancel != nil {
		m.cancel()
	}
	if m.execution != nil && m.stopping == nil {
		m.stopping = stopExecution(m.execution, shutdown...)
		m.state = "stopping"
	}
}
func (m *managedSession) poll() {
	if m.starting != nil {
		select {
		case result := <-m.starting:
			m.starting = nil
			m.execution = result.execution
			if result.err != nil || result.execution == nil {
				if result.execution != nil {
					m.stop()
				} else {
					m.state = "stopped"
				}
			} else {
				m.state = "ready"
				if m.stopRequested {
					m.stop()
				}
			}
		default:
		}
	}
	if m.execution != nil && m.stopping == nil {
		select {
		case <-m.execution.Done():
			m.stop()
		default:
		}
	}
	if m.stopping != nil {
		select {
		case err := <-m.stopping:
			m.stopError = err
			m.stopping = nil
			m.execution = nil
			if err == nil {
				m.state = "stopped"
			} else {
				m.state = "failed"
			}
		default:
		}
	}
}
func (s Supervisor) Run(ctx context.Context) (runError error) {
	if s.RuntimeID == "" || s.Endpoint == "" || s.BootID == "" || s.BootStartedAt.IsZero() || s.Capacity < 1 || s.Capacity > 256 || s.ControlPlane == nil || s.Start == nil {
		return errors.New("runtime host supervisor is not configured")
	}
	interval := s.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	now := s.Clock
	if now == nil {
		now = time.Now
	}
	registration := Registration{Endpoint: s.Endpoint, BootID: s.BootID, BootStartedAt: s.BootStartedAt, Capacity: s.Capacity, Accepting: !s.Drain}
	var generation uint64
	for generation == 0 {
		poll, cancel := context.WithTimeout(ctx, 5*time.Second)
		value, err := s.ControlPlane.Start(poll, registration)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if err == nil {
			if value == 0 {
				return errors.New("invalid host generation")
			}
			generation = value
			break
		}
		var terminal *TerminalError
		if errors.As(err, &terminal) {
			return err
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	sessions := make(map[string]*managedSession)
	request := func(accepting bool) Heartbeat {
		report := Heartbeat{Endpoint: s.Endpoint, BootID: s.BootID, Generation: generation, Capacity: s.Capacity, Accepting: accepting, Sessions: make([]Serving, 0, len(sessions))}
		for id, m := range sessions {
			m.poll()
			report.Sessions = append(report.Sessions, Serving{SessionID: id, AssignmentEpoch: m.assignment.AssignmentEpoch, State: m.state})
		}
		sort.Slice(report.Sessions, func(i, j int) bool { return report.Sessions[i].SessionID < report.Sessions[j].SessionID })
		return report
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if s.ShutdownContext != nil {
			shutdown = s.ShutdownContext()
		}
		for _, m := range sessions {
			m.stop(shutdown)
		}
		_, _ = s.ControlPlane.Heartbeat(shutdown, request(false))
		for id, m := range sessions {
			if m.stopError != nil {
				runError = errors.Join(runError, fmt.Errorf("stop room %s: %w", id, m.stopError))
			}
			if m.starting != nil {
				select {
				case result := <-m.starting:
					if result.execution != nil {
						m.stopping = stopExecution(result.execution, shutdown)
					}
				case <-shutdown.Done():
					runError = errors.Join(runError, shutdown.Err())
					return
				}
			}
			if m.stopping != nil {
				select {
				case err := <-m.stopping:
					if err != nil {
						runError = errors.Join(runError, fmt.Errorf("stop room %s: %w", id, err))
					}
				case <-shutdown.Done():
					runError = errors.Join(runError, shutdown.Err())
					return
				}
			}
		}
	}()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return nil
		}
		for _, m := range sessions {
			m.poll()
			if !m.assignment.LeaseExpiresAt.After(now()) {
				m.stop()
			}
		}
		poll, cancel := context.WithTimeout(ctx, 5*time.Second)
		response, err := s.ControlPlane.Heartbeat(poll, request(!s.Drain))
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		for _, m := range sessions {
			if !m.assignment.LeaseExpiresAt.After(now()) {
				m.stop()
			}
		}
		if err != nil {
			var terminal *TerminalError
			if errors.As(err, &terminal) {
				return err
			}
		} else {
			if response.Generation != generation || len(response.Assignments) > s.Capacity {
				return errors.New("invalid host assignment generation or capacity")
			}
			next := make(map[string]Assignment, len(response.Assignments))
			for _, a := range response.Assignments {
				if err := a.validate(s.RuntimeID, s.Endpoint); err != nil {
					return err
				}
				if _, found := next[a.SessionID]; found {
					return errors.New("duplicate host assignment")
				}
				next[a.SessionID] = a
			}
			for id, m := range sessions {
				a, found := next[id]
				if !found || !sameAssignment(m.assignment, a) {
					m.stop()
					m.poll()
					if m.starting == nil && m.execution == nil && m.stopping == nil {
						delete(sessions, id)
					}
				} else {
					if m.execution != nil && m.stopping == nil && a.LeaseExpiresAt.After(m.assignment.LeaseExpiresAt) {
						if err := m.execution.Renew(a); err != nil {
							m.stop()
						}
					}
					if a.LeaseExpiresAt.After(m.assignment.LeaseExpiresAt) && m.renewals != nil && m.starting != nil {
						select {
						case m.renewals <- a:
						default:
							select {
							case <-m.renewals:
							default:
							}
							m.renewals <- a
						}
					}
					m.assignment = a
				}
			}
			for id, a := range next {
				if _, found := sessions[id]; found {
					continue
				}
				startCtx, startCancel := context.WithCancel(ctx)
				ready := make(chan executionResult, 1)
				renewals := make(chan Assignment, 1)
				state := "starting"
				if a.Recovery {
					state = "recovering"
				}
				sessions[id] = &managedSession{assignment: a, cancel: startCancel, starting: ready, state: state, renewals: renewals}
				go func() { execution, err := s.Start(startCtx, a, renewals); ready <- executionResult{execution, err} }()
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
