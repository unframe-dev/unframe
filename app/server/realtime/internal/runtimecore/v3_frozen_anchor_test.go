package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

const v3FrozenDefinition = `{"schemaVersion":3,"presentationId":"presentation-1","scene":{"nodes":{"badge":{"id":"badge","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"anchor","target":"body","followPosition":true,"followRotation":false},"active":true,"visible":true,"opacity":1,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]}},"missing":{"id":"missing","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"anchor","target":"leftHand","followPosition":true,"followRotation":true},"active":true,"visible":true,"opacity":1,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]}}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`

func v3FrozenCore(t *testing.T) (*V2Session, *recordingV2Checkpoint) {
	t.Helper()
	core, err := newV3RegressionSession(json.RawMessage(v3FrozenDefinition))
	if err != nil {
		t.Fatal(err)
	}
	base, _ := reviewSession(t)
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, base.checkpointMetadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	return core, writer
}
func v3SeedAnchor(t *testing.T, core *V2Session, sequence uint64, x float64) {
	t.Helper()
	frame := trackingTestFrame(sequence, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(x, 0, 0)))
	if _, _, err := core.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, frame, time.Now(), sequence); err != nil {
		t.Fatal(err)
	}
}
func v3FrozenControl(t *testing.T, core *V2Session, id string, kind realtimev2.RuntimeControlKind) []*realtimev2.ProjectedReliableEvent {
	t.Helper()
	_, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: id, Kind: kind}))
	if err != nil {
		t.Fatal(err)
	}
	return events
}
func TestV3PausePersistsAvailableAnchorAndPublishesAtomicReplacement(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	events := v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	snapshot := core.Snapshot()
	if len(snapshot.FrozenAnchors) != 1 || snapshot.FrozenAnchors[0].NodeId != "badge" || snapshot.FrozenAnchors[0].Position.X != 3 || snapshot.FrozenAnchors[0].Rotation != nil {
		t.Fatalf("frozen=%v", snapshot.FrozenAnchors)
	}
	if len(events) != 1 || events[0].GetRuntimeViewReplaced() == nil || events[0].GetRuntimeViewReplaced().RuntimeView.BaseReliableSequence != events[0].Sequence {
		t.Fatalf("pause events=%v", events)
	}
	flushV2(t, core)
	if writer.envelope == nil {
		t.Fatal("frozen Anchor not persisted")
	}
	patches, err := core.ProjectedAnchorBindings(snapshot.NodeStates, 100000)
	if err != nil || patches[0].GetFrozen() == nil || patches[1].GetUnavailable() == nil {
		t.Fatalf("aged patches=%v error=%v", patches, err)
	}
}

func TestV3ResumeThawsOnValidPoseDespiteSaveFailure(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	core.tracking = v2TrackingEvaluator{}
	v3FrozenControl(t, core, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	patches, err := core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 100000)
	if err != nil || patches[0].GetFrozen() == nil {
		t.Fatalf("waiting patches=%v error=%v", patches, err)
	}
	core.checkpointWriter = failingV2Checkpoint{}
	frame := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(7, 0, 0)))
	if _, _, err := core.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, frame, time.Now(), 2); err != nil {
		t.Fatal(err)
	}
	if err := core.FlushCheckpoint(context.Background()); err == nil {
		t.Fatal("expected save failure")
	}
	core.checkpointWriter = writer
	if len(core.Snapshot().FrozenAnchors) != 0 {
		t.Fatal("fresh Pose did not clear canonical frozen state")
	}
	patches, err = core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 2)
	if err != nil || patches[0].GetSample().GetPosition().GetX() != 7 {
		t.Fatalf("fresh patches=%v error=%v", patches, err)
	}
	patches, err = core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 503)
	if err != nil || patches[0].GetUnavailable() == nil {
		t.Fatalf("expired thaw patches=%v error=%v", patches, err)
	}
}

func TestV3PausedTrackingDoesNotMoveFrozenDisplayAndResumeUsesFreshPose(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	flushV2(t, core)
	sequence := writer.envelope.CheckpointSequence
	v3SeedAnchor(t, core, 2, 7)
	patches, err := core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 2)
	if err != nil || patches[0].GetFrozen().GetPosition().GetX() != 3 || writer.envelope.CheckpointSequence != sequence {
		t.Fatalf("paused tracking patches=%v error=%v", patches, err)
	}
	events := v3FrozenControl(t, core, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	if len(events) != 1 || events[0].GetRuntimeStatusChanged().GetRunning() == nil || len(core.Snapshot().FrozenAnchors) != 0 {
		t.Fatal("resume did not use fresh Pose")
	}
	patches, err = core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 2)
	if err != nil || patches[0].GetSample().GetPosition().GetX() != 7 {
		t.Fatalf("resumed tracking patches=%v error=%v", patches, err)
	}
	flushV2(t, core)
	persisted := &realtimev2.CanonicalRuntimeSnapshot{}
	if err := proto.Unmarshal(writer.envelope.CanonicalSnapshotPayload, persisted); err != nil {
		t.Fatal(err)
	}
	if len(persisted.FrozenAnchors) != 0 {
		t.Fatal("resume thaw was not persisted")
	}
}

func TestV3PauseSnapshotReplayAndRecoveryKeepFrozenWithoutRawPose(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	flushV2(t, core)
	checkpoint := proto.Clone(writer.envelope).(*realtimev2.DurableCheckpointEnvelope)
	v3SeedAnchor(t, core, 2, 7)
	replay, err := core.Replay(0)
	if err != nil || len(replay) != 1 || replay[0].GetRuntimeViewReplaced().RuntimeView.FrozenAnchors[0].Position.X != 3 {
		t.Fatalf("replay=%v error=%v", replay, err)
	}
	restored, _ := v3FrozenCore(t)
	if err := restored.RestoreCheckpoint(checkpoint); err != nil {
		t.Fatal(err)
	}
	if len(restored.tracking.lastSamples) != 0 {
		t.Fatal("recovery persisted raw Pose")
	}
	if err := restored.JoinParticipant(context.Background(), session.Identity{Role: session.RoleViewer, ParticipantID: "late-viewer"}); err != nil {
		t.Fatal(err)
	}
	patches, err := restored.ProjectedAnchorBindings(restored.Snapshot().NodeStates, 1<<40)
	if err != nil || patches[0].GetFrozen().GetPosition().GetX() != 3 {
		t.Fatalf("recovered binding=%v error=%v", patches, err)
	}
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "late-viewer", VisibleNodeIds: []string{"badge", "missing"}, RuntimeCatalog: restored.validationCatalog}
	view, err := ProjectV2Snapshot(restored.Snapshot(), profile, 1, nil)
	if err != nil || len(view.FrozenAnchors) != 1 || view.FrozenAnchors[0].Position.X != 3 || view.Clock.GetPaused() == nil {
		t.Fatalf("late join view=%v error=%v", view, err)
	}
}

func TestV3FrozenProjectionFiltersHiddenNodeAndKeepsReplacementCut(t *testing.T) {
	core, _ := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	events := v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "hidden", VisibleNodeIds: []string{"missing"}, RuntimeCatalog: &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 3}}
	projected, visible := ProjectV2ReliableEvent(events[0], profile)
	if !visible || projected.GetRuntimeViewReplaced() == nil {
		t.Fatal("replacement event dropped")
	}
	view := projected.GetRuntimeViewReplaced().RuntimeView
	if len(view.NodeStates) != 1 || view.NodeStates[0].NodeId != "missing" || len(view.FrozenAnchors) != 0 || view.BaseReliableSequence != projected.Sequence || view.ProjectionProfileId != "hidden" {
		t.Fatalf("hidden replacement=%v", view)
	}
	snapshotView, err := ProjectV2Snapshot(core.Snapshot(), profile, 1, nil)
	if err != nil || !proto.Equal(view, snapshotView) {
		t.Fatalf("replacement differs from same-cut snapshot: %v", err)
	}
	if len(events[0].GetRuntimeViewReplaced().RuntimeView.FrozenAnchors) != 1 {
		t.Fatal("profile projection mutated canonical replay")
	}
}

func TestV3PausePublishesFrozenDisplayDespiteSaveFailure(t *testing.T) {
	core, _ := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	core.checkpointWriter = failingV2Checkpoint{}
	_, stream, closeSub := core.SnapshotAndSubscribe()
	defer closeSub()
	out, events, err := core.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestRuntimeControl(core, &realtimev2.RuntimeControlCommand{ClientEventId: "pause", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE}))
	if err != nil || out.GetAccepted() == nil || len(events) != 1 || len(core.Snapshot().FrozenAnchors) != 1 || core.Snapshot().ReliableSequence != 1 || len(core.outcomes) != 1 {
		t.Fatalf("pause memory commit: %v %v", out, err)
	}
	if err := core.FlushCheckpoint(context.Background()); err == nil {
		t.Fatal("expected save failure")
	}
	select {
	case event := <-stream:
		if event.GetRuntimeViewReplaced() == nil {
			t.Fatal("replacement missing")
		}
	default:
		t.Fatal("committed replacement missing")
	}

}

func TestV3PausedBindingCutRejectsOlderSnapshot(t *testing.T) {
	core, _ := v3FrozenCore(t)
	before := core.Snapshot()
	v3SeedAnchor(t, core, 1, 3)
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	if _, err := core.ProjectedAnchorBindingsAtCut(before.NodeStates, 1, before.ReliableSequence); err != ErrV3StateCutChanged {
		t.Fatalf("old State cut error=%v", err)
	}
	current := core.Snapshot()
	patches, err := core.ProjectedAnchorBindingsAtCut(current.NodeStates, 1, current.ReliableSequence)
	if err != nil || patches[0].GetFrozen() == nil {
		t.Fatalf("current State cut=%v error=%v", patches, err)
	}
}

func TestV3PauseDoesNotInventUnavailableOrExpiredAnchor(t *testing.T) {
	for _, available := range []bool{false, true} {
		t.Run(fmt.Sprint(available), func(t *testing.T) {
			core, _ := v3FrozenCore(t)
			if available {
				v3SeedAnchor(t, core, 1, 3)
				sample := core.tracking.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY]
				sample.ReceivedAt = time.Now().Add(-501 * time.Millisecond)
				core.tracking.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY] = sample
			}
			v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
			if len(core.Snapshot().FrozenAnchors) != 0 {
				t.Fatal("unavailable Anchor was invented")
			}
			patches, err := core.ProjectedAnchorBindings(core.Snapshot().NodeStates, 1)
			if err != nil || patches[0].GetUnavailable() == nil {
				t.Fatalf("unavailable patches=%v error=%v", patches, err)
			}
		})
	}
}

func TestV3RuntimeViewProjectionExposesInputsOnlyToPresenter(t *testing.T) {
	core, _ := v3FrozenCore(t)
	for _, role := range []presentationv2.SessionRole{presentationv2.SessionRole_SESSION_ROLE_VIEWER, presentationv2.SessionRole_SESSION_ROLE_PRESENTER} {
		t.Run(role.String(), func(t *testing.T) {
			profile := &deliveryv2.ProjectionProfileDescriptor{ProjectionProfileId: "profile", Key: &deliveryv2.ProjectionProfileKey{Role: role}, RuntimeCatalog: core.validationCatalog, VisibleNodeIds: []string{"badge", "missing"}}
			view, err := ProjectV2Snapshot(core.Snapshot(), profile, 1, []string{"next"})
			if err != nil {
				t.Fatal(err)
			}
			if role == presentationv2.SessionRole_SESSION_ROLE_VIEWER && len(view.EnabledLogicalInputs) != 0 {
				t.Fatal("Viewer received Presenter inputs")
			}
			if role == presentationv2.SessionRole_SESSION_ROLE_PRESENTER && len(view.EnabledLogicalInputs) != 1 {
				t.Fatal("Presenter input projection missing")
			}
		})
	}
}

func TestV3FrozenAnchorContainsOnlyConfiguredRotation(t *testing.T) {
	raw := strings.Replace(v3FrozenDefinition, `"followPosition":true,"followRotation":false`, `"followPosition":false,"followRotation":true`, 1)
	core, err := NewV2Session(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	sample := trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(3, 0, 0))
	sample.PositionAvailable = false
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), sample)
	if _, _, err := core.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, frame, time.Now(), 1); err != nil {
		t.Fatal(err)
	}
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	frozen := core.Snapshot().FrozenAnchors
	if len(frozen) != 1 || frozen[0].Position != nil || frozen[0].Rotation == nil || frozen[0].Rotation.W != 1 {
		t.Fatalf("rotation frozen=%v", frozen)
	}
}

func TestV3ReconnectPersistsFrozenBeforeDiscardingRawPose(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	_, stream, closeSub := core.SnapshotAndSubscribe()
	defer closeSub()
	if err := core.BeginInputSynchronization(context.Background(), realtimev2.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_RECONNECTED, true); err != nil {
		t.Fatal(err)
	}
	if len(core.tracking.lastSamples) != 0 || len(core.Snapshot().FrozenAnchors) != 1 {
		t.Fatal("reconnect did not preserve display while discarding raw Pose")
	}
	select {
	case event := <-stream:
		if event.GetRuntimeViewReplaced() == nil || event.GetRuntimeViewReplaced().RuntimeView.FrozenAnchors[0].Position.X != 3 {
			t.Fatalf("reconnect event=%v", event)
		}
	default:
		t.Fatal("reconnect replacement missing")
	}
	flushV2(t, core)
	persisted := &realtimev2.CanonicalRuntimeSnapshot{}
	if err := proto.Unmarshal(writer.envelope.CanonicalSnapshotPayload, persisted); err != nil {
		t.Fatal(err)
	}
	if len(persisted.FrozenAnchors) != 1 || persisted.FrozenAnchors[0].Position.X != 3 {
		t.Fatal("reconnect frozen display not persisted")
	}
}

func TestV3LeaseExpiryFreezesLocallyWithoutPublishingUnfencedMutation(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	_, stream, closeSub := core.SnapshotAndSubscribe()
	defer closeSub()
	core.PauseLeaseExpired()
	snapshot := core.Snapshot()
	if snapshot.Clock.GetPaused() == nil || len(snapshot.FrozenAnchors) != 1 || snapshot.FrozenAnchors[0].Position.X != 3 || writer.envelope != nil || snapshot.ReliableSequence != 0 {
		t.Fatalf("lease pause=%v", snapshot)
	}
	select {
	case event := <-stream:
		t.Fatalf("lease-expired runtime published event: %v", event)
	default:
	}
}

func TestV3PauseStopsAllLogicalProgressionAtReplacementClock(t *testing.T) {
	core, _ := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	if _, err := core.AdvanceTo(context.Background(), 250); err != nil {
		t.Fatal(err)
	}
	events := v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	before := core.Snapshot()
	view := events[0].GetRuntimeViewReplaced().RuntimeView
	if view.Clock.RuntimeTimeMs != 250 || !proto.Equal(view.Clock, before.Clock) {
		t.Fatal("replacement clock differs from canonical pause boundary")
	}
	if _, err := core.AdvanceFromWall(context.Background(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := core.AdvanceTo(context.Background(), 100000); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(before, core.Snapshot()) {
		t.Fatal("paused progression or clock advanced")
	}
}

func TestV3PausePreservesTimelineTimerMediaAndModelAtOneLogicalCut(t *testing.T) {
	raw := strings.Replace(v3FrozenDefinition, `"nodes":{`, `"nodes":{"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"host":{"id":"host","kind":"surface","surfaceId":"screen","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},`, 1)
	raw = strings.Replace(raw, `"surfaces":{}`, `"surfaces":{"screen":{"id":"screen","hostNodeId":"host","initialStateId":"idle","states":{"idle":{"id":"idle","enabledInteractionIds":[]}},"content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}`, 1)
	raw = strings.Replace(raw, `"cues":[]`, `"cues":[{"id":"play","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"play"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"fade","completion":"nonBlocking"},{"kind":"media.play","surfaceId":"screen"},{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":1,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}},{"id":"timer","trigger":{"kind":"timer","afterMilliseconds":1000},"firePolicy":{"kind":"oncePerStepEntry"},"next":{"kind":"stay"}}]`, 1)
	raw = strings.Replace(raw, `"timelines":{}`, `"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":1000,"tracks":[{"target":{"nodeId":"host","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":1000,"value":1}]}]}}`, 1)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"screen":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":1000,"loop":false}},"stateBindings":{"idle":{"kind":"artifacts","artifactIds":["video"]}}}}}},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":0,"durationMilliseconds":1000}}}}}`)
	core, err := newV3RegressionSessionWithBundle(json.RawMessage(raw), bundle)
	if err != nil {
		t.Fatal(err)
	}
	base, _ := reviewSession(t)
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, base.checkpointMetadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	outcome, _ := v2MediaActorInput(t, core, "play", "play")
	if outcome.GetAccepted().GetCueCommitted() == nil || len(core.Snapshot().ActiveRuns) != 3 {
		t.Fatalf("play outcome=%v runs=%v", outcome, core.Snapshot().ActiveRuns)
	}
	if _, err := core.AdvanceTo(context.Background(), 250); err != nil {
		t.Fatal(err)
	}
	v3SeedAnchor(t, core, 1, 3)
	events := v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	paused := core.Snapshot()
	view := events[0].GetRuntimeViewReplaced().RuntimeView
	if paused.Clock.RuntimeTimeMs != 250 || len(view.ActiveRuns) != 3 || len(paused.StepExecution.Timers) != 1 || paused.StepExecution.Timers[0].Fired {
		t.Fatal("pause did not preserve active execution")
	}
	for _, run := range view.ActiveRuns {
		switch {
		case run.GetTimeline() != nil:
			if view.Clock.RuntimeTimeMs-run.StartedAtRuntimeTimeMs != 250 {
				t.Fatal("timeline playhead differs from pause clock")
			}
		case run.GetMedia() != nil:
			playing := run.GetMedia().Playback.GetPlaying()
			if playing.PositionAtReferenceMs+float64(view.Clock.RuntimeTimeMs-playing.ReferenceRuntimeTimeMs) != 250 {
				t.Fatal("media playhead differs from pause clock")
			}
		case run.GetModelClip() != nil:
			playing := run.GetModelClip().GetSingle().Playback.GetPlaying()
			if playing.PositionAtReferenceMs+float64(view.Clock.RuntimeTimeMs-playing.ReferenceRuntimeTimeMs) != 250 {
				t.Fatal("model playhead differs from pause clock")
			}
		default:
			t.Fatalf("unexpected run=%v", run)
		}
	}
	if _, err := core.AdvanceTo(context.Background(), 5000); err != nil {
		t.Fatal(err)
	}
	if _, err := core.AdvanceFromWall(context.Background(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	v3SeedAnchor(t, core, 2, 9)
	if !proto.Equal(paused, core.Snapshot()) {
		t.Fatal("paused Timer/Timeline/Media/Model/Anchor state advanced")
	}
	flushV2(t, core)
	persisted := &realtimev2.CanonicalRuntimeSnapshot{}
	if err := proto.Unmarshal(writer.envelope.CanonicalSnapshotPayload, persisted); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(paused, persisted) {
		t.Fatal("checkpoint differs from paused execution cut")
	}
}

func TestV3FrozenDisplayDropsWhenItsGroupResourceExits(t *testing.T) {
	raw := strings.Replace(v3FrozenDefinition, `"owner":{"kind":"presentation"}`, `"owner":{"kind":"group","groupId":"intro"}`, 1)
	raw = strings.Replace(raw, `"cues":[]`, `"cues":[{"id":"advance","trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"advance"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"group","groupId":"next"}}]`, 1)
	raw = strings.Replace(raw, `"groups":{"intro":`, `"groups":{"next":{"id":"next","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}},"intro":`, 1)
	core, err := newV3RegressionSession(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	base, _ := reviewSession(t)
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, base.checkpointMetadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	v3SeedAnchor(t, core, 1, 3)
	v3FrozenControl(t, core, "pause", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	core.tracking = v2TrackingEvaluator{}
	v3FrozenControl(t, core, "resume", realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME)
	outcome, _, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, v3TestLogicalInput(core, &realtimev2.LogicalInputCommand{ClientEventId: "advance", LogicalEventName: "advance"}))
	if err != nil || outcome.GetAccepted().GetCueCommitted() == nil || core.Snapshot().Progression.CurrentGroupId != "next" || len(core.Snapshot().FrozenAnchors) != 0 {
		t.Fatalf("exited group retained frozen state: outcome=%v error=%v", outcome, err)
	}
}
