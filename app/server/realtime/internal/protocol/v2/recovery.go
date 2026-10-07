package protocolv2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

// DecodeRecoveryMetadata validates the durable-only history against its raw byte
// hash. Older protocol fixtures may omit it; the runtime requires it to recover.
func DecodeRecoveryMetadata(envelope *realtimev2.DurableCheckpointEnvelope) (*realtimev2.RuntimeRecoveryMetadata, error) {
	if envelope == nil {
		return nil, fmt.Errorf("message_invalid: recovery envelope")
	}
	if len(envelope.RecoveryPayload) == 0 {
		if envelope.RecoveryHash != nil {
			return nil, fmt.Errorf("message_invalid: recovery hash without payload")
		}
		return nil, nil
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
	if err := rejectUnknown(recovery.ProtoReflect()); err != nil {
		return nil, err
	}
	started, err := time.Parse(time.RFC3339Nano, recovery.StartedAt)
	if err != nil || started.IsZero() || len(recovery.Commands) > 1024 {
		return nil, fmt.Errorf("message_invalid: recovery metadata")
	}
	seen := make(map[string]bool)
	var previousTime int64
	for _, command := range recovery.Commands {
		parts := strings.Split(command.Key, "\x00")
		if len(parts) != 2 || !identifier.MatchString(parts[0]) || parts[1] != command.Outcome.ClientEventId || seen[command.Key] || !contentHash.MatchString(command.Fingerprint) || command.RememberedAtUnixMs <= 0 || command.RememberedAtUnixMs < previousTime || command.Outcome.GetAccepted().GetReliableSequence() > envelope.ReliableSequence {
			return nil, fmt.Errorf("message_invalid: recovery command history")
		}
		seen[command.Key] = true
		previousTime = command.RememberedAtUnixMs
	}
	return recovery, nil
}
