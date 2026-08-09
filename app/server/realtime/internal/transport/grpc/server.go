package grpc

import (
	"context"
	"errors"
	"net"
	"sync"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
)

var ErrServerStarted = errors.New("gRPC server already started")

// Server owns a gRPC server and the listener it serves on.
type Server struct {
	listener net.Listener
	server   *grpcgo.Server

	mu        sync.Mutex
	started   bool
	serveDone chan struct{}
	serveErr  error
}

// NewServer creates a server using listener and registers the realtime bidi service.
func NewServer(listener net.Listener, options ...grpcgo.ServerOption) *Server {
	grpcServer := grpcgo.NewServer(options...)
	realtimev1.RegisterRealtimeServiceServer(grpcServer, NewRealtimeService(session.NewCoordinator(), auth.ContextIdentityResolver{}))
	return &Server{
		listener:  listener,
		server:    grpcServer,
		serveDone: make(chan struct{}),
	}
}

// GRPCServer returns the underlying server for generated service registration.
func (s *Server) GRPCServer() *grpcgo.Server {
	return s.server
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
