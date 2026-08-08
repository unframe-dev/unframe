package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
)

const defaultListenAddress = ":9090"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	address := os.Getenv("REALTIME_LISTEN_ADDR")
	if address == "" {
		address = defaultListenAddress
	}

	listener, err := net.Listen("tcp", address)
	if err != nil {
		slog.Error("listen for realtime gRPC server", "address", address, "error", err)
		os.Exit(1)
	}
	if err := run(ctx, listener); err != nil {
		slog.Error("realtime gRPC server stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, listener net.Listener) error {
	server := transportgrpc.NewServer(listener)
	if err := server.Start(); err != nil {
		return err
	}
	slog.Info("realtime gRPC server listening", "address", listener.Addr().String())

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
