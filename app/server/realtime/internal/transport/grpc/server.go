package grpc

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"sync"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/observability"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
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
	listener net.Listener
	server   *grpcgo.Server
	health   *health.Server

	mu        sync.Mutex
	started   bool
	serveDone chan struct{}
	serveErr  error
}

type Dependencies struct {
	Verifier    *auth.BearerTokenVerifier
	Guard       *assignment.AssignmentGuard
	Coordinator *session.Coordinator
	Logger      *slog.Logger
	Metrics     *observability.Metrics
}

// NewServer creates an authenticated server and registers the realtime bidi
// service. It requires the verified identity, assignment, and session-state
// boundaries supplied by the composition root.
func NewServer(listener net.Listener, dependencies Dependencies, options ...grpcgo.ServerOption) (*Server, error) {
	if dependencies.Verifier == nil || dependencies.Guard == nil || dependencies.Coordinator == nil {
		return nil, ErrServerConfiguration
	}
	options = append(options, grpcgo.ChainStreamInterceptor(
		observability.StreamServerInterceptor(dependencies.Logger, dependencies.Metrics),
		auth.NewBearerStreamServerInterceptor(dependencies.Verifier),
	))
	grpcServer := grpcgo.NewServer(options...)
	healthServer := health.NewServer()
	healthServer.SetServingStatus("", healthv1.HealthCheckResponse_NOT_SERVING)
	realtimev1.RegisterRealtimeServiceServer(grpcServer, NewRealtimeService(dependencies.Coordinator, auth.ContextIdentityResolver{}, dependencies.Guard))
	healthv1.RegisterHealthServer(grpcServer, healthServer)
	return &Server{
		listener:  listener,
		server:    grpcServer,
		health:    healthServer,
		serveDone: make(chan struct{}),
	}, nil
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

	go func() {
		err := s.server.Serve(s.listener)
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

	stopped := make(chan struct{})
	go func() {
		s.server.GracefulStop()
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
