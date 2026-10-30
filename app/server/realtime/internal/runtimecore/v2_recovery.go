package runtimecore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func (s *V2Session) v2Recovery() *realtimev2.RuntimeRecoveryMetadata {
	recovery := &realtimev2.RuntimeRecoveryMetadata{StartedAt: s.startedAt.UTC().Format(time.RFC3339Nano), CommandEpoch: s.commandEpoch, InputSynchronization: proto.Clone(s.inputSynchronization).(*realtimev2.PresenterInputSynchronization)}
	if !s.emptySince.IsZero() {
		recovery.EmptySince = proto.String(s.emptySince.UTC().Format(time.RFC3339Nano))
	}
	if s.capacityFault != nil {
		recovery.CapacityFault = proto.Clone(s.capacityFault).(*realtimev2.RuntimeCapacityFault)
	}
	for id, role := range s.participants {
		recovery.Participants = append(recovery.Participants, &realtimev2.RuntimeParticipantHistory{ParticipantId: id, Role: v2SessionRole(role)})
	}
	sort.Slice(recovery.Participants, func(i, j int) bool {
		return recovery.Participants[i].ParticipantId < recovery.Participants[j].ParticipantId
	})
	for _, key := range s.order {
		record := s.outcomes[key]
		recovery.Commands = append(recovery.Commands, &realtimev2.RuntimeCommandHistory{ParticipantId: strings.SplitN(key, "\x00", 2)[0], ClientEventId: record.outcome.ClientEventId, CommandEpoch: s.commandEpoch, Fingerprint: record.fingerprint, Outcome: proto.Clone(record.outcome).(*realtimev2.CommandOutcome)})
	}
	return recovery
}
func (s *V2Session) restoreV2Recovery(recovery *realtimev2.RuntimeRecoveryMetadata) error {
	started, err := time.Parse(time.RFC3339Nano, recovery.StartedAt)
	if err != nil {
		return fmt.Errorf("%w: recovery start time", ErrV2RuntimeDefinition)
	}
	s.capacityFault = nil
	if recovery.CapacityFault != nil {
		s.capacityFault = proto.Clone(recovery.CapacityFault).(*realtimev2.RuntimeCapacityFault)
	}
	s.emptySince = time.Time{}
	if recovery.EmptySince != nil {
		emptySince, err := time.Parse(time.RFC3339Nano, recovery.GetEmptySince())
		if err != nil || emptySince.IsZero() {
			return fmt.Errorf("%w: recovery empty time", ErrV2RuntimeDefinition)
		}
		s.emptySince = emptySince
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
	s.commandEpoch = recovery.CommandEpoch
	s.inputSynchronization = proto.Clone(recovery.InputSynchronization).(*realtimev2.PresenterInputSynchronization)
	s.order = nil
	for _, c := range recovery.Commands {
		s.outcomes[c.ParticipantId+"\x00"+c.ClientEventId] = v2OutcomeRecord{fingerprint: c.Fingerprint, outcome: proto.Clone(c.Outcome).(*realtimev2.CommandOutcome)}
		s.order = append(s.order, c.ParticipantId+"\x00"+c.ClientEventId)
	}
	return nil
}
func (s *V2Session) commitV2Outcome(ctx context.Context, key, fingerprint string, outcome *realtimev2.CommandOutcome) error {
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	s.rememberOutcome(key, fingerprint, outcome)
	return s.commitV2Mutation(ctx, previous, nil)
}
