package runtimecore

import (
	"context"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"testing"
)

type checkpointCommitObserver func(*realtimev2.DurableCheckpointEnvelope) error

func (observe checkpointCommitObserver) WriteCheckpoint(_ context.Context, envelope *realtimev2.DurableCheckpointEnvelope) error {
	return observe(envelope)
}

func flushV2(t *testing.T, core *V2Session) {
	t.Helper()
	if err := core.FlushCheckpoint(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestCheckpointContainsMemoryCommittedOutcomeAndEventCut(t *testing.T) {
	core, writer := reviewSession(t)
	_, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}))
	if err != nil || len(events) != 1 {
		t.Fatalf("commit: %v %v", events, err)
	}
	if writer.envelope != nil {
		t.Fatal("normal mutation performed synchronous write")
	}
	flushV2(t, core)
	decoded, err := protocolv2.DecodeCheckpoint(writer.envelope, core.checkpointMetadata, core.checkpointCatalog)
	recovery, recoveryErr := protocolv2.DecodeRecoveryMetadata(writer.envelope)
	if err != nil || recoveryErr != nil || decoded.ReliableSequence != events[0].Sequence || len(recovery.Commands) != 1 {
		t.Fatalf("inconsistent cut: %v %v %v", decoded, err, recoveryErr)
	}
}
