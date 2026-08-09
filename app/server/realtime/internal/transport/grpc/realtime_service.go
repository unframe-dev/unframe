package grpc

import (
	"errors"
	"io"
	"sync"

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
	deliveries := newDeliveryTracker()
	defer deliveries.cancelAll()

	commands := make(chan error, 1)
	sendResults := make(chan error, 1)
	go s.sendEvents(stream, connection, identity, deliveries, sendResults)
	go s.receiveCommands(stream, connection, deliveries, commands)
	for {
		select {
		case err := <-commands:
			if err == nil {
				commands = nil
				continue
			}
			select {
			case <-connection.Overflowed():
				return status.Error(codes.ResourceExhausted, "reliable event queue exceeded")
			default:
			}
			return err
		case err := <-sendResults:
			return err
		case <-connection.Overflowed():
			return status.Error(codes.ResourceExhausted, "reliable event queue exceeded")
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

func (s *RealtimeService) sendEvents(stream grpcgo.BidiStreamingServer[realtimev1.ClientEnvelope, realtimev1.ServerEnvelope], connection *session.Connection, identity session.Identity, deliveries *deliveryTracker, results chan<- error) {
	if err := stream.Send(protocol.ConnectedMessage(identity)); err != nil {
		results <- err
		return
	}
	for event := range connection.Events() {
		if err := stream.Send(protocol.ReliableEventMessage(event)); err != nil {
			results <- err
			return
		}
		deliveries.acknowledge(event.CommandMessageID)
	}
}

func (s *RealtimeService) receiveCommands(stream grpcgo.BidiStreamingServer[realtimev1.ClientEnvelope, realtimev1.ServerEnvelope], connection *session.Connection, deliveries *deliveryTracker, results chan<- error) {
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
		delivery := deliveries.expect(input.MessageID)
		_, err = s.coordinator.ChangePage(connection, input)
		if err != nil {
			deliveries.cancel(input.MessageID)
			results <- commandError(err)
			return
		}
		if !deliveries.wait(input.MessageID, delivery) {
			results <- status.Error(codes.ResourceExhausted, "reliable event queue exceeded")
			return
		}
	}
}

type deliveryTracker struct {
	mu         sync.Mutex
	deliveries map[string]*pendingDelivery
}

type pendingDelivery struct {
	done      chan struct{}
	completed bool
	delivered bool
}

func newDeliveryTracker() *deliveryTracker {
	return &deliveryTracker{deliveries: make(map[string]*pendingDelivery)}
}

func (t *deliveryTracker) expect(messageID string) *pendingDelivery {
	t.mu.Lock()
	defer t.mu.Unlock()
	delivery := &pendingDelivery{done: make(chan struct{})}
	t.deliveries[messageID] = delivery
	return delivery
}

func (t *deliveryTracker) acknowledge(messageID string) {
	t.complete(messageID, true)
}

func (t *deliveryTracker) cancel(messageID string) {
	t.complete(messageID, false)
}

func (t *deliveryTracker) complete(messageID string, delivered bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delivery := t.deliveries[messageID]
	if delivery == nil || delivery.completed {
		return
	}
	delivery.completed = true
	delivery.delivered = delivered
	close(delivery.done)
}

func (t *deliveryTracker) wait(messageID string, delivery *pendingDelivery) bool {
	<-delivery.done
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.deliveries[messageID] == delivery {
		delete(t.deliveries, messageID)
	}
	return delivery.delivered
}

func (t *deliveryTracker) cancelAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, delivery := range t.deliveries {
		if delivery.completed {
			continue
		}
		delivery.completed = true
		close(delivery.done)
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
