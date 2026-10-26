package grpc

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/observability"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
)

var (
	ErrServerStarted       = errors.New("gRPC server already started")
	ErrServerConfiguration = errors.New("gRPC server dependencies are invalid")
)

// Server owns a gRPC server and the listener it serves on.
type Server struct {
	listener       net.Listener
	server         *grpcgo.Server
	health         *health.Server
	browser        *http.Server
	browserHandler *browserHandler
	browserCancel  context.CancelFunc
	split          *splitListener

	mu        sync.Mutex
	started   bool
	serveDone chan struct{}
	serveErr  error
}

type Dependencies struct {
	Verifier       *auth.BearerTokenVerifier
	Guard          *assignment.AssignmentGuard
	V2             *V2Service
	Logger         *slog.Logger
	Metrics        *observability.Metrics
	BrowserOrigins []string
}

// NewServer creates an authenticated server and registers the realtime bidi
// service. It requires the verified identity, assignment, and session-state
// boundaries supplied by the composition root.
func NewServer(listener net.Listener, dependencies Dependencies, options ...grpcgo.ServerOption) (*Server, error) {
	if dependencies.Verifier == nil || dependencies.Guard == nil || dependencies.V2 == nil {
		return nil, ErrServerConfiguration
	}
	options = append(options, grpcgo.ChainStreamInterceptor(
		observability.StreamServerInterceptor(dependencies.Logger, dependencies.Metrics),
		auth.NewBearerStreamServerInterceptor(dependencies.Verifier),
	))
	grpcServer := grpcgo.NewServer(options...)
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", healthv1.HealthCheckResponse_NOT_SERVING)
	realtimev2.RegisterRealtimeServiceServer(grpcServer, dependencies.V2)
	healthv1.RegisterHealthServer(grpcServer, healthServer)
	result := &Server{
		listener:  listener,
		server:    grpcServer,
		health:    healthServer,
		serveDone: make(chan struct{}),
	}
	if len(dependencies.BrowserOrigins) > 0 {
		lifetime, cancel := context.WithCancel(context.Background())
		result.browserCancel = cancel
		result.browserHandler = newBrowserHandler(lifetime, dependencies.Verifier, dependencies.V2, dependencies.BrowserOrigins)
		result.browser = &http.Server{Handler: result.browserHandler, ReadHeaderTimeout: 5 * time.Second}
		result.split = newSplitListener(listener)
		result.listener = result.split
	}
	return result, nil
}

// GRPCServer returns the underlying server for generated service registration.
func (s *Server) GRPCServer() *grpcgo.Server {
	return s.server
}

// SetApplicationReady publishes readiness only after the Runtime Core and its
// external verification dependencies have been checked by the composition root.
func (s *Server) SetApplicationReady(ready bool) {
	status := healthv1.HealthCheckResponse_NOT_SERVING
	if ready {
		status = healthv1.HealthCheckResponse_SERVING
	}
	s.health.SetServingStatus("", status)
}

// Start begins serving in the background.
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return ErrServerStarted
	}
	s.started = true
	if s.browser != nil {
		go s.split.run()
		go func() { _ = s.browser.Serve(httpListener{s.split}) }()
	}

	go func() {
		err := s.server.Serve(s.listener)
		if s.browser != nil {
			s.browserCancel()
			_ = s.browser.Close()
		}
		s.mu.Lock()
		if errors.Is(err, grpcgo.ErrServerStopped) {
			err = nil
		}
		s.serveErr = err
		s.mu.Unlock()
		close(s.serveDone)
	}()
	return nil
}

// Wait returns after serving ends.
func (s *Server) Wait() error {
	<-s.serveDone
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.serveErr
}

// Shutdown gracefully stops serving, forcing the server to stop when ctx ends.
func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	started := s.started
	s.mu.Unlock()
	if !started {
		return nil
	}
	s.SetApplicationReady(false)
	browserDone := make(chan struct{})
	var browserStopped <-chan struct{} = browserDone
	close(browserDone)
	if s.browser != nil {
		browserStopped = s.browserHandler.stop()
		s.browserCancel()
		_ = s.browser.Close()
	}

	stopped := make(chan struct{})
	go func() {
		s.server.GracefulStop()
		select {
		case <-browserStopped:
		case <-ctx.Done():
		}
		close(stopped)
	}()

	select {
	case <-stopped:
		return s.Wait()
	case <-ctx.Done():
		s.server.Stop()
		<-stopped
		if err := s.Wait(); err != nil {
			return err
		}
		return ctx.Err()
	}
}
