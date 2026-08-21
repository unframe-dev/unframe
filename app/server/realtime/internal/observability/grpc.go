package observability

import (
	"log/slog"
	"sync/atomic"
	"time"

	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Metrics struct {
	activeStreams          atomic.Int64
	completedStreams       atomic.Uint64
	authenticationFailures atomic.Uint64
	resourceExhausted      atomic.Uint64
}

type Snapshot struct {
	ActiveStreams          int64
	CompletedStreams       uint64
	AuthenticationFailures uint64
	ResourceExhausted      uint64
}

func (m *Metrics) Snapshot() Snapshot {
	return Snapshot{
		ActiveStreams:          m.activeStreams.Load(),
		CompletedStreams:       m.completedStreams.Load(),
		AuthenticationFailures: m.authenticationFailures.Load(),
		ResourceExhausted:      m.resourceExhausted.Load(),
	}
}

// StreamServerInterceptor records bounded metadata and never logs incoming
// metadata or returned error details because they can contain credentials.
func StreamServerInterceptor(logger *slog.Logger, metrics *Metrics) grpcgo.StreamServerInterceptor {
	if logger == nil {
		logger = slog.Default()
	}
	if metrics == nil {
		metrics = &Metrics{}
	}
	return func(server any, stream grpcgo.ServerStream, info *grpcgo.StreamServerInfo, handler grpcgo.StreamHandler) error {
		startedAt := time.Now()
		metrics.activeStreams.Add(1)
		defer metrics.activeStreams.Add(-1)

		err := handler(server, stream)
		code := status.Code(err)
		metrics.completedStreams.Add(1)
		switch code {
		case codes.Unauthenticated:
			metrics.authenticationFailures.Add(1)
		case codes.ResourceExhausted:
			metrics.resourceExhausted.Add(1)
		}
		method := "unknown"
		if info != nil && info.FullMethod != "" {
			method = info.FullMethod
		}
		logger.Info("realtime stream completed",
			"method", method,
			"code", code.String(),
			"duration_ms", time.Since(startedAt).Milliseconds(),
		)
		return err
	}
}
