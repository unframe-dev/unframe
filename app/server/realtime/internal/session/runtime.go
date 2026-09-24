package session

import (
	"errors"
	"sync"
	"time"
)

var (
	ErrInvalidPauseReason = errors.New("runtime pause reason is invalid")
	ErrRuntimeNotPaused   = errors.New("runtime is not paused")
	ErrRuntimeTerminating = errors.New("runtime is terminating")
	ErrResumeUnauthorized = errors.New("runtime resume is not authorized")
)

type RuntimeStatus uint8

const (
	RuntimeStatusUnknown RuntimeStatus = iota
	RuntimeRunning
	RuntimePaused
	RuntimeTerminating
)

type PauseReason uint8

const (
	PauseNone PauseReason = iota
	PausePresenterDisconnected
	PauseLeaseExpired
	PauseProcessRecovered
)

type ResumeAuthorization struct {
	PresenterConnected     bool
	LeaseValid             bool
	ControlPlanePresenting bool
}

type RuntimeSnapshot struct {
	Status                   RuntimeStatus
	PauseReason              PauseReason
	PausedAt                 time.Time
	AccumulatedPauseDuration time.Duration
}

type Runtime struct {
	mu                       sync.Mutex
	clock                    func() time.Time
	status                   RuntimeStatus
	pauseReason              PauseReason
	pausedAt                 time.Time
	accumulatedPauseDuration time.Duration
}

func NewRuntime(clock func() time.Time) *Runtime {
	if clock == nil {
		clock = time.Now
	}
	return &Runtime{clock: clock, status: RuntimeRunning}
}

func (r *Runtime) Snapshot() RuntimeSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return RuntimeSnapshot{
		Status:                   r.status,
		PauseReason:              r.pauseReason,
		PausedAt:                 r.pausedAt,
		AccumulatedPauseDuration: r.accumulatedPauseDuration,
	}
}

func (r *Runtime) Pause(reason PauseReason) error {
	if reason == PauseNone {
		return ErrInvalidPauseReason
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == RuntimeTerminating {
		return ErrRuntimeTerminating
	}
	if r.status == RuntimePaused {
		return nil
	}
	r.status = RuntimePaused
	r.pauseReason = reason
	r.pausedAt = r.clock()
	return nil
}

func (r *Runtime) Resume(authorization ResumeAuthorization) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == RuntimeTerminating {
		return ErrRuntimeTerminating
	}
	if r.status != RuntimePaused {
		return ErrRuntimeNotPaused
	}
	if !authorization.PresenterConnected || !authorization.LeaseValid || !authorization.ControlPlanePresenting {
		return ErrResumeUnauthorized
	}
	now := r.clock()
	if now.After(r.pausedAt) {
		r.accumulatedPauseDuration += now.Sub(r.pausedAt)
	}
	r.status = RuntimeRunning
	r.pauseReason = PauseNone
	r.pausedAt = time.Time{}
	return nil
}

func (r *Runtime) Terminate() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == RuntimeTerminating {
		return nil
	}
	r.status = RuntimeTerminating
	return nil
}
