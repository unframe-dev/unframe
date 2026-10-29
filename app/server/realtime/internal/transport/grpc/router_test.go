package grpc

import (
	"context"
	"errors"
	"testing"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type routedProbe struct{ err error }

func (p routedProbe) ConnectControl(grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]) error {
	return p.err
}
func (p routedProbe) ConnectState(grpcgo.BidiStreamingServer[realtime.StateClientItem, realtime.StateServerItem]) error {
	return p.err
}

type routedControl struct {
	grpcgo.BidiStreamingServer[realtime.ControlClientItem, realtime.ControlServerItem]
	ctx context.Context
}

func (s routedControl) Context() context.Context { return s.ctx }
func TestSessionRouterDispatchesOnlyVerifiedRegisteredSessions(t *testing.T) {
	router := NewSessionRouter()
	first, second := errors.New("session-a"), errors.New("session-b")
	router.Register("a", routedProbe{first})
	router.Register("b", routedProbe{second})
	for _, tc := range []struct {
		id   string
		want error
	}{{"a", first}, {"b", second}} {
		ctx := auth.ContextWithIdentity(context.Background(), session.Identity{SessionID: tc.id, ProtocolVersion: 3})
		if err := router.ConnectControl(routedControl{ctx: ctx}); !errors.Is(err, tc.want) {
			t.Fatalf("session %s: %v", tc.id, err)
		}
	}
	if err := router.ConnectControl(routedControl{ctx: context.Background()}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unverified identity: %v", err)
	}
	router.Remove("a")
	ctx := auth.ContextWithIdentity(context.Background(), session.Identity{SessionID: "a", ProtocolVersion: 3})
	if err := router.ConnectControl(routedControl{ctx: ctx}); status.Code(err) != codes.Unavailable {
		t.Fatalf("removed session: %v", err)
	}
}
