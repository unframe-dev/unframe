package protocolv2

import (
	"crypto/sha256"
	"encoding/hex"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
	"testing"
	"time"
)

func recoveryEnvelope(t *testing.T, recovery *realtimev2.RuntimeRecoveryMetadata) *realtimev2.DurableCheckpointEnvelope {
	t.Helper()
	payload, err := proto.Marshal(recovery)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	return &realtimev2.DurableCheckpointEnvelope{ReliableSequence: 1, RecoveryPayload: payload, RecoveryHash: proto.String("sha256:" + hex.EncodeToString(digest[:]))}
}
func TestRecoveryMetadataRejectsCorruptionAndInvalidHistory(t *testing.T) {
	base := &realtimev2.RuntimeRecoveryMetadata{CommandEpoch: 1, InputSynchronization: synchronizationFixture(), StartedAt: time.Now().UTC().Format(time.RFC3339Nano), Participants: []*realtimev2.RuntimeParticipantHistory{{ParticipantId: "viewer", Role: presentationv2.SessionRole_SESSION_ROLE_VIEWER}}}
	good := recoveryEnvelope(t, base)
	if _, err := DecodeRecoveryMetadata(good); err != nil {
		t.Fatal(err)
	}
	good.RecoveryPayload[0] ^= 1
	if _, err := DecodeRecoveryMetadata(good); err == nil {
		t.Fatal("corrupt recovery payload accepted")
	}
	for _, test := range []struct {
		name   string
		modify func(*realtimev2.RuntimeRecoveryMetadata)
	}{
		{"invalid time", func(r *realtimev2.RuntimeRecoveryMetadata) { r.StartedAt = "invalid" }},
		{"duplicate participants", func(r *realtimev2.RuntimeRecoveryMetadata) {
			r.Participants = append(r.Participants, r.Participants[0])
		}},
		{"invalid command key", func(r *realtimev2.RuntimeRecoveryMetadata) {
			r.Commands = []*realtimev2.RuntimeCommandHistory{{ParticipantId: "viewer", ClientEventId: "wrong", CommandEpoch: 1, Fingerprint: "input", Outcome: &realtimev2.CommandOutcome{ClientEventId: "click", Result: &realtimev2.CommandOutcome_NoOp{NoOp: &realtimev2.CommandNoOp{Reason: realtimev2.CommandNoOpReason_COMMAND_NO_OP_REASON_ALREADY_PAUSED}}}}}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := proto.Clone(base).(*realtimev2.RuntimeRecoveryMetadata)
			test.modify(r)
			if _, err := DecodeRecoveryMetadata(recoveryEnvelope(t, r)); err == nil {
				t.Fatal("invalid recovery history accepted")
			}
		})
	}
}
func TestRecoveryMetadataRejectsOmissionAndOrphanHash(t *testing.T) {
	envelope := &realtimev2.DurableCheckpointEnvelope{}
	if recovery, err := DecodeRecoveryMetadata(envelope); err == nil || recovery != nil {
		t.Fatal("missing recovery admitted")
	}
	envelope.RecoveryHash = proto.String("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if _, err := DecodeRecoveryMetadata(envelope); err == nil {
		t.Fatal("hash without payload accepted")
	}
}

func TestCapacityFaultRequiresPositiveDimensions(t *testing.T) {
	for _, fault := range []*realtimev2.RuntimeCapacityFault{{}, {StepStartStateBytes: 1, StepStartHistoryBytes: 1}, {StepStartStateBytes: 1, CanonicalSnapshotBytes: 1}, {StepStartHistoryBytes: 1, CanonicalSnapshotBytes: 1}} {
		if err := ValidateMessage(fault); err == nil {
			t.Fatalf("invalid fault accepted: %v", fault)
		}
	}
	if err := ValidateMessage(&realtimev2.RuntimeCapacityFault{StepStartStateBytes: 1, StepStartHistoryBytes: 1, CanonicalSnapshotBytes: 1}); err != nil {
		t.Fatal(err)
	}
}
