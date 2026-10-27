package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assetgateway"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	persistencehttp "github.com/unframe-dev/unframe/app/server/realtime/internal/persistence/http"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	transportgrpc "github.com/unframe-dev/unframe/app/server/realtime/internal/transport/grpc"
	"golang.org/x/net/http2"
)

func runVenueEdge(ctx context.Context, listener net.Listener, deps transportgrpc.Dependencies, readiness func(context.Context) error, client *persistencehttp.Client, pin persistencehttp.BootstrapPublication, originClient *http.Client) error {
	certificatePath, keyPath, directory := os.Getenv("VENUE_EDGE_TLS_CERT_FILE"), os.Getenv("VENUE_EDGE_TLS_KEY_FILE"), os.Getenv("VENUE_EDGE_CACHE_DIR")
	if certificatePath == "" || keyPath == "" || directory == "" {
		return fmt.Errorf("venue edge TLS certificate, key, and cache directory are required")
	}
	certificate, err := tls.LoadX509KeyPair(certificatePath, keyPath)
	if err != nil {
		return fmt.Errorf("load Venue Edge TLS certificate: %w", err)
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return err
	}
	if time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return fmt.Errorf("venue edge certificate is outside its validity period")
	}
	endpoint, err := url.Parse(deps.Guard.Assignment().Endpoint)
	if err != nil {
		return err
	}
	if err = leaf.VerifyHostname(endpoint.Hostname()); err != nil {
		return fmt.Errorf("venue edge certificate SAN does not match registered endpoint: %w", err)
	}
	slog.Info("venue TLS certificate loaded", "fingerprint", fmt.Sprintf("sha256:%x", sha256.Sum256(leaf.Raw)), "expires_at", leaf.NotAfter)
	gateway := assetgateway.New(deps.Verifier, func(ctx context.Context, id session.Identity, assetID string) (assetgateway.Asset, error) {
		if id.RuntimeKind != assignment.RuntimeKindVenueEdge {
			return assetgateway.Asset{}, fmt.Errorf("venue edge identity required")
		}
		claim := assignment.AssignmentClaim{SessionID: id.SessionID, RuntimeID: id.RuntimeID, RuntimeKind: id.RuntimeKind, AssignmentEpoch: id.AssignmentEpoch, PresentationRevision: id.PresentationRevision}
		if err := deps.Guard.ValidateCurrent(claim); err != nil {
			return assetgateway.Asset{}, err
		}
		return client.Asset(ctx, id, assetID, pin)
	}, directory, originClient)
	gateway.AllowedOrigin = os.Getenv("VENUE_EDGE_WEB_ORIGIN")
	if gateway.AllowedOrigin != "" {
		origin, err := url.Parse(gateway.AllowedOrigin)
		if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
			return fmt.Errorf("venue edge web origin must be an HTTPS origin")
		}
	}
	server, err := transportgrpc.NewServer(listener, deps)
	if err != nil {
		return err
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor == 2 && strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc") {
			server.GRPCServer().ServeHTTP(w, r)
			return
		}
		gateway.ServeHTTP(w, r)
	})
	httpServer := &http.Server{Handler: handler, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	if err = http2.ConfigureServer(httpServer, &http2.Server{}); err != nil {
		return err
	}
	if err = checkApplicationReadiness(ctx, readinessCheckTimeout, readiness); err != nil {
		return err
	}
	server.SetApplicationReady(true)
	monitorContext, cancel := context.WithCancel(ctx)
	defer cancel()
	ticker := time.NewTicker(readinessCheckInterval)
	defer ticker.Stop()
	go monitorApplicationReadiness(monitorContext, ticker.C, readinessCheckTimeout, readiness, server.SetApplicationReady)
	result := make(chan error, 1)
	go func() { result <- httpServer.ServeTLS(listener, "", "") }()
	slog.Info("venue HTTPS and gRPC listening", "address", listener.Addr().String())
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		server.SetApplicationReady(false)
		// HTTP/2 gRPC streams must be stopped before waiting for HTTP shutdown.
		server.GRPCServer().Stop()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdown)
	}
}
