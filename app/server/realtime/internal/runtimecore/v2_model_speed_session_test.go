package runtimecore

import (
	"context"
	"encoding/json"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestV2ModelSessionRejectsTinySpeedWithoutAllocatingRun(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","priority":1,"order":0,"trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"play"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":1e-300,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	bundle := json.RawMessage(`{"schemaVersion":1,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125}}}}}`)
	core, err := newV3RegressionSessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 1, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}

	before := core.Snapshot()
	command := v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "tiny-play", LogicalEventName: "play"})
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, command)
	if err != nil {
		t.Fatal(err)
	}
	rejected := outcome.GetAccepted().GetCueBatchRejected().GetReason() == realtimev2.CueRejectionReason_CUE_REJECTION_REASON_RESOLVED_VALUE_INVALID
	for _, event := range events {
		if event.GetModelClipStarted() != nil {
			t.Fatal("rejected play emitted start")
		}
	}
	after := core.Snapshot()
	if !rejected || after.LastAllocatedRunSequence != before.LastAllocatedRunSequence || len(after.ActiveRuns) != 0 || !proto.Equal(after.ModelClipStates[0], before.ModelClipStates[0]) {
		t.Fatalf("events=%v snapshot=%v", events, after)
	}
	_, _, err = core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, command)
	if err != nil || !proto.Equal(after, core.Snapshot()) {
		t.Fatalf("retry changed snapshot: %v", err)
	}
	if _, err = core.AdvanceTo(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
}
