package host

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/observability"
	persistence "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	transport "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Run owns one public listener for all sessions assigned to this Host boot.
func Run(ctx context.Context, config Config, client *http.Client) error {
	bootStartedAt := time.Now().UTC()
	listener, err := net.Listen("tcp", config.ListenAddr)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: config.Issuer, Audience: config.Audience, JWKSURL: config.JWKSURL, HTTPClient: client})
	if err != nil {
		return err
	}
	router := transport.NewSessionRouter()
	server, err := transport.NewServer(listener, transport.Dependencies{Verifier: verifier, Sessions: router, Logger: slog.Default(), Metrics: &observability.Metrics{}, BrowserOrigins: config.BrowserOrigins})
	if err != nil {
		return err
	}
	if err = server.Start(); err != nil {
		return err
	}
	var shutdownOnce sync.Once
	var shutdown context.Context
	var shutdownCancel context.CancelFunc
	shutdownContext := func() context.Context {
		shutdownOnce.Do(func() { shutdown, shutdownCancel = context.WithTimeout(context.Background(), 10*time.Second) })
		return shutdown
	}
	defer func() { _ = server.Shutdown(shutdownContext()); shutdownCancel() }()
	readiness, cancel := context.WithTimeout(ctx, 5*time.Second)
	err = verifier.Ready(readiness)
	cancel()
	if err != nil {
		return err
	}
	server.SetApplicationReady(true)
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return err
	}
	callbacks := persistence.NewClient(persistence.Config{BaseURL: config.ControlPlaneURL, ServiceIdentity: config.ServiceIdentity, HTTPClient: client})
	// This bound covers recovery, normal checkpoints and completion together.
	slots := make(chan struct{}, 4)
	supervisor := Supervisor{RuntimeID: config.RuntimeID, Endpoint: config.Endpoint, BootID: hex.EncodeToString(id[:]), BootStartedAt: bootStartedAt, Capacity: config.Capacity, Drain: config.Drain, ShutdownContext: shutdownContext, ControlPlane: HTTPControlPlane{Origin: config.ControlPlaneURL, RuntimeID: config.RuntimeID, ServiceIdentity: config.ServiceIdentity, Client: client}, Start: func(ctx context.Context, a Assignment, renewals <-chan Assignment) (Execution, error) {
		return startSession(ctx, a, renewals, router, callbacks, slots)
	}}
	runCtx, stop := context.WithCancel(ctx)
	defer stop()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		monitorHostReadiness(runCtx, ticker.C, verifier.Ready, server.SetApplicationReady)
	}()
	done := make(chan error, 1)
	go func() { done <- supervisor.Run(runCtx) }()
	served := make(chan error, 1)
	go func() { served <- server.Wait() }()
	select {
	case err := <-done:
		return err
	case err := <-served:
		stop()
		return errors.Join(err, <-done)
	}
}

type runtimeExecution struct {
	assignment Assignment
	guard      *assignment.AssignmentGuard
	runtime    *runtimecore.V2Session
	router     *transport.SessionRouter
	cancel     context.CancelFunc
	done       chan struct{}
}

func (e *runtimeExecution) Done() <-chan struct{} { return e.done }
func (e *runtimeExecution) Revoke() {
	e.guard.Revoke()
	e.router.Remove(e.assignment.SessionID)
	e.cancel()
}
func (e *runtimeExecution) Renew(a Assignment) error {
	current := e.guard.Assignment()
	current.LeaseExpiresAt = a.LeaseExpiresAt
	if !a.LeaseExpiresAt.After(e.guard.Assignment().LeaseExpiresAt) {
		return nil
	}
	err := e.guard.Renew(current)
	if errors.Is(err, assignment.ErrLeaseNotExtended) && !e.guard.Assignment().LeaseExpiresAt.Before(a.LeaseExpiresAt) {
		return nil
	}
	return err
}
func (e *runtimeExecution) Stop(ctx context.Context) error {
	e.Revoke()
	e.runtime.PauseLeaseExpired()
	select {
	case <-e.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	if err := e.runtime.FlushCheckpoint(ctx); err != nil {
		slog.Warn("session shutdown checkpoint unavailable", "sessionId", e.assignment.SessionID, "error", err)
	}
	return nil
}

type sessionWriter struct {
	client   *persistence.Client
	revision uint64
	guard    *assignment.AssignmentGuard
	slots    chan struct{}
	startup  context.Context
	ready    atomic.Bool
}

func (w *sessionWriter) write(ctx context.Context, send func(context.Context) error) error {
	if !w.ready.Load() {
		ctx = w.startup
	}
	backoff := 100 * time.Millisecond
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !time.Now().Before(w.guard.Assignment().LeaseExpiresAt) {
			return assignment.ErrLeaseExpired
		}
		select {
		case w.slots <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		err := send(ctx)
		<-w.slots
		if err == nil || w.ready.Load() {
			return err
		}
		var response *persistence.ResponseError
		if errors.As(err, &response) && response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
			return err
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if backoff < 5*time.Second {
			backoff *= 2
		}
	}
}
func (w *sessionWriter) WriteCheckpoint(ctx context.Context, envelope *realtime.DurableCheckpointEnvelope) error {
	return w.write(ctx, func(ctx context.Context) error {
		_, err := w.client.CheckpointEnvelope(ctx, envelope, w.revision)
		return err
	})
}
func (w *sessionWriter) CompleteCheckpoint(ctx context.Context, envelope *realtime.DurableCheckpointEnvelope, startedAt, endedAt string, participants []runtimecore.V2Participant) error {
	records := make([]persistence.Participant, 0, len(participants))
	for _, p := range participants {
		records = append(records, persistence.Participant{UserID: p.UserID, Role: p.Role})
	}
	return w.write(ctx, func(ctx context.Context) error {
		_, err := w.client.CompleteEnvelope(ctx, envelope, w.revision, startedAt, endedAt, records)
		return err
	})
}
func startSession(ctx context.Context, a Assignment, renewals <-chan Assignment, router *transport.SessionRouter, client *persistence.Client, slots chan struct{}) (Execution, error) {
	request := persistence.BootstrapRequest{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision}
	guard, err := assignment.NewAssignmentGuard(assignment.RuntimeAssignment{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, Endpoint: a.Endpoint, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision, IssuedAt: a.IssuedAt, LeaseExpiresAt: a.LeaseExpiresAt}, nil)
	if err != nil {
		return nil, err
	}
	updatesCtx, stopUpdates := context.WithCancel(ctx)
	initialized := false
	defer func() {
		if !initialized {
			stopUpdates()
		}
	}()
	go func() {
		for {
			select {
			case <-updatesCtx.Done():
				return
			case renewal := <-renewals:
				current := guard.Assignment()
				if renewal.LeaseExpiresAt.After(current.LeaseExpiresAt) {
					current.LeaseExpiresAt = renewal.LeaseExpiresAt
					if err := guard.Renew(current); err != nil {
						return
					}
				}
			}
		}
	}()
	bootstrap, err := client.Bootstrap(ctx, request)
	if err != nil {
		return nil, err
	}
	runtime, err := runtimecore.NewV2SessionWithBundle(bootstrap.Definition, bootstrap.RenderBundle)
	if err != nil {
		return nil, err
	}
	catalog, err := runtimecore.BuildV2CanonicalCatalogWithBundle(bootstrap.Definition, bootstrap.RenderBundle)
	if err != nil {
		return nil, err
	}
	metadata := &realtime.DurableCheckpointEnvelope{SchemaVersion: 3, SessionId: a.SessionID, RuntimeId: a.RuntimeID, RuntimeKind: realtime.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: a.AssignmentEpoch, Publication: &presentation.PublicationFence{PresentationId: bootstrap.Publication.PresentationID, PublicationEpoch: bootstrap.Publication.PublicationEpoch, PublicationManifestHash: bootstrap.Publication.PublicationManifestHash}, DefinitionHash: bootstrap.Publication.DefinitionHash, RenderBundleHash: bootstrap.Publication.RenderBundleHash}
	claim := assignment.AssignmentClaim{SessionID: a.SessionID, RuntimeID: a.RuntimeID, RuntimeKind: assignment.RuntimeKindCloud, AssignmentEpoch: a.AssignmentEpoch, PresentationRevision: a.PresentationRevision}
	writer := &sessionWriter{client: client, revision: a.PresentationRevision, guard: guard, slots: slots, startup: ctx}
	if err = runtime.ConfigureDurability(writer, metadata, catalog); err != nil {
		return nil, err
	}
	runtime.ConfigureCompletion(writer)
	runtime.ConfigureResumeValidation(func(ctx context.Context) error {
		if err := verifySessionLease(ctx, client, guard, request, bootstrap.Publication); err != nil {
			return err
		}
		return guard.AllowCommand(claim)
	})
	if len(bootstrap.Checkpoint) > 0 && string(bootstrap.Checkpoint) != "null" {
		envelope := new(realtime.DurableCheckpointEnvelope)
		if err = protojson.Unmarshal(bootstrap.Checkpoint, envelope); err != nil {
			return nil, err
		}
		if bootstrap.CheckpointSource == nil {
			return nil, errors.New("missing checkpoint source")
		}
		source := proto.Clone(metadata).(*realtime.DurableCheckpointEnvelope)
		source.RuntimeId = bootstrap.CheckpointSource.RuntimeID
		source.AssignmentEpoch = bootstrap.CheckpointSource.AssignmentEpoch
		source.CheckpointSequence = bootstrap.CheckpointSource.CheckpointSequence
		switch bootstrap.CheckpointSource.RuntimeKind {
		case assignment.RuntimeKindCloud:
			source.RuntimeKind = realtime.RuntimeKind_RUNTIME_KIND_CLOUD
		case assignment.RuntimeKindVenueEdge:
			source.RuntimeKind = realtime.RuntimeKind_RUNTIME_KIND_VENUE_EDGE
		default:
			return nil, errors.New("invalid checkpoint source runtime kind")
		}
		if err = runtime.RestoreCheckpointFromAssignmentContext(ctx, envelope, source); err != nil {
			return nil, err
		}
	} else if a.Recovery {
		if err = runtime.RecoverWithoutCheckpoint(ctx); err != nil {
			return nil, err
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err = guard.AllowNewConnection(claim); err != nil {
		return nil, err
	}
	service, err := transport.NewV2Service(runtime, bootstrap, client, auth.ContextIdentityResolver{}, guard)
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(ctx)
	e := &runtimeExecution{assignment: a, guard: guard, runtime: runtime, router: router, cancel: cancel, done: make(chan struct{})}
	initialized = true
	context.AfterFunc(lifetime, stopUpdates)
	writer.ready.Store(true)
	router.Register(a.SessionID, service)
	go e.run(lifetime, claim)
	go func() {
		if err := runtime.RunCheckpointWorker(lifetime, nil); err != nil && !errors.Is(err, context.Canceled) {
			slog.Warn("session checkpoint worker stopped", "sessionId", a.SessionID, "error", err)
			verification, cancel := context.WithTimeout(lifetime, 5*time.Second)
			verificationError := verifySessionLease(verification, client, guard, request, bootstrap.Publication)
			cancel()
			if errors.Is(guard.AllowCommand(claim), assignment.ErrInvalidAssignment) {
				e.Revoke()
			}
			if verificationError != nil {
				slog.Warn("verify assignment after checkpoint rejection", "sessionId", a.SessionID, "error", verificationError)
			}
		}
	}()
	return e, nil
}
func (e *runtimeExecution) run(ctx context.Context, claim assignment.AssignmentClaim) {
	defer close(e.done)
	defer e.Revoke()
	ticker := time.NewTicker(20 * time.Millisecond)
	nextObservation := time.Now()
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if !now.Before(nextObservation) {
				saved := e.runtime.CheckpointStatus()
				slog.Info("runtime checkpoint status", "sessionId", e.assignment.SessionID, "assignmentEpoch", e.assignment.AssignmentEpoch, "lastSuccess", saved.LastSuccess, "savedReliableSequence", saved.SavedReliableSequence, "currentReliableSequence", saved.CurrentReliableSequence, "failures", saved.Failures, "retrying", saved.Retrying, "inFlight", saved.InFlight, "pending", saved.Pending, "lastError", saved.LastError)
				nextObservation = now.Add(5 * time.Second)
			}
			if err := e.guard.AllowCommand(claim); err != nil {
				e.runtime.PauseLeaseExpired()
				return
			}
			if _, err := e.runtime.AdvanceFromWall(ctx, now); err != nil {
				slog.Warn("advance runtime session", "sessionId", e.assignment.SessionID, "error", fmt.Sprint(err))
			}
			if e.runtime.DurablyEnded() && e.runtime.Snapshot().Clock.GetTerminating().GetReason() == realtime.TerminationReason_TERMINATION_REASON_IDLE_TIMEOUT {
				return
			}
		}
	}
}

type sessionLeaseReader interface {
	Lease(context.Context, persistence.BootstrapRequest) (persistence.RuntimeLease, error)
}

func verifySessionLease(ctx context.Context, reader sessionLeaseReader, guard *assignment.AssignmentGuard, request persistence.BootstrapRequest, pin persistence.BootstrapPublication) error {
	lease, err := reader.Lease(ctx, request)
	if err != nil {
		var response *persistence.ResponseError
		if errors.Is(err, persistence.ErrInvalidBootstrap) || (errors.As(err, &response) && (response.StatusCode == 401 || response.StatusCode == 403 || response.StatusCode == 404 || response.StatusCode == 409 || response.StatusCode == 410)) {
			guard.Revoke()
		}
		return err
	}
	if lease.Publication != pin {
		guard.Revoke()
		return errors.New("runtime publication fence changed")
	}
	return nil
}

func monitorHostReadiness(ctx context.Context, checks <-chan time.Time, check func(context.Context) error, setReady func(bool)) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-checks:
			verification, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := check(verification)
			cancel()
			setReady(err == nil)
		}
	}
}
