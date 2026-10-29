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
		credential, err := verifier.verifyBearerCredential(stream.Context(), authorizations[0], "realtime:connect")
		if err != nil {
			return status.Error(codes.Unauthenticated, "realtime connection is unauthenticated")
		}
		ctx, cancel := context.WithDeadline(stream.Context(), credential.ExpiresAt)
		defer cancel()
		if err := ctx.Err(); err != nil {
			return status.FromContextError(err).Err()
		}
		return handler(server, contextServerStream{ServerStream: stream, context: ContextWithIdentity(ctx, credential.Identity)})
	}
}

type contextServerStream struct {
	grpcgo.ServerStream
	context context.Context
}

func (s contextServerStream) Context() context.Context {
	return s.context
}

func (s contextServerStream) SendMsg(message any) error {
	if err := s.context.Err(); err != nil {
		return status.FromContextError(err).Err()
	}
	err := s.ServerStream.SendMsg(message)
	if contextErr := s.context.Err(); contextErr != nil {
		return status.FromContextError(contextErr).Err()
	}
	return err
}

func (s contextServerStream) RecvMsg(message any) error {
	if err := s.context.Err(); err != nil {
		return status.FromContextError(err).Err()
	}
	err := s.ServerStream.RecvMsg(message)
	if contextErr := s.context.Err(); contextErr != nil {
		return status.FromContextError(contextErr).Err()
	}
	return err
}
