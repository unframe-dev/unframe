package auth

import (
	"context"

	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const authorizationMetadataKey = "authorization"

// NewBearerStreamServerInterceptor verifies a session-bound Runtime JWT before
// dispatching a gRPC stream handler. The standard health watch is public so a
// platform can observe application readiness before participant credentials
// can be issued.
func NewBearerStreamServerInterceptor(verifier *BearerTokenVerifier) grpcgo.StreamServerInterceptor {
	return func(server any, stream grpcgo.ServerStream, info *grpcgo.StreamServerInfo, handler grpcgo.StreamHandler) error {
		if info != nil && info.FullMethod == healthv1.Health_Watch_FullMethodName {
			return handler(server, stream)
		}
		if verifier == nil {
			return status.Error(codes.Unauthenticated, "realtime connection is unauthenticated")
		}
		authorizations := metadata.ValueFromIncomingContext(stream.Context(), authorizationMetadataKey)
		if len(authorizations) != 1 {
			return status.Error(codes.Unauthenticated, "realtime connection is unauthenticated")
		}
		identity, err := verifier.VerifyBearer(stream.Context(), authorizations[0], "realtime:connect")
		if err != nil {
			return status.Error(codes.Unauthenticated, "realtime connection is unauthenticated")
		}
		return handler(server, contextServerStream{ServerStream: stream, context: ContextWithIdentity(stream.Context(), identity)})
	}
}

type contextServerStream struct {
	grpcgo.ServerStream
	context context.Context
}

func (s contextServerStream) Context() context.Context {
	return s.context
}
