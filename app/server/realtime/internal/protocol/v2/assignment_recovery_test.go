package protocolv2

import (
	"testing"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

func TestCheckpointRecoveryFromAuthorizedAssignment(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	target := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
	target.AssignmentEpoch = 2
	target.RuntimeId = "replacement"
	restored, err := DecodeCheckpointFromAssignment(envelope, target, envelope, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ReliableSequence != 3 || restored.Clock.GetPaused() == nil {
		t.Fatal("lost durable cut")
	}
	for _, mutate := range []func(*realtimev2.DurableCheckpointEnvelope){
		func(e *realtimev2.DurableCheckpointEnvelope) { e.CheckpointSequence++ },
		func(e *realtimev2.DurableCheckpointEnvelope) { e.AssignmentEpoch = 3 },
		func(e *realtimev2.DurableCheckpointEnvelope) { e.RuntimeId = "untrusted" },
		func(e *realtimev2.DurableCheckpointEnvelope) { e.SessionId = "other" },
		func(e *realtimev2.DurableCheckpointEnvelope) { e.Publication.PublicationEpoch++ },
		func(e *realtimev2.DurableCheckpointEnvelope) { e.DefinitionHash = target.RenderBundleHash },
	} {
		source := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
		mutate(source)
		if _, err := DecodeCheckpointFromAssignment(envelope, target, source, catalog); err == nil {
			t.Fatal("untrusted source admitted")
		}
	}
	if _, err := DecodeCheckpointFromAssignment(envelope, target, nil, catalog); err == nil {
		t.Fatal("missing authority admitted")
	}
	target.AssignmentEpoch = 1
	if _, err := DecodeCheckpointFromAssignment(envelope, target, envelope, catalog); err == nil {
		t.Fatal("same epoch runtime change admitted")
	}
	if _, err := DecodeCheckpoint(envelope, target, catalog); err == nil {
		t.Fatal("strict restoration weakened")
	}
}

func TestAuthorizedAssignmentRecoveryStillValidatesCheckpointIntegrity(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	target := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
	target.AssignmentEpoch = 2
	for _, test := range []struct {
		name   string
		mutate func(*realtimev2.DurableCheckpointEnvelope)
	}{
		{"payload hash", func(e *realtimev2.DurableCheckpointEnvelope) {
			e.CanonicalSnapshotPayload = append(e.CanonicalSnapshotPayload, 0x78, 0x01)
		}},
		{"reliable cut", func(e *realtimev2.DurableCheckpointEnvelope) { e.ReliableSequence++ }},
		{"recovery integrity", func(e *realtimev2.DurableCheckpointEnvelope) {
			e.RecoveryPayload = append(e.RecoveryPayload, 0x78, 0x01)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			altered := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
			test.mutate(altered)
			if _, err := DecodeCheckpointFromAssignment(altered, target, envelope, catalog); err == nil {
				t.Fatal("invalid checkpoint admitted through assignment recovery")
			}
		})
	}
}
