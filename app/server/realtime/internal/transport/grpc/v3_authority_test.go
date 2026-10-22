package grpc

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"google.golang.org/protobuf/proto"
)

func TestV3ControlSynchronizesPresenterAndDispatchesRecognizedInputs(t *testing.T) {
	service, profile := newV2LeaseTestService(t, allowAllAssignment{})
	definition := json.RawMessage(`{"schemaVersion":3,"presentationId":"presentation-1","stage":{"zones":{"here":{"id":"here","owner":{"kind":"presentation"},"center":[0,0,0]}}},"scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"swipe","priority":1,"order":0,"trigger":{"kind":"gesture","actor":{"kind":"presenter"},"gesture":"swipeLeft"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}},{"id":"enter","priority":1,"order":1,"trigger":{"kind":"zoneEdge","actor":{"kind":"presenter"},"zoneId":"here","edge":"enter"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := runtimecore.NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	service.runtime = core
	service.bootstrap.Definition = definition
	profile.RequiredRuntimeCapabilities = []presentationv2.RuntimeCapability{1, 7, 8, 9, 10}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	input := make(chan *realtimev2.ControlClientItem, 16)
	output := make(chan *realtimev2.ControlServerItem, 32)
	stream := &v2LeaseStream[realtimev2.ControlClientItem, realtimev2.ControlServerItem]{ctx: ctx, receive: func() (*realtimev2.ControlClientItem, error) {
		select {
		case item := <-input:
			return item, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, send: func(item *realtimev2.ControlServerItem) error {
		select {
		case output <- item:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	done := make(chan error, 1)
	go func() { done <- service.ConnectControl(stream) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("control did not close")
		}
	})
	next := func(match func(*realtimev2.ControlServerItem) bool) *realtimev2.ControlServerItem {
		t.Helper()
		for {
			select {
			case item := <-output:
				if match(item) {
					return item
				}
			case err := <-done:
				t.Fatalf("control closed: %v", err)
			case <-ctx.Done():
				t.Fatal("control response timed out")
			}
		}
	}
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{Handshake: &realtimev2.ControlHandshake{ProtocolVersion: "v3", ProgressionContractVersion: 2, SupportedCapabilities: profile.RequiredRuntimeCapabilities}}}
	snapshot := next(func(i *realtimev2.ControlServerItem) bool { return i.GetConnectionSnapshot() != nil }).GetConnectionSnapshot()
	required := next(func(i *realtimev2.ControlServerItem) bool { return i.GetPresenterInputSynchronization() != nil }).GetPresenterInputSynchronization()
	if required.Phase != realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED || required.ReliableSequence > snapshot.ReliableSequence || len(required.RecognitionCatalog.Gestures) != 1 || len(required.RecognitionCatalog.Zones) != 1 {
		t.Fatalf("initial input synchronization: %v", required)
	}
	command := &realtimev2.GestureInputCommand{ClientEventId: v3TestEventID(required.CommandEpoch, "gesture"), CommandEpoch: required.CommandEpoch, InputContext: required.InputContext, PresentationOriginVersion: snapshot.Fence.PresentationOriginVersion, Gesture: presentationv2.GestureKind_GESTURE_KIND_SWIPE_LEFT}
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_GestureInput{GestureInput: command}}
	outcome := next(func(i *realtimev2.ControlServerItem) bool { return i.GetCommandOutcome() != nil }).GetCommandOutcome()
	if outcome.GetRejected().GetReason() != realtimev2.CommandRejectionReason_COMMAND_REJECTION_REASON_INPUT_SYNCHRONIZATION_REQUIRED {
		t.Fatalf("input before ACK: %v", outcome)
	}
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_InputSynchronizationAck{InputSynchronizationAck: v3TestAck(required)}}
	ready := next(func(i *realtimev2.ControlServerItem) bool {
		return i.GetPresenterInputSynchronization().GetPhase() == realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_READY
	}).GetPresenterInputSynchronization()
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_GestureInput{GestureInput: command}}
	accepted := next(func(i *realtimev2.ControlServerItem) bool { return i.GetCommandOutcome() != nil }).GetCommandOutcome()
	if accepted.GetAccepted().GetCueCommitted().GetCueId() != "swipe" {
		t.Fatalf("recognized gesture: %v", accepted)
	}
	command.CapturedAtClientMonotonicMs = proto.Uint64(999999)
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_GestureInput{GestureInput: command}}
	replayed := next(func(i *realtimev2.ControlServerItem) bool { return i.GetCommandOutcome() != nil }).GetCommandOutcome()
	if !proto.Equal(accepted, replayed) {
		t.Fatalf("response-loss retry changed outcome: %v", replayed)
	}
	input <- &realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_ZoneInput{ZoneInput: &realtimev2.ZoneInputCommand{ClientEventId: v3TestEventID(ready.CommandEpoch, "zone"), CommandEpoch: ready.CommandEpoch, InputContext: ready.InputContext, PresentationOriginVersion: snapshot.Fence.PresentationOriginVersion, ZoneId: "here", Edge: presentationv2.ZoneEdge_ZONE_EDGE_ENTER}}}
	zone := next(func(i *realtimev2.ControlServerItem) bool { return i.GetCommandOutcome() != nil }).GetCommandOutcome()
	if zone.GetAccepted().GetCueCommitted().GetCueId() != "enter" {
		t.Fatalf("recognized zone: %v", zone)
	}
}

func TestV3ProtocolLimitsAdvertiseDurableSynchronizationBounds(t *testing.T) {
	limits := v2ProtocolLimits()
	if limits.MaximumCommandHistoryCount != 1024 || limits.CommandHistorySyncCount != 1000 || limits.MaximumCommandHistoryBytes != 262144 || limits.CommandHistorySyncBytes != 245760 || limits.MaximumCheckpointJsonBytes != 1572864 || limits.MaximumInputSynchronizationBytes != 4096 {
		t.Fatalf("v3 limits: %v", limits)
	}
}
