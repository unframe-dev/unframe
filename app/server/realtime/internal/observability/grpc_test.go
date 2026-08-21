package observability

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestStreamServerInterceptorTracksFailuresWithoutLoggingSensitiveDetails(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	metrics := &Metrics{}
	interceptor := StreamServerInterceptor(slog.New(slog.NewTextHandler(&output, nil)), metrics)
	stream := testStream{context: context.Background()}
	err := interceptor(nil, stream, &grpcgo.StreamServerInfo{FullMethod: "/unframe.realtime.v1.RealtimeService/Connect"}, func(any, grpcgo.ServerStream) error {
		if got := metrics.Snapshot().ActiveStreams; got != 1 {
			t.Fatalf("active streams while handling = %d, want 1", got)
		}
		return status.Error(codes.Unauthenticated, "secret-token")
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("status = %s, want Unauthenticated", status.Code(err))
	}
	snapshot := metrics.Snapshot()
	if snapshot.ActiveStreams != 0 || snapshot.CompletedStreams != 1 || snapshot.AuthenticationFailures != 1 {
		t.Fatalf("metrics = %#v, want one completed authentication failure", snapshot)
	}
	if logOutput := output.String(); !strings.Contains(logOutput, "code=Unauthenticated") || !strings.Contains(logOutput, "RealtimeService/Connect") || strings.Contains(logOutput, "secret-token") {
		t.Errorf("unsafe or incomplete log output: %q", logOutput)
	}
}

func TestStreamServerInterceptorHandlesMissingMethodMetadata(t *testing.T) {
	t.Parallel()

	interceptor := StreamServerInterceptor(nil, nil)
	if err := interceptor(nil, testStream{context: context.Background()}, nil, func(any, grpcgo.ServerStream) error { return nil }); err != nil {
		t.Fatalf("interceptor error = %v", err)
	}
}

type testStream struct {
	grpcgo.ServerStream
	context context.Context
}

func (s testStream) Context() context.Context { return s.context }
