package grpc

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/runtimecore"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	grpcgo "google.golang.org/grpc"
)

func v3TestEventID(epoch uint64, label string) string {
	digest := sha256.Sum256([]byte(label))
	digest[6] = digest[6]&0x0f | 0x40
	digest[8] = digest[8]&0x3f | 0x80
	return fmt.Sprintf("%d:%x-%x-%x-%x-%x", epoch, digest[0:4], digest[4:6], digest[6:8], digest[8:10], digest[10:16])
}

func v3TestAck(state *realtimev2.PresenterInputSynchronization) *realtimev2.InputSynchronizationAck {
	epoch := state.CommandEpoch
	if state.NextCommandEpoch != nil {
		epoch = state.GetNextCommandEpoch()
	}
	return &realtimev2.InputSynchronizationAck{SynchronizationRevision: state.SynchronizationRevision, InputContext: state.InputContext, CommandEpoch: epoch, AppliedReliableSequence: state.ReliableSequence, PendingCommandsDiscarded: true}
}

func v3TestReady(t *testing.T, core *runtimecore.V2Session, identity session.Identity) {
	t.Helper()
	if state := core.InputSynchronization(); state != nil && state.Phase == realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED {
		if _, err := core.AcknowledgeInputSynchronization(context.Background(), identity, v3TestAck(state)); err != nil {
			t.Fatal(err)
		}
	}
}

func v3TestLogicalCommand(core *runtimecore.V2Session, label, name string) *realtimev2.LogicalInputCommand {
	state := core.InputSynchronization()
	return &realtimev2.LogicalInputCommand{ClientEventId: v3TestEventID(state.CommandEpoch, label), CommandEpoch: state.CommandEpoch, InputContext: state.InputContext, PresentationOriginVersion: core.Snapshot().PresentationOrigin.Version, LogicalEventName: name}
}

func v3TestLogicalInput(t *testing.T, core *runtimecore.V2Session, identity session.Identity, label, name string) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent, error) {
	t.Helper()
	v3TestReady(t, core, identity)
	return core.LogicalInput(identity, v3TestLogicalCommand(core, label, name))
}

type v3SynchronizedTestClient struct {
	grpcgo.BidiStreamingClient[realtimev2.ControlClientItem, realtimev2.ControlServerItem]
}

func v3TestConnectControl(ctx context.Context, client realtimev2.RealtimeServiceClient) (grpcgo.BidiStreamingClient[realtimev2.ControlClientItem, realtimev2.ControlServerItem], error) {
	stream, err := client.ConnectControl(ctx)
	if err != nil {
		return nil, err
	}
	return &v3SynchronizedTestClient{stream}, nil
}

func (c *v3SynchronizedTestClient) Recv() (*realtimev2.ControlServerItem, error) {
	for {
		item, err := c.BidiStreamingClient.Recv()
		if err != nil {
			return item, err
		}
		if item.GetPresenterStepSelectionCatalog() != nil {
			continue
		}
		state := item.GetPresenterInputSynchronization()
		if state == nil {
			return item, nil
		}
		if state.Phase == realtimev2.InputSynchronizationPhase_INPUT_SYNCHRONIZATION_PHASE_REQUIRED {
			if err := c.Send(&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_InputSynchronizationAck{InputSynchronizationAck: v3TestAck(state)}}); err != nil {
				return nil, err
			}
		}
	}
}
