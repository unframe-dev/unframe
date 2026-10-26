package runtimecore

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"math"
	"sort"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func v3Gesture(name string) presentationv2.GestureKind {
	return map[string]presentationv2.GestureKind{"swipeLeft": 1, "swipeRight": 2, "swipeDown": 3, "swipeUp": 4, "pushForward": 5, "pullBackward": 6, "spreadHands": 7, "closeHands": 8}[name]
}
func v3ZoneEdge(name string) presentationv2.ZoneEdge {
	return map[string]presentationv2.ZoneEdge{"enter": 1, "exit": 2}[name]
}
func (s *V2Session) currentV3InputContext() *realtimev2.InputContext {
	p := s.snapshot.Progression
	return &realtimev2.InputContext{InputEpoch: s.snapshot.InputEpoch, GroupId: p.CurrentGroupId, GroupEntryEpoch: p.GroupEntryEpoch, StepId: p.CurrentStepId, StepEntryEpoch: p.StepEntryEpoch}
}
func (s *V2Session) v3RecognitionCatalog() *presentationv2.PresenterRecognitionCatalog {
	catalog := &presentationv2.PresenterRecognitionCatalog{}
	gestures := map[presentationv2.GestureKind]bool{}
	zones := map[string]bool{}
	for _, cue := range s.definition.Flow.Groups[s.snapshot.Progression.CurrentGroupId].Steps[s.snapshot.Progression.CurrentStepId].Cues {
		if cue.Trigger.Kind == "gesture" {
			gestures[v3Gesture(cue.Trigger.Gesture)] = true
		}
		if cue.Trigger.Kind == "zoneEdge" {
			zones[cue.Trigger.ZoneID] = true
		}
	}
	for gesture := range gestures {
		catalog.Gestures = append(catalog.Gestures, gesture)
	}
	sort.Slice(catalog.Gestures, func(i, j int) bool { return catalog.Gestures[i] < catalog.Gestures[j] })
	for _, id := range sortedV2Keys(zones) {
		zone := s.definition.Stage.Zones[id]
		catalog.Zones = append(catalog.Zones, &presentationv2.PresenterRecognitionZone{ZoneId: id, Center: &presentationv2.Vector3{X: zone.Center[0], Y: zone.Center[1], Z: zone.Center[2]}})
	}
	return catalog
}
func (s *V2Session) newV3Synchronization(reason realtimev2.InputSynchronizationReason, rotate bool) *realtimev2.PresenterInputSynchronization {
	revision := uint64(1)
	if s.inputSynchronization != nil {
		revision = s.inputSynchronization.SynchronizationRevision + 1
	}
	synchronization := &realtimev2.PresenterInputSynchronization{Phase: realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED, Reason: reason, SynchronizationRevision: revision, InputContext: s.currentV3InputContext(), CommandEpoch: s.commandEpoch, ReliableSequence: s.snapshot.ReliableSequence, RecognitionCatalog: s.v3RecognitionCatalog()}
	if rotate || s.inputSynchronization.GetNextCommandEpoch() != 0 {
		next := s.commandEpoch + 1
		synchronization.NextCommandEpoch = &next
	}
	return synchronization
}
func (s *V2Session) requireV3Synchronization(reason realtimev2.InputSynchronizationReason, rotate bool) error {
	if s.snapshot.InputEpoch == math.MaxUint64 || s.inputSynchronization.GetSynchronizationRevision() == math.MaxUint64 || rotate && s.commandEpoch == math.MaxUint64 {
		return ErrV2RuntimeDefinition
	}
	s.snapshot.InputEpoch++
	candidate := s.newV3Synchronization(reason, rotate)
	if protocolv2.KnownSize(candidate) > protocolv2.MaximumInputSynchronizationBytes {
		s.snapshot.InputEpoch--
		return ErrV3RuntimeCapacity
	}
	if err := protocolv2.ValidateMessage(candidate); err != nil {
		s.snapshot.InputEpoch--
		return err
	}
	s.inputSynchronization = candidate
	return nil
}
func (s *V2Session) InputSynchronization() *realtimev2.PresenterInputSynchronization {
	s.mu.Lock()
	defer s.mu.Unlock()
	return proto.Clone(s.inputSynchronization).(*realtimev2.PresenterInputSynchronization)
}
func (s *V2Session) BeginInputSynchronization(ctx context.Context, reason realtimev2.InputSynchronizationReason, rotate bool) error {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot.Clock.GetTerminating() != nil {
		return ErrV2RuntimeDefinition
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	var events []*realtimev2.ProjectedReliableEvent
	if (reason == realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED || reason == realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PROCESS_RECOVERED) && s.snapshot.Clock.GetRunning() != nil {
		pause := &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PRESENTER_DISCONNECTED}
		if reason == realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PROCESS_RECOVERED {
			pause.Reason = realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED
		}
		s.snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: pause}
		events = append(events, s.nextEvent(&realtimev2.ProjectedReliableEvent{Payload: &realtimev2.ProjectedReliableEvent_RuntimeStatusChanged{RuntimeStatusChanged: &realtimev2.RuntimeStatusChanged{Status: &realtimev2.RuntimeStatusChanged_Paused{Paused: pause}}}}))
	}
	if err := s.requireV3Synchronization(reason, rotate); err != nil {
		s.snapshot = previous
		return err
	}
	return s.commitV2Mutation(ctx, previous, events)
}
func (s *V2Session) AcknowledgeInputSynchronization(ctx context.Context, identity session.Identity, ack *realtimev2.InputSynchronizationAck) (*realtimev2.PresenterInputSynchronization, error) {
	if identity.Role != session.RolePresenter {
		return nil, ErrV2PresenterRequired
	}
	if err := protocolv2.ValidateMessage(ack); err != nil {
		return nil, err
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.inputSynchronization
	clone := func() *realtimev2.PresenterInputSynchronization {
		return proto.Clone(s.inputSynchronization).(*realtimev2.PresenterInputSynchronization)
	}
	epoch := current.CommandEpoch
	if current.NextCommandEpoch != nil {
		epoch = *current.NextCommandEpoch
	}
	if ack.SynchronizationRevision != current.SynchronizationRevision || !proto.Equal(ack.InputContext, current.InputContext) || ack.CommandEpoch != epoch || ack.AppliedReliableSequence != current.ReliableSequence || !ack.PendingCommandsDiscarded {
		return clone(), nil
	}
	if current.Phase == realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY {
		return clone(), nil
	}
	previous := proto.Clone(s.snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	ready := proto.Clone(current).(*realtimev2.PresenterInputSynchronization)
	ready.Phase = realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	if current.NextCommandEpoch != nil {
		s.commandEpoch = epoch
		s.outcomes = map[string]v2OutcomeRecord{}
		s.order = nil
	}
	ready.CommandEpoch = epoch
	ready.NextCommandEpoch = nil
	s.inputSynchronization = ready
	if err := s.commitV2Mutation(ctx, previous, nil); err != nil {
		return nil, err
	}
	return clone(), nil
}
func v3Rejected(id string, reason realtimev2.CommandRejectionReason) *realtimev2.CommandOutcome {
	return &realtimev2.CommandOutcome{ClientEventId: id, Result: &realtimev2.CommandOutcome_Rejected{Rejected: &realtimev2.CommandRejected{Reason: reason}}}
}
func (s *V2Session) admitV3Command(_ string, epoch uint64, ordinary bool, input *realtimev2.InputContext) realtimev2.CommandRejectionReason {
	if epoch != s.commandEpoch {
		return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_COMMAND_EPOCH_STALE
	}
	if ordinary {
		if s.inputSynchronization.Phase != realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY {
			return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_SYNCHRONIZATION_REQUIRED
		}
		if !proto.Equal(input, s.currentV3InputContext()) {
			return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_CONTEXT_STALE
		}
		if s.snapshot.Clock.GetRunning() == nil || s.snapshot.Progression.GetTransitioning() != nil {
			return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_NOT_ACCEPTING_INPUT
		}
	}
	recovery := s.v2Recovery()
	bytes := 0
	for _, record := range recovery.Commands {
		size := protocolv2.KnownSize(record)
		bytes += 1 + len(binary.AppendUvarint(nil, uint64(size))) + size
	}
	if len(recovery.Commands)+1 > protocolv2.MaximumCommandHistoryCount || bytes+v3MaximumRecordContribution > protocolv2.MaximumCommandHistoryBytes || s.reservedV3RecoverySize(recovery) > protocolv2.MaximumRecoveryMetadataBytes {
		return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_RUNTIME_CAPACITY_EXCEEDED
	}
	if ordinary && (len(recovery.Commands)+1 >= protocolv2.CommandHistorySyncCount || bytes+v3MaximumRecordContribution >= protocolv2.CommandHistorySyncBytes) {
		return realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_SYNCHRONIZATION_REQUIRED
	}
	return 0
}
func (s *V2Session) GestureInputContext(ctx context.Context, identity session.Identity, command *realtimev2.GestureInputCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if err := protocolv2.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
	return s.acceptInput(ctx, identity, v2Input{kind: "gesture", clientEventID: command.ClientEventId, originVersion: command.PresentationOriginVersion, commandEpoch: command.CommandEpoch, inputContext: command.InputContext, gesture: command.Gesture})
}
func (s *V2Session) ZoneInputContext(ctx context.Context, identity session.Identity, command *realtimev2.ZoneInputCommand) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	if err := protocolv2.ValidateMessage(command); err != nil {
		return nil, nil, err
	}
	return s.acceptInput(ctx, identity, v2Input{kind: "zoneEdge", clientEventID: command.ClientEventId, originVersion: command.PresentationOriginVersion, commandEpoch: command.CommandEpoch, inputContext: command.InputContext, zoneID: command.ZoneId, edge: command.Edge})
}
func v3Fingerprint(variant, id string, epoch, origin uint64, input *realtimev2.InputContext, values []string, enum uint32, selection *realtimev2.StepSelection) string {
	payload := []byte("unframe-command-v3\x00" + variant + "\x00")
	stringValue := func(value string) {
		payload = binary.BigEndian.AppendUint32(payload, uint32(len(value)))
		payload = append(payload, value...)
	}
	stringValue(id)
	payload = binary.BigEndian.AppendUint64(payload, epoch)
	payload = binary.BigEndian.AppendUint64(payload, origin)
	if input != nil {
		payload = binary.BigEndian.AppendUint64(payload, input.InputEpoch)
		stringValue(input.GroupId)
		payload = binary.BigEndian.AppendUint64(payload, input.GroupEntryEpoch)
		stringValue(input.StepId)
		payload = binary.BigEndian.AppendUint64(payload, input.StepEntryEpoch)
	}
	for _, value := range values {
		stringValue(value)
	}
	if enum != 0 {
		payload = binary.BigEndian.AppendUint32(payload, enum)
	}
	if selection != nil {
		stringValue(selection.GroupId)
		stringValue(selection.StepId)
	}
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:])
}
func v3InputFingerprint(input v2Input) string {
	variant := "logical_input"
	values := []string{input.logicalEventName}
	enum := uint32(0)
	switch input.kind {
	case "surfaceInteraction":
		variant = "surface_interaction"
		values = []string{input.surfaceID, input.interactionID}
	case "gesture":
		variant = "gesture_input"
		values = nil
		enum = uint32(input.gesture)
	case "zoneEdge":
		variant = "zone_input"
		values = []string{input.zoneID}
		enum = uint32(input.edge)
	}
	return v3Fingerprint(variant, input.clientEventID, input.commandEpoch, input.originVersion, input.inputContext, values, enum, nil)
}

func (s *V2Session) ensureV3CutSynchronization(previous *realtimev2.CanonicalRuntimeSnapshot) error {
	if !proto.Equal(s.inputSynchronization.InputContext, s.currentV3InputContext()) {
		if err := s.requireV3Synchronization(realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_STEP_ENTERED, false); err != nil {
			return err
		}
	}
	if s.committedRecovery == nil || s.inputSynchronization.SynchronizationRevision != s.committedRecovery.InputSynchronization.SynchronizationRevision {
		s.inputSynchronization.ReliableSequence = s.snapshot.ReliableSequence
	}
	return nil
}

func (s *V2Session) needsV3HistorySynchronization() bool {
	bytes := 0
	for _, record := range s.v2Recovery().Commands {
		size := protocolv2.KnownSize(record)
		bytes += 1 + len(binary.AppendUvarint(nil, uint64(size))) + size
	}
	return len(s.order)+1 >= protocolv2.CommandHistorySyncCount || bytes+v3MaximumRecordContribution >= protocolv2.CommandHistorySyncBytes
}

func (s *V2Session) resetV3TrackingForSynchronization(recovery *realtimev2.RuntimeRecoveryMetadata) {
	current := recovery.InputSynchronization
	if s.committedRecovery != nil && current.SynchronizationRevision == s.committedRecovery.InputSynchronization.SynchronizationRevision {
		return
	}
	switch current.Reason {
	case realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED, realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECALIBRATED, realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_PROCESS_RECOVERED:
		s.tracking = v2TrackingEvaluator{}
	}
}

func validateV3AuthorityDefinition(raw json.RawMessage) error {
	var definition struct {
		Stage struct {
			Zones map[string]map[string]json.RawMessage `json:"zones"`
		} `json:"stage"`
		Flow struct {
			Groups map[string]struct {
				Steps map[string]struct {
					Cues []struct {
						Trigger    map[string]json.RawMessage `json:"trigger"`
						FirePolicy map[string]json.RawMessage `json:"firePolicy"`
					} `json:"cues"`
				} `json:"steps"`
			} `json:"groups"`
		} `json:"flow"`
	}
	if json.Unmarshal(raw, &definition) != nil {
		return ErrV2RuntimeDefinition
	}
	for _, zone := range definition.Stage.Zones {
		if zone["size"] != nil {
			return ErrV2RuntimeDefinition
		}
	}
	for _, group := range definition.Flow.Groups {
		for _, step := range group.Steps {
			for _, cue := range step.Cues {
				if cue.FirePolicy["cooldownMilliseconds"] != nil {
					return ErrV2RuntimeDefinition
				}
				for _, key := range []string{"subject", "preset", "dwellMilliseconds", "hysteresisMeters", "minimumDistanceMeters", "windowMilliseconds"} {
					if cue.Trigger[key] != nil {
						return ErrV2RuntimeDefinition
					}
				}
			}
		}
	}
	return nil
}

const v3MaximumRecordContribution = protocolv2.MaximumCommandRecordBytes + 3

func (s *V2Session) reservedV3RecoverySize(recovery *realtimev2.RuntimeRecoveryMetadata) int {
	// Reserve the largest synchronization replacement as well as the next outcome.
	return protocolv2.KnownSize(recovery) - protocolv2.KnownSize(recovery.InputSynchronization) + protocolv2.MaximumInputSynchronizationBytes + 3 + v3MaximumRecordContribution
}
