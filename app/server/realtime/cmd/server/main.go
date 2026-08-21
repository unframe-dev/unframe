package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/observability"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
)

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

	listener, err := net.Listen("tcp", address)
	if err != nil {
		slog.Error("listen for realtime gRPC server", "address", address, "error", err)
		os.Exit(1)
	}
	metrics := &observability.Metrics{}
	dependencies := transportgrpc.Dependencies{
		Verifier: verifier, Guard: core.Assignments(), Coordinator: core.Coordinator(), Logger: slog.Default(), Metrics: metrics,
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
