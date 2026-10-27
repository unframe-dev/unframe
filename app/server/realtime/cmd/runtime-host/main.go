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
	supervisor := host.Supervisor{RuntimeID: config.RuntimeID, Endpoint: config.Endpoint, ControlPlane: host.HTTPControlPlane{Origin: config.ControlPlaneURL, RuntimeID: config.RuntimeID, ServiceIdentity: config.ServiceIdentity, Client: client}, Start: host.ProcessStarter(config)}
	if err := supervisor.Run(ctx); err != nil {
		slog.Error("Runtime Host stopped", "error", err)
		os.Exit(1)
	}
}
