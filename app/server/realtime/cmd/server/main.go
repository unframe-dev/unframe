package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/observability"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	"google.golang.org/protobuf/encoding/protojson"
)

type v2CheckpointCallback struct {
	client   *persistencehttp.Client
	revision uint64
}

type runtimeBootstrapReader interface {
	Bootstrap(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error)
}

func loadV2Bootstrap(ctx context.Context, reader runtimeBootstrapReader, guard *assignment.AssignmentGuard, request persistencehttp.BootstrapRequest) (persistencehttp.RuntimeBootstrap, error) {
	value, err := reader.Bootstrap(ctx, request)
	if err != nil {
		return persistencehttp.RuntimeBootstrap{}, err
	}
	if err := applyV2Lease(guard, value.Assignment); err != nil {
		return persistencehttp.RuntimeBootstrap{}, err
	}
	return value, nil
}

type runtimeLeaseReader interface {
	Lease(context.Context, persistencehttp.BootstrapRequest) (persistencehttp.RuntimeLease, error)
}

func refreshV2Lease(ctx context.Context, reader runtimeLeaseReader, guard *assignment.AssignmentGuard, request persistencehttp.BootstrapRequest, pin persistencehttp.BootstrapPublication) error {
	value, err := reader.Lease(ctx, request)
	if err != nil {
		return err
	}
	if value.Publication != pin {
		return fmt.Errorf("runtime publication fence changed")
	}
	return applyV2Lease(guard, value.Assignment)
}

func applyV2Lease(guard *assignment.AssignmentGuard, value persistencehttp.BootstrapAssignment) error {
	current := guard.Assignment()
	if value.SessionID != current.SessionID || value.RuntimeID != current.RuntimeID || value.RuntimeKind != current.RuntimeKind || value.AssignmentEpoch != current.AssignmentEpoch || value.PresentationRevision != current.PresentationRevision {
		return fmt.Errorf("runtime assignment fence changed")
	}
	if value.LeaseExpiresAt.After(current.LeaseExpiresAt) {
		renewal := current
		renewal.LeaseExpiresAt = value.LeaseExpiresAt
		return guard.Renew(renewal)
	}
	return nil
}

func (w v2CheckpointCallback) WriteCheckpoint(ctx context.Context, envelope *realtimev2.DurableCheckpointEnvelope) error {
	_, err := w.client.CheckpointEnvelope(ctx, envelope, w.revision)
	return err
}

func (w v2CheckpointCallback) CompleteCheckpoint(ctx context.Context, envelope *realtimev2.DurableCheckpointEnvelope, startedAt, endedAt string, participants []runtimecore.V2Participant) error {
	materialized := make([]persistencehttp.Participant, 0, len(participants))
	for _, participant := range participants {
		materialized = append(materialized, persistencehttp.Participant{UserID: participant.UserID, Role: participant.Role})
	}
	_, err := w.client.CompleteEnvelope(ctx, envelope, w.revision, startedAt, endedAt, materialized)
	return err
}

const defaultListenAddress = ":9090"

const (
	readinessCheckInterval = time.Second
	readinessCheckTimeout  = 5 * time.Second
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	address := os.Getenv("REALTIME_LISTEN_ADDR")
	if address == "" {
		address = defaultListenAddress
	}
	config, err := loadConfig(os.Getenv)
	if err != nil {
		slog.Error("load realtime server configuration", "error", err)
		os.Exit(1)
	}
	verifier, err := auth.NewBearerTokenVerifier(auth.BearerTokenVerifierConfig{Issuer: config.issuer, Audience: config.audience, JWKSURL: config.jwksURL})
	if err != nil {
		slog.Error("create realtime token verifier", "error", err)
		os.Exit(1)
	}
	guard, err := assignment.NewAssignmentGuard(config.assignment, nil)
	if err != nil {
		slog.Error("create realtime assignment guard", "error", err)
		os.Exit(1)
	}
	core, err := runtimecore.New(guard)
	if err != nil {
		slog.Error("create realtime runtime core", "error", err)
		os.Exit(1)
	}
	persistence := persistencehttp.NewClient(persistencehttp.Config{BaseURL: config.controlPlaneURL, ServiceIdentity: config.serviceIdentity})
	bootstrapRequest := persistencehttp.BootstrapRequest{SessionID: config.assignment.SessionID, RuntimeID: config.assignment.RuntimeID, RuntimeKind: config.assignment.RuntimeKind, AssignmentEpoch: config.assignment.AssignmentEpoch, PresentationRevision: config.assignment.PresentationRevision}
	bootstrap, err := loadV2Bootstrap(ctx, persistence, guard, bootstrapRequest)
	if err != nil {
		slog.Error("load verified runtime bootstrap", "error", err)
		os.Exit(1)
	}
	v2Runtime, err := runtimecore.NewV2SessionWithBundle(bootstrap.Definition, bootstrap.RenderBundle)
	if err != nil {
		slog.Error("create v2 runtime session", "error", err)
		os.Exit(1)
	}
	catalog, err := runtimecore.BuildV2CanonicalCatalogWithBundle(bootstrap.Definition, bootstrap.RenderBundle)
	if err != nil {
		slog.Error("build canonical runtime catalog", "error", err)
		os.Exit(1)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: bootstrap.Assignment.SessionID, RuntimeId: bootstrap.Assignment.RuntimeID, AssignmentEpoch: bootstrap.Assignment.AssignmentEpoch, Publication: &presentationv2.PublicationFence{PresentationId: bootstrap.Publication.PresentationID, PublicationEpoch: bootstrap.Publication.PublicationEpoch, PublicationManifestHash: bootstrap.Publication.PublicationManifestHash}, DefinitionHash: bootstrap.Publication.DefinitionHash, RenderBundleHash: bootstrap.Publication.RenderBundleHash}
	switch bootstrap.Assignment.RuntimeKind {
	case assignment.RuntimeKindCloud:
		metadata.RuntimeKind = realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD
	case assignment.RuntimeKindVenueEdge:
		metadata.RuntimeKind = realtimev2.RuntimeKind_RUNTIME_KIND_VENUE_EDGE
	default:
		slog.Error("invalid runtime kind")
		os.Exit(1)
	}
	if err := v2Runtime.ConfigureDurability(v2CheckpointCallback{client: persistence, revision: bootstrap.Assignment.PresentationRevision}, metadata, catalog); err != nil {
		slog.Error("configure v2 durability", "error", err)
		os.Exit(1)
	}
	v2Runtime.ConfigureCompletion(v2CheckpointCallback{client: persistence, revision: bootstrap.Assignment.PresentationRevision})
	claim := assignment.AssignmentClaim{SessionID: config.assignment.SessionID, RuntimeID: config.assignment.RuntimeID, RuntimeKind: config.assignment.RuntimeKind, AssignmentEpoch: config.assignment.AssignmentEpoch, PresentationRevision: config.assignment.PresentationRevision}
	v2Runtime.ConfigureResumeValidation(func(ctx context.Context) error {
		if err := refreshV2Lease(ctx, persistence, guard, bootstrapRequest, bootstrap.Publication); err != nil {
			return err
		}
		return guard.AllowCommand(claim)
	})
	if len(bootstrap.Checkpoint) != 0 && string(bootstrap.Checkpoint) != "null" {
		envelope := &realtimev2.DurableCheckpointEnvelope{}
		if err := protojson.Unmarshal(bootstrap.Checkpoint, envelope); err != nil {
			slog.Error("parse durable checkpoint", "error", err)
			os.Exit(1)
		}
		if err := v2Runtime.RestoreCheckpoint(envelope); err != nil {
			slog.Error("restore durable checkpoint", "error", err)
			os.Exit(1)
		}
	}
	v2Service, err := transportgrpc.NewV2Service(v2Runtime, bootstrap, persistence, auth.ContextIdentityResolver{}, guard)
	if err != nil {
		slog.Error("create v2 realtime service", "error", err)
		os.Exit(1)
	}
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
				if err := guard.AllowCommand(claim); err != nil {
					if errors.Is(err, assignment.ErrLeaseExpired) {
						v2Runtime.PauseLeaseExpired()
					}
					continue
				}
				if _, err := v2Runtime.AdvanceFromWall(ctx, now); err != nil {
					slog.Error("advance v2 runtime clock", "error", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				refreshCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				if err := refreshV2Lease(refreshCtx, persistence, guard, bootstrapRequest, bootstrap.Publication); err != nil {
					slog.Warn("refresh realtime lease", "error", err)
				}
				cancel()
			case <-ctx.Done():
				return
			}
		}
	}()

	listener, err := net.Listen("tcp", address)
	if err != nil {
		slog.Error("listen for realtime gRPC server", "address", address, "error", err)
		os.Exit(1)
	}
	metrics := &observability.Metrics{}
	dependencies := transportgrpc.Dependencies{
		Verifier: verifier, Guard: core.Assignments(), Coordinator: core.Coordinator(), V2: v2Service, Logger: slog.Default(), Metrics: metrics,
	}
	readiness := func(ctx context.Context) error {
		if err := core.Ready(); err != nil {
			return err
		}
		return verifier.Ready(ctx)
	}
	if err := run(ctx, listener, dependencies, readiness); err != nil {
		slog.Error("realtime gRPC server stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, listener net.Listener, dependencies transportgrpc.Dependencies, readiness func(context.Context) error) error {
	if readiness == nil {
		return fmt.Errorf("application readiness check is required")
	}
	server, err := transportgrpc.NewServer(listener, dependencies)
	if err != nil {
		return err
	}
	if err := server.Start(); err != nil {
		return err
	}
	if err := checkApplicationReadiness(ctx, readinessCheckTimeout, readiness); err != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return fmt.Errorf("realtime application is not ready: %w", err)
	}
	server.SetApplicationReady(true)
	slog.Info("realtime gRPC server listening", "address", listener.Addr().String())
	readinessTicker := time.NewTicker(readinessCheckInterval)
	defer readinessTicker.Stop()
	monitorContext, stopMonitoring := context.WithCancel(ctx)
	defer stopMonitoring()
	go monitorApplicationReadiness(monitorContext, readinessTicker.C, readinessCheckTimeout, readiness, server.SetApplicationReady)

	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.Wait()
	}()

	select {
	case err := <-serveResult:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func checkApplicationReadiness(ctx context.Context, timeout time.Duration, readiness func(context.Context) error) error {
	checkContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return readiness(checkContext)
}

func monitorApplicationReadiness(ctx context.Context, checks <-chan time.Time, timeout time.Duration, readiness func(context.Context) error, publish func(bool)) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-checks:
			publish(checkApplicationReadiness(ctx, timeout, readiness) == nil)
		}
	}
}
