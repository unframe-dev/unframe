package protocolv2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

// DecodeRecoveryMetadata verifies the durable command history and synchronization cut.
func DecodeRecoveryMetadata(envelope *realtimev2.DurableCheckpointEnvelope) (*realtimev2.RuntimeRecoveryMetadata, error) {
	if envelope == nil {
		return nil, fmt.Errorf("message_invalid: recovery envelope")
	}
	if len(envelope.RecoveryPayload) == 0 {
		return nil, fmt.Errorf("message_invalid: recovery metadata is required")
	}

	digest := sha256.Sum256(envelope.RecoveryPayload)
	if envelope.GetRecoveryHash() != "sha256:"+hex.EncodeToString(digest[:]) {
		return nil, fmt.Errorf("message_invalid: recovery payload hash")
	}
	recovery := new(realtimev2.RuntimeRecoveryMetadata)
	if err := proto.Unmarshal(envelope.RecoveryPayload, recovery); err != nil {
		return nil, fmt.Errorf("message_invalid: recovery protobuf: %w", err)
	}
	if err := ValidateMessage(recovery); err != nil {
		return nil, err
	}
	if recovery.InputSynchronization.ReliableSequence > envelope.ReliableSequence {
		return nil, fmt.Errorf("message_invalid: recovery synchronization cut")
	}
	for _, command := range recovery.Commands {
		if command.Outcome.GetAccepted().GetReliableSequence() > envelope.ReliableSequence {
			return nil, fmt.Errorf("message_invalid: recovery command history cut")
		}
	}

	return recovery, nil
}
