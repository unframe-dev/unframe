package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/host"
)

func main() {
	config, err := host.LoadConfig(os.Getenv)
	if err != nil {
		slog.Error("configure Runtime Host", "error", err)
		os.Exit(1)
	}
	client, err := config.HTTPClient()
	if err != nil {
		slog.Error("configure Runtime Host HTTPS", "error", err)
		os.Exit(1)
	}
	defer client.CloseIdleConnections()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := host.Run(ctx, config, client); err != nil {
		slog.Error("Runtime Host stopped", "error", err)
		os.Exit(1)
	}
}
