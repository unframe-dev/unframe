package main

import (
	"context"
	"github.com/coder/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"

	"testing"
)

func TestFindDeploymentPIDRequiresOneOwnedExactExecutable(t *testing.T) {
	const executable = "/private/Runtime Host/release/runtime-host"
	for _, test := range []struct {
		name, input string
		want        int
		bad         bool
	}{
		{"one", " 123 501 /private/Runtime Host/release/runtime-host\n 124 502 /private/Runtime Host/release/runtime-host\n", 123, false},
		{"none", "123 501 /other/runtime-host\n", 0, true},
		{"duplicate", "123 501 /private/Runtime Host/release/runtime-host\n124 501 /private/Runtime Host/release/runtime-host\n", 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := findDeploymentPID(test.input, 501, executable)
			if (err != nil) != test.bad || got != test.want {
				t.Fatalf("pid=%d err=%v", got, err)
			}
		})
	}
}

func TestHealthChecksActualGRPCServingState(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	service := health.NewServer()
	healthpb.RegisterHealthServer(server, service)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = grpcHealth(ctx, listener.Addr().String(), insecure.NewCredentials()); err != nil {
		t.Fatal(err)
	}
	service.SetServingStatus("", healthpb.HealthCheckResponse_NOT_SERVING)
	if err = grpcHealth(ctx, listener.Addr().String(), insecure.NewCredentials()); err == nil {
		t.Fatal("accepted non-serving host")
	}
}

func TestBrowserHealthRequiresBothUpgradePathsAndProtocol(t *testing.T) {
	var paths []string
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "https://audience.example" {
			http.Error(w, "origin", http.StatusForbidden)
			return
		}
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"unframe.realtime.v3"}, OriginPatterns: []string{"audience.example"}})
		if err != nil {
			return
		}
		defer func() { _ = conn.CloseNow() }()
		_, _, _ = conn.Read(r.Context())
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := browserHealth(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), "https://audience.example"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(paths, []string{"/browser/control", "/browser/state"}) {
		t.Fatalf("upgraded paths=%v", paths)
	}
}

func TestRollbackHealthAllowsHostWithoutStatusWhileNormalHealthRejectsIt(t *testing.T) {
	directory := t.TempDir()
	if err := validateHealthStatus(directory, os.Getpid(), true); err != nil {
		t.Fatal(err)
	}
	if err := validateHealthStatus(directory, os.Getpid(), false); err == nil {
		t.Fatal("normal health accepted a host without heartbeat status")
	}
}
