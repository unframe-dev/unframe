package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"github.com/coder/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
)

func TestVenueEdgeMultiplexesHTTPSAssetsAndGRPCHealth(t *testing.T) {
	fixture := httptest.NewTLSServer(http.NotFoundHandler())
	cert := fixture.TLS.Certificates[0]
	fixture.Close()
	directory := t.TempDir()
	certPath, keyPath := filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]}), 0600); err != nil {
		t.Fatal(err)
	}
	key, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VENUE_EDGE_TLS_CERT_FILE", certPath)
	t.Setenv("VENUE_EDGE_TLS_KEY_FILE", keyPath)
	t.Setenv("VENUE_EDGE_CACHE_DIR", filepath.Join(directory, "cache"))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	deps := testDependencies(t)
	deps.BrowserOrigins = []string{"https://audience.example"}
	value := deps.Guard.Assignment()
	value.RuntimeKind = assignment.RuntimeKindVenueEdge
	value.Endpoint = "https://" + listener.Addr().String()
	deps.Guard, err = assignment.NewAssignmentGuard(value, nil)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(fixture.Certificate())
	tlsConfig := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- runVenueEdge(ctx, listener, deps, func(context.Context) error { return nil }, nil, persistencehttp.BootstrapPublication{}, http.DefaultClient)
	}()
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: tlsConfig}, Timeout: 5 * time.Second}
	response, err := client.Get(value.Endpoint + "/sessions/session-1/assets/image")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("unsigned HTTPS asset request: %d", response.StatusCode)
	}
	connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	checkCtx, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	health, err := healthv1.NewHealthClient(connection).Check(checkCtx, &healthv1.HealthCheckRequest{})
	if err != nil || health.GetStatus() != healthv1.HealthCheckResponse_SERVING {
		t.Fatalf("TLS HTTP2 health=%v err=%v", health, err)
	}
	browserConnections := []*websocket.Conn{}
	for _, path := range []string{"/browser/control", "/browser/state"} {
		connection, _, err := websocket.Dial(checkCtx, "wss"+strings.TrimPrefix(value.Endpoint, "https")+path, &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Origin": []string{"https://audience.example"}}, Subprotocols: []string{"unframe.realtime.v3"}})
		if err != nil {
			t.Fatalf("Venue Edge browser route %s: %v", path, err)
		}
		defer func() { _ = connection.CloseNow() }()
		browserConnections = append(browserConnections, connection)
	}
	cancel()
	for _, connection := range browserConnections {
		readCtx, stop := context.WithTimeout(context.Background(), time.Second)
		_, _, err := connection.Read(readCtx)
		timedOut := readCtx.Err() != nil
		stop()
		if err == nil || timedOut {
			t.Fatalf("browser connection remained open after shutdown: %v", err)
		}
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Venue Edge shutdown timed out")
	}
}
