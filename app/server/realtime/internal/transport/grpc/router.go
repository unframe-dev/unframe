package grpc

import (
	"context"
	"sync"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type SessionService interface {
	ConnectControl(grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]) error
	ConnectState(grpcgo.BidiStreamingServer[realtime.StateClientItem, realtime.StateServerItem]) error
}

// SessionRouter only selects already loaded sessions using authenticated claims.
type SessionRouter struct {
	realtime.UnimplementedRealtimeServiceServer
	mu       sync.RWMutex
	sessions map[string]SessionService
}

func NewSessionRouter() *SessionRouter {
	return &SessionRouter{sessions: make(map[string]SessionService)}
}
func (r *SessionRouter) Register(id string, service SessionService) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[id] = service
}
func (r *SessionRouter) Remove(id string) { r.mu.Lock(); defer r.mu.Unlock(); delete(r.sessions, id) }
func (r *SessionRouter) resolve(ctx context.Context) (SessionService, error) {
	identity, err := (auth.ContextIdentityResolver{}).Resolve(ctx)
	if err != nil || identity.ProtocolVersion != 3 {
		return nil, status.Error(codes.Unauthenticated, "v3 realtime credential is required")
	}
	r.mu.RLock()
	service := r.sessions[identity.SessionID]
	r.mu.RUnlock()
	if service == nil {
		return nil, status.Error(codes.Unavailable, "runtime session is not ready")
	}
	return service, nil
}
func (r *SessionRouter) ConnectControl(stream grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]) error {
	service, err := r.resolve(stream.Context())
	if err != nil {
		return err
	}
	return service.ConnectControl(stream)
}
func (r *SessionRouter) ConnectState(stream grpcgo.BidiStreamingServer[realtime.StateClientItem, realtime.StateServerItem]) error {
	service, err := r.resolve(stream.Context())
	if err != nil {
		return err
	}
	return service.ConnectState(stream)
}
