package runtimecore

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) v2Recovery() *realtimev2.RuntimeRecoveryMetadata {
	s.evictV2Outcomes(time.Now())
	recovery := &realtimev2.RuntimeRecoveryMetadata{StartedAt: s.startedAt.UTC().Format(time.RFC3339Nano)}
	for id, role := range s.participants {
		recovery.Participants = append(recovery.Participants, &realtimev2.RuntimeParticipantHistory{ParticipantId: id, Role: v2SessionRole(role)})
	}
	sort.Slice(recovery.Participants, func(i, j int) bool {
		return recovery.Participants[i].ParticipantId < recovery.Participants[j].ParticipantId
	})
	for _, key := range s.order {
		record := s.outcomes[key]
		recovery.Commands = append(recovery.Commands, &realtimev2.RuntimeCommandHistory{Key: key, Fingerprint: record.fingerprint, Outcome: proto.Clone(record.outcome).(*realtimev2.CommandOutcome), RememberedAtUnixMs: s.outcomeTimes[key].UnixMilli()})
	}
	return recovery
}
func (s *V2Session) restoreV2Recovery(recovery *realtimev2.RuntimeRecoveryMetadata) error {
	started, err := time.Parse(time.RFC3339Nano, recovery.StartedAt)
	if err != nil {
		return fmt.Errorf("%w: recovery start time", ErrV2RuntimeDefinition)
	}
	s.startedAt = started
	s.participants = make(map[string]session.Role, len(recovery.Participants))
	for _, p := range recovery.Participants {
		role := session.RoleViewer
		if p.Role == presentationv2.SessionRole_SESSION_ROLE_PRESENTER {
			role = session.RolePresenter
		}
		s.participants[p.ParticipantId] = role
	}
	s.outcomes = make(map[string]v2OutcomeRecord, len(recovery.Commands))
	s.outcomeTimes = make(map[string]time.Time, len(recovery.Commands))
	s.order = nil
	for _, c := range recovery.Commands {
		s.outcomes[c.Key] = v2OutcomeRecord{fingerprint: c.Fingerprint, outcome: proto.Clone(c.Outcome).(*realtimev2.CommandOutcome)}
		s.outcomeTimes[c.Key] = time.UnixMilli(c.RememberedAtUnixMs)
		s.order = append(s.order, c.Key)
	}
	s.evictV2Outcomes(time.Now())
	return nil
}
func (s *V2Session) commitV2Outcome(ctx context.Context, key, fingerprint string, outcome *realtimev2.CommandOutcome) error {
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	s.rememberOutcome(key, fingerprint, outcome)
	return s.commitV2Mutation(ctx, previous, nil)
}

func v2CommandFingerprint(variant string, strings []string, controlKind realtimev2.RuntimeControlKind, origin uint64) string {
	payload := append([]byte("unframe-command-v2\x00"), variant...)
	payload = append(payload, 0)
	for _, value := range strings {
		payload = binary.BigEndian.AppendUint32(payload, uint32(len(value)))
		payload = append(payload, value...)
	}
	if controlKind != realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_UNSPECIFIED {
		payload = binary.BigEndian.AppendUint32(payload, uint32(controlKind))
	}
	payload = binary.BigEndian.AppendUint64(payload, origin)
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:])
}
