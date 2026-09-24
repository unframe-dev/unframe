package protocol

import (
	"errors"

	realtimev1 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v1"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

const (
	Version           = "v1"
	maxMessageIDBytes = 128
)

var (
	ErrMessageIDRequired = errors.New("page-change message ID is required")
	ErrMessageIDTooLong  = errors.New("page-change message ID exceeds 128 bytes")
)

func PageChangeCommand(message *realtimev1.PageChangeCommand) (session.PageChangeCommand, error) {
	if message.GetMessageId() == "" {
		return session.PageChangeCommand{}, ErrMessageIDRequired
	}
	if len(message.GetMessageId()) > maxMessageIDBytes {
		return session.PageChangeCommand{}, ErrMessageIDTooLong
	}
	return session.PageChangeCommand{
		MessageID: message.GetMessageId(),
		PageIndex: message.GetPageIndex(),
	}, nil
}

func ConnectedMessage(identity session.Identity) *realtimev1.ServerEnvelope {
	return &realtimev1.ServerEnvelope{Payload: &realtimev1.ServerEnvelope_Connected{Connected: &realtimev1.Connected{
		ProtocolVersion: Version,
		SessionId:       identity.SessionID,
		ParticipantId:   identity.ParticipantID,
		Role:            Role(identity.Role),
	}}}
}

func ReliableEventMessage(event session.ReliableEvent) *realtimev1.ServerEnvelope {
	return &realtimev1.ServerEnvelope{Payload: &realtimev1.ServerEnvelope_ReliableEvent{ReliableEvent: &realtimev1.ReliableEvent{
		Sequence:         event.Sequence,
		CommandMessageId: event.CommandMessageID,
		Payload: &realtimev1.ReliableEvent_PageChanged{PageChanged: &realtimev1.PageChanged{
			PageIndex: event.PageIndex,
		}},
	}}}
}

func Role(role session.Role) realtimev1.SessionRole {
	if role == session.RolePresenter {
		return realtimev1.SessionRole_SESSION_ROLE_PRESENTER
	}
	return realtimev1.SessionRole_SESSION_ROLE_VIEWER
}
