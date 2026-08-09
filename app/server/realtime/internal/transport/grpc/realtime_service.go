package grpc

import (
	"errors"
	"io"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/auth"
	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/protocol"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type RealtimeService struct {
	realtimev1.UnimplementedRealtimeServiceServer

	coordinator *session.Coordinator
	identities  auth.IdentityResolver
}

func NewRealtimeService(coordinator *session.Coordinator, identities auth.IdentityResolver) *RealtimeService {
	return &RealtimeService{coordinator: coordinator, identities: identities}
}

func (s *RealtimeService) Connect(stream grpcgo.BidiStreamingServer[realtimev1.ClientEnvelope, realtimev1.ServerEnvelope]) error {
	identity, err := s.identities.Resolve(stream.Context())
	if err != nil {
		return status.Error(codes.Unauthenticated, "realtime connection is unauthenticated")
	}
	first, err := stream.Recv()
	if errors.Is(err, io.EOF) {
		return status.Error(codes.FailedPrecondition, "handshake is required")
	}
	if err != nil {
		return err
	}
	if handshake := first.GetHandshake(); handshake == nil || handshake.GetProtocolVersion() != protocol.Version {
		return status.Errorf(codes.FailedPrecondition, "first message must handshake with protocol version %q", protocol.Version)
	}

	connection, err := s.coordinator.Connect(identity)
	if err != nil {
		if errors.Is(err, session.ErrParticipantActive) {
			return status.Error(codes.AlreadyExists, err.Error())
		}
		return status.Error(codes.Unauthenticated, "realtime connection identity is invalid")
	}
	defer s.coordinator.Disconnect(connection)
	if err := stream.Send(protocol.ConnectedMessage(identity)); err != nil {
		return err
	}

	commands := make(chan error, 1)
	go s.receiveCommands(stream, connection, commands)
	for {
		select {
		case err := <-commands:
			if err == nil {
				commands = nil
				continue
			}
			return flushPendingEvents(stream, connection.Events(), err)
		case event, ok := <-connection.Events():
			if !ok {
				return status.Error(codes.ResourceExhausted, "reliable event queue exceeded")
			}
			if err := stream.Send(protocol.ReliableEventMessage(event)); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

func flushPendingEvents(stream grpcgo.BidiStreamingServer[realtimev1.ClientEnvelope, realtimev1.ServerEnvelope], events <-chan session.ReliableEvent, terminalError error) error {
	for {
		select {
		case event, ok := <-events:
			if !ok {
				return status.Error(codes.ResourceExhausted, "reliable event queue exceeded")
			}
			if err := stream.Send(protocol.ReliableEventMessage(event)); err != nil {
				return err
			}
		default:
			return terminalError
		}
	}
}

func (s *RealtimeService) receiveCommands(stream grpcgo.BidiStreamingServer[realtimev1.ClientEnvelope, realtimev1.ServerEnvelope], connection *session.Connection, results chan<- error) {
	for {
		message, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			results <- nil
			return
		}
		if err != nil {
			results <- err
			return
		}
		command := message.GetPageChange()
		if command == nil {
			results <- status.Error(codes.InvalidArgument, "expected page-change command")
			return
		}
		input, err := protocol.PageChangeCommand(command)
		if err != nil {
			results <- status.Error(codes.InvalidArgument, err.Error())
			return
		}
		if _, err := s.coordinator.ChangePage(connection, input); err != nil {
			results <- commandError(err)
			return
		}
	}
}

func commandError(err error) error {
	switch {
	case errors.Is(err, session.ErrForbidden):
		return status.Error(codes.PermissionDenied, err.Error())
	case errors.Is(err, session.ErrDuplicateMessageID):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, session.ErrConnectionInactive):
		return status.Error(codes.FailedPrecondition, err.Error())
	default:
		return status.Error(codes.InvalidArgument, err.Error())
	}
}
