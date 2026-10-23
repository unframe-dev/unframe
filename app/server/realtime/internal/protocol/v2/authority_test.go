package protocolv2

import (
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
)

func contextFixture() *realtime.InputContext {
	return &realtime.InputContext{InputEpoch: 1, GroupId: "group", GroupEntryEpoch: 1, StepId: "step", StepEntryEpoch: 1}
}
func synchronizationFixture() *realtime.PresenterInputSynchronization {
	return &realtime.PresenterInputSynchronization{Phase: 1, Reason: 1, SynchronizationRevision: 1, InputContext: contextFixture(), CommandEpoch: 1, RecognitionCatalog: &presentation.PresenterRecognitionCatalog{}}
}
func TestNormalCommandBindsContextAndEpoch(t *testing.T) {
	command := &realtime.GestureInputCommand{ClientEventId: "1:550e8400-e29b-41d4-a716-446655440000", CommandEpoch: 1, InputContext: contextFixture(), Gesture: 1}
	if err := ValidateMessage(command); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*realtime.GestureInputCommand){
		func(c *realtime.GestureInputCommand) { c.InputContext = nil },
		func(c *realtime.GestureInputCommand) { c.InputContext.InputEpoch = 0 },
		func(c *realtime.GestureInputCommand) { c.CommandEpoch = 2 },
		func(c *realtime.GestureInputCommand) { c.ClientEventId = "01:550e8400-e29b-41d4-a716-446655440000" },
		func(c *realtime.GestureInputCommand) { c.ClientEventId = "1:550E8400-e29b-41d4-a716-446655440000" },
		func(c *realtime.GestureInputCommand) { c.Gesture = 9 },
	} {
		c := proto.Clone(command).(*realtime.GestureInputCommand)
		mutate(c)
		if ValidateMessage(c) == nil {
			t.Fatalf("invalid command admitted: %v", c)
		}
	}
}

func TestControlSelectionAndSynchronizationPresence(t *testing.T) {
	command := &realtime.RuntimeControlCommand{ClientEventId: "1:550e8400-e29b-41d4-a716-446655440000", CommandEpoch: 1, Kind: 1}
	if err := ValidateMessage(command); err != nil {
		t.Fatal(err)
	}
	command.StepSelection = &realtime.StepSelection{GroupId: "group", StepId: "step"}
	if ValidateMessage(command) == nil {
		t.Fatal("pause with selection admitted")
	}
	command.Kind = 4
	if err := ValidateMessage(command); err != nil {
		t.Fatal(err)
	}
	command.StepSelection = nil
	if ValidateMessage(command) == nil {
		t.Fatal("select without selection admitted")
	}
	sync := synchronizationFixture()
	if err := ValidateMessage(sync); err != nil {
		t.Fatal(err)
	}
	sync.NextCommandEpoch = proto.Uint64(3)
	if ValidateMessage(sync) == nil {
		t.Fatal("skipped epoch admitted")
	}
	sync.NextCommandEpoch = proto.Uint64(2)
	if err := ValidateMessage(sync); err != nil {
		t.Fatal(err)
	}
	sync.Phase = 2
	if ValidateMessage(sync) == nil {
		t.Fatal("READY with next epoch admitted")
	}
	ack := &realtime.InputSynchronizationAck{SynchronizationRevision: 1, InputContext: contextFixture(), CommandEpoch: 1}
	if ValidateMessage(ack) == nil {
		t.Fatal("ACK without discard admitted")
	}
	ack.PendingCommandsDiscarded = true
	if err := ValidateMessage(ack); err != nil {
		t.Fatal(err)
	}
}

func TestCheckpointRejectsRecoveryFromAnotherInputCut(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	recovery, err := DecodeRecoveryMetadata(envelope)
	if err != nil {
		t.Fatal(err)
	}
	recovery.InputSynchronization.InputContext.InputEpoch = 2
	encoded := recoveryEnvelope(t, recovery)
	envelope.RecoveryPayload = encoded.RecoveryPayload
	envelope.RecoveryHash = encoded.RecoveryHash
	if _, err := DecodeCheckpoint(envelope, envelope, catalog); err == nil {
		t.Fatal("checkpoint with different input epoch accepted")
	}
}

func TestSerializedLimitsIncludeOuterItemAndIgnoreUnknownFields(t *testing.T) {
	nonce := &realtime.StateConnectionNonce{Nonce: make([]byte, MaximumControlItemBytes-10), ExpiresInMs: 1}
	item := &realtime.ControlServerItem{Item: &realtime.ControlServerItem_StateConnectionNonce{StateConnectionNonce: nonce}}
	// At this size both length prefixes occupy three bytes and expiry occupies two.
	if KnownSize(item) != MaximumControlItemBytes {
		t.Fatalf("fixture size: %d", KnownSize(item))
	}
	if err := ValidateMessage(item); err != nil {
		t.Fatal(err)
	}
	nonce.ProtoReflect().SetUnknown([]byte{0xa0, 0x06, 0x01})
	if err := ValidateMessage(item); err != nil {
		t.Fatal("unknown fields counted toward limit:", err)
	}
	nonce.Nonce = append(nonce.Nonce, 0)
	if ValidateMessage(item) == nil {
		t.Fatal("oversized outer item admitted")
	}
}

func TestFrozenAnchorsMustBelongToActiveFollowComponents(t *testing.T) {
	snapshot := snapshotFixture()
	snapshot.FrozenAnchors = []*realtime.FrozenAnchorDisplayState{{NodeId: "hidden", Position: &presentation.Vector3{}}}
	_, catalog := checkpointFixture(t)
	if ValidateSnapshot(snapshot, catalog, 1) == nil {
		t.Fatal("unknown frozen node admitted")
	}
}

func TestStepStartHistoryUsesItsOwnGroupAndClock(t *testing.T) {
	snapshot := snapshotFixture()
	snapshot.Clock.RuntimeTimeMs = 20
	snapshot.StepStartHistory = []*realtime.StepStartState{{GroupId: "previous", StepId: "prior", GroupEntryEpoch: 1, StepEntryEpoch: 1, CapturedAtRuntimeTimeMs: 10}}
	_, catalog := checkpointFixture(t)
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	snapshot.StepStartHistory[0].CapturedAtRuntimeTimeMs = 21
	if ValidateSnapshot(snapshot, catalog, 1) == nil {
		t.Fatal("future history capture admitted")
	}
}

func TestStepStartSerializedByteBoundary(t *testing.T) {
	value := &presentation.ScalarValue_StringValue{StringValue: strings.Repeat("x", 65511)}
	state := &realtime.StepStartState{GroupId: "g", StepId: "s", GroupEntryEpoch: 1, StepEntryEpoch: 1, Variables: []*realtime.VariableState{{VariableId: "v", Value: &presentation.ScalarValue{Value: value}}}}
	if KnownSize(state) != 65536 {
		t.Fatalf("fixture size: %d", KnownSize(state))
	}
	if err := ValidateMessage(state); err != nil {
		t.Fatal(err)
	}
	value.StringValue += "x"
	if ValidateMessage(state) == nil {
		t.Fatal("oversized Step start accepted")
	}
}

func TestRecoveryRequiresConsistentEpochsKeysAndOutcomeCut(t *testing.T) {
	metadata := &realtime.RuntimeRecoveryMetadata{StartedAt: "2026-10-22T00:00:00Z", Participants: []*realtime.RuntimeParticipantHistory{{ParticipantId: "presenter", Role: 1}}, CommandEpoch: 1, InputSynchronization: synchronizationFixture()}
	record := &realtime.RuntimeCommandHistory{ParticipantId: "presenter", ClientEventId: "1:550e8400-e29b-41d4-a716-446655440000", CommandEpoch: 1, Fingerprint: "sha256:" + strings.Repeat("a", 64), Outcome: &realtime.CommandOutcome{ClientEventId: "1:550e8400-e29b-41d4-a716-446655440000", Result: &realtime.CommandOutcome_NoOp{NoOp: &realtime.CommandNoOp{Reason: 1}}}}
	metadata.Commands = []*realtime.RuntimeCommandHistory{record}
	if _, err := DecodeRecoveryMetadata(recoveryEnvelope(t, metadata)); err != nil {
		t.Fatal(err)
	}
	for _, modify := range []func(*realtime.RuntimeRecoveryMetadata){
		func(r *realtime.RuntimeRecoveryMetadata) { r.CommandEpoch = 2 },
		func(r *realtime.RuntimeRecoveryMetadata) { r.Commands[0].CommandEpoch = 2 },
		func(r *realtime.RuntimeRecoveryMetadata) { r.Commands[0].Outcome.ClientEventId = "different" },
		func(r *realtime.RuntimeRecoveryMetadata) { r.Commands = append(r.Commands, r.Commands[0]) },
		func(r *realtime.RuntimeRecoveryMetadata) { r.InputSynchronization.ReliableSequence = 2 },
		func(r *realtime.RuntimeRecoveryMetadata) {
			r.Commands[0].Outcome.Result = &realtime.CommandOutcome_Accepted{Accepted: &realtime.CommandAccepted{CanonicalEventId: "event", ReliableSequence: 2}}
		},
	} {
		candidate := proto.Clone(metadata).(*realtime.RuntimeRecoveryMetadata)
		modify(candidate)
		if _, err := DecodeRecoveryMetadata(recoveryEnvelope(t, candidate)); err == nil {
			t.Fatalf("invalid recovery accepted: %v", candidate)
		}
	}
}

func TestLegacyMajorsAndMissingCapabilitiesFailClosed(t *testing.T) {
	for _, message := range []proto.Message{
		&realtime.ControlHandshake{ProtocolVersion: "v2", ProgressionContractVersion: 1, SupportedCapabilities: []presentation.RuntimeCapability{8, 9, 10}},
		&realtime.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: []presentation.RuntimeCapability{8, 9}},
		&realtime.CanonicalRuntimeSnapshot{SchemaVersion: 2},
		&presentation.ProjectedRuntimeCatalog{CatalogContractVersion: 2},
	} {
		if ValidateMessage(message) == nil {
			t.Fatalf("incompatible contract accepted: %v", message)
		}
	}
}

func TestCheckpointReaderIgnoresUnknownRecoveryFieldsButWriterRejectsThem(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	metadata, err := DecodeRecoveryMetadata(envelope)
	if err != nil {
		t.Fatal(err)
	}
	metadata.InputSynchronization.ProtoReflect().SetUnknown([]byte{0xa0, 0x06, 0x01})
	encoded := recoveryEnvelope(t, metadata)
	envelope.RecoveryPayload = encoded.RecoveryPayload
	envelope.RecoveryHash = encoded.RecoveryHash
	if _, err := DecodeCheckpoint(envelope, envelope, catalog); err != nil {
		t.Fatal("unknown optional field rejected on read:", err)
	}
	if _, err := EncodeCheckpoint(snapshotFixture(), envelope, catalog); err == nil {
		t.Fatal("unknown field written into canonical recovery payload")
	}
}

func TestAtomicReplacementViewUsesItsReliableEventCut(t *testing.T) {
	canonical := snapshotFixture()
	view := &realtime.ParticipantRuntimeView{ProjectionProfileId: "profile", AssignmentEpoch: 1, BaseReliableSequence: 3, Clock: canonical.Clock, Progression: canonical.Progression, PresentationOrigin: canonical.PresentationOrigin}
	event := &realtime.ProjectedReliableEvent{Sequence: 4, EventId: "event", Fence: &presentation.RuntimeProjectionFence{SessionId: "session", Publication: publication(), AssignmentEpoch: 1, ProjectionProfileId: "profile"}, Payload: &realtime.ProjectedReliableEvent_RuntimeViewReplaced{RuntimeViewReplaced: &realtime.RuntimeViewReplaced{RuntimeView: view}}}
	if ValidateMessage(event) == nil {
		t.Fatal("atomic replacement from another reliable cut accepted")
	}
	view.BaseReliableSequence = 4
	if err := ValidateMessage(event); err != nil {
		t.Fatal(err)
	}
}
