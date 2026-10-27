// Package host supervises a manually started Cloud Runtime host and its assigned child.
package host

import (
	"context"
	"errors"
	"fmt"
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
}
type Serving struct {
	SessionID       string `json:"sessionId"`
	AssignmentEpoch uint64 `json:"assignmentEpoch"`
}
type Heartbeat struct {
	Endpoint  string   `json:"endpoint"`
	Accepting bool     `json:"accepting"`
	Serving   *Serving `json:"serving,omitempty"`
}
type ControlPlane interface {
	Heartbeat(context.Context, Heartbeat) (*Assignment, error)
}
type Child interface {
	Serving(context.Context) bool
	Done() <-chan struct{}
	Stop(context.Context) error
}
type Supervisor struct {
	RuntimeID    string
	Endpoint     string
	Interval     time.Duration
	Clock        func() time.Time
	ControlPlane ControlPlane
	Start        func(Assignment) (Child, error)
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
func (s Supervisor) Run(ctx context.Context) (result error) {
	if s.RuntimeID == "" || s.Endpoint == "" || s.ControlPlane == nil || s.Start == nil {
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
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var child Child
	var active *Assignment
	stopChild := func() error {
		if child == nil {
			return nil
		}
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err := child.Stop(shutdown)
		child = nil
		return err
	}
	defer func() {
		drain, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.ControlPlane.Heartbeat(drain, Heartbeat{Endpoint: s.Endpoint, Accepting: false})
		result = errors.Join(result, stopChild())
	}()
	for {
		if ctx.Err() != nil {
			return nil
		}
		if child != nil && active != nil && !active.LeaseExpiresAt.After(now()) {
			if err := stopChild(); err != nil {
				return err
			}
		}
		if child != nil {
			select {
			case <-child.Done():
				if err := stopChild(); err != nil {
					return err
				}
			default:
			}
		}
		request := Heartbeat{Endpoint: s.Endpoint, Accepting: true}
		if child != nil && active != nil {
			probe, cancel := context.WithTimeout(ctx, time.Second)
			ready := child.Serving(probe)
			cancel()
			if ready {
				request.Serving = &Serving{SessionID: active.SessionID, AssignmentEpoch: active.AssignmentEpoch}
			}
		}
		poll, cancel := context.WithTimeout(ctx, 5*time.Second)
		next, err := s.ControlPlane.Heartbeat(poll, request)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if child != nil && active != nil && !active.LeaseExpiresAt.After(now()) {
			if err := stopChild(); err != nil {
				return err
			}
		}
		if err != nil {
			var terminal *TerminalError
			if errors.As(err, &terminal) {
				return err
			}
		} else {
			if next != nil {
				if err := next.validate(s.RuntimeID, s.Endpoint); err != nil {
					return err
				}
			}
			if child != nil && (next == nil || active == nil || !sameAssignment(*active, *next)) {
				if err := stopChild(); err != nil {
					return err
				}
			}
			active = next
			if child == nil && next != nil {
				child, err = s.Start(*next)
				if err != nil {
					return fmt.Errorf("start assigned Runtime: %w", err)
				}
				if child == nil {
					return errors.New("runtime starter returned no child")
				}
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
