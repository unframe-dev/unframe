package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/unframe-dev/unframe/app/server/realtime/internal/assignment"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func (c *Client) CheckpointEnvelope(ctx context.Context, envelope *realtimev2.DurableCheckpointEnvelope, presentationRevision uint64) (Result, error) {
	if !validCheckpointEnvelope(envelope) {
		return Result{}, ErrInvalidCallback
	}
	materialized, err := protojson.Marshal(envelope)
	if err != nil {
		return Result{}, ErrInvalidCallback
	}
	return c.Checkpoint(ctx, Checkpoint{
		SessionID:            envelope.SessionId,
		RuntimeID:            envelope.RuntimeId,
		RuntimeKind:          runtimeKind(envelope.RuntimeKind),
		AssignmentEpoch:      envelope.AssignmentEpoch,
		PresentationRevision: presentationRevision,
		Version:              envelope.CheckpointSequence,
		LastSequence:         envelope.ReliableSequence,
		IdempotencyKey:       fmt.Sprintf("v2-checkpoint:%d:%s", envelope.CheckpointSequence, envelope.CanonicalSnapshotHash),
		Payload:              json.RawMessage(materialized),
	})
}

func (c *Client) CompleteEnvelope(ctx context.Context, envelope *realtimev2.DurableCheckpointEnvelope, presentationRevision uint64, startedAt, endedAt string, participants []Participant) (Result, error) {
	if !validCheckpointEnvelope(envelope) {
		return Result{}, ErrInvalidCallback
	}
	materialized, err := protojson.Marshal(envelope)
	if err != nil {
		return Result{}, ErrInvalidCallback
	}
	return c.Complete(ctx, Completion{
		SessionID:            envelope.SessionId,
		RuntimeID:            envelope.RuntimeId,
		RuntimeKind:          runtimeKind(envelope.RuntimeKind),
		AssignmentEpoch:      envelope.AssignmentEpoch,
		PresentationRevision: presentationRevision,
		CheckpointVersion:    envelope.CheckpointSequence,
		LastSequence:         envelope.ReliableSequence,
		IdempotencyKey:       fmt.Sprintf("v2-completion:%d:%s", envelope.CheckpointSequence, envelope.CanonicalSnapshotHash),
		StartedAt:            startedAt,
		EndedAt:              endedAt,
		ParticipantCount:     uint32(len(participants)),
		Participants:         participants,
		FinalCheckpoint:      json.RawMessage(materialized),
	})
}

func validCheckpointEnvelope(envelope *realtimev2.DurableCheckpointEnvelope) bool {
	if envelope == nil || envelope.SchemaVersion != 2 || envelope.CheckpointSequence == 0 || protocolv2.ValidateMessage(envelope) != nil {
		return false
	}
	if _, err := protocolv2.DecodeRecoveryMetadata(envelope); err != nil {
		return false
	}
	digest := sha256.Sum256(envelope.CanonicalSnapshotPayload)
	if envelope.CanonicalSnapshotHash != "sha256:"+hex.EncodeToString(digest[:]) {
		return false
	}
	snapshot := &realtimev2.CanonicalRuntimeSnapshot{}
	return proto.Unmarshal(envelope.CanonicalSnapshotPayload, snapshot) == nil && snapshot.ReliableSequence == envelope.ReliableSequence && protocolv2.ValidateMessage(snapshot) == nil
}

func runtimeKind(kind realtimev2.RuntimeKind) assignment.RuntimeKind {
	switch kind {
	case realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD:
		return assignment.RuntimeKindCloud
	case realtimev2.RuntimeKind_RUNTIME_KIND_VENUE_EDGE:
		return assignment.RuntimeKindVenueEdge
	default:
		return ""
	}
}
