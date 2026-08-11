package grpc

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

func TestServerShutdownStopsServing(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := NewServer(listener)
	if err := server.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if err := server.Wait(); err != nil {
		t.Fatalf("wait: %v", err)
	}
}

func TestServerWaitReturnsServeFailure(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	server := NewServer(listener)
	if err := server.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := server.Wait(); err == nil {
		t.Fatal("Wait() error = nil, want Serve failure")
	}
}

func TestServerStartReturnsErrorWhenCalledTwice(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	server := NewServer(listener)
	if err := server.Start(); err != nil {
		t.Fatalf("first start: %v", err)
	}
	if err := server.Start(); !errors.Is(err, ErrServerStarted) {
		t.Fatalf("second start error = %v, want %v", err, ErrServerStarted)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
}

func TestServerShutdownBeforeStartSucceeds(t *testing.T) {
	t.Parallel()

	server := NewServer(nil)
	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown before start: %v", err)
	}
}

func TestNewServerRegistersRealtimeBidiService(t *testing.T) {
	t.Parallel()

	server := NewServer(nil)
	service, ok := server.GRPCServer().GetServiceInfo()["unframe.realtime.v1.RealtimeService"]
	if !ok {
		t.Fatal("RealtimeService is not registered")
	}
	if len(service.Methods) != 1 || service.Methods[0].Name != "Connect" || !service.Methods[0].IsClientStream || !service.Methods[0].IsServerStream {
		t.Errorf("registered methods = %#v, want one bidi Connect method", service.Methods)
	}
}
