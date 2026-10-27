package e2e

import (
	"context"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	grpc "google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	health "google.golang.org/grpc/health/grpc_health_v1"
)

func (f *fixture) startRuntime() {
	f.t.Helper()
	log, err := os.OpenFile(filepath.Join(f.env.StateDirectory, "realtime.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		f.t.Fatal(err)
	}
	cmd := exec.CommandContext(f.ctx, f.env.RuntimeBinary)
	env := map[string]string{}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			env[key] = value
		}
	}
	for key, value := range f.env.RuntimeEnv {
		env[key] = value
	}
	for key, value := range env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		f.t.Fatal("start Runtime:", err)
	}
	f.run, f.runLog = cmd, log
	f.runError = nil
	done := make(chan struct{})
	f.runDone = done
	go func() { f.runError = cmd.Wait(); close(done) }()
	endpoint, _ := url.Parse(f.env.RuntimeEndpoint)
	connection, err := grpc.NewClient(endpoint.Host, grpc.WithTransportCredentials(credentials.NewTLS(f.tls.Clone())))
	if err != nil {
		f.t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := health.NewHealthClient(connection)
	f.wait("Runtime application readiness", func() bool {
		select {
		case <-done:
			f.t.Fatal("Runtime exited before application readiness; inspect private Runtime log")
		default:
		}
		ctx, cancel := context.WithTimeout(f.ctx, 500*time.Millisecond)
		defer cancel()
		response, err := client.Check(ctx, &health.HealthCheckRequest{})
		return err == nil && response.Status == health.HealthCheckResponse_SERVING
	})
}

func (f *fixture) stopRuntime() {
	if f.run == nil {
		return
	}
	cmd := f.run
	f.run = nil
	exitedBeforeStop := false
	select {
	case <-f.runDone:
		exitedBeforeStop = true
	default:
	}
	if !exitedBeforeStop {
		_ = cmd.Process.Kill()
	}
	<-f.runDone
	if exitedBeforeStop && f.ctx.Err() == nil {
		f.t.Errorf("Runtime exited unexpectedly; inspect private Runtime log: %v", f.runError)
	}
	_ = f.runLog.Close()
	f.runLog = nil
	data, err := os.ReadFile(filepath.Join(f.env.StateDirectory, "realtime.log"))
	if err != nil {
		f.t.Error("read Runtime race evidence:", err)
		return
	}
	if strings.Contains(string(data), "WARNING: DATA RACE") {
		f.t.Error("Runtime race detector reported a data race; inspect private Runtime log")
	}
}

func (f *fixture) waitRuntimeNotServing() {
	f.t.Helper()
	endpoint, _ := url.Parse(f.env.RuntimeEndpoint)
	connection, err := grpc.NewClient(endpoint.Host, grpc.WithTransportCredentials(credentials.NewTLS(f.tls.Clone())))
	if err != nil {
		f.t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	client := health.NewHealthClient(connection)
	f.wait("Session end propagates to Runtime readiness", func() bool {
		ctx, cancel := context.WithTimeout(f.ctx, 500*time.Millisecond)
		defer cancel()
		response, err := client.Check(ctx, &health.HealthCheckRequest{})
		return err == nil && response.Status == health.HealthCheckResponse_NOT_SERVING
	})
}
