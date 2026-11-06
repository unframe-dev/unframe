package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestTrackedPoseProjectionDoesNotRequireAnchorAndExpires(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}}},"variables":{},"timelines":{}}`)
	core, err := newV3RegressionSession(definition)
	if err != nil {
		t.Fatal(err)
	}
	targets := []presentation.AnchorTarget{presentation.AnchorTarget_ANCHOR_TARGET_LEFT_HAND, presentation.AnchorTarget_ANCHOR_TARGET_RIGHT_HAND}
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtime.TrackedTarget_TRACKED_TARGET_LEFT_HAND, trackingTestPose(3, 0, 0)))
	if _, _, err := core.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter}, frame, time.Unix(100, 0), 1); err != nil {
		t.Fatal(err)
	}
	poses, _, err := core.ProjectedTrackedPosesAtCut(targets, nil, 501, core.Snapshot().ReliableSequence)
	if err != nil || len(poses) != 2 || poses[0].GetSample().GetPosition().GetX() != 3 || poses[1].GetUnavailable() == nil {
		t.Fatalf("fresh poses=%v err=%v", poses, err)
	}
	poses, _, err = core.ProjectedTrackedPosesAtCut(targets, nil, 502, core.Snapshot().ReliableSequence)
	if err != nil || poses[0].GetUnavailable() == nil {
		t.Fatalf("expired poses=%v err=%v", poses, err)
	}
}

func TestTrackingRejectsInputBeforeSynchronization(t *testing.T) {
	core, _ := v3FrozenCore(t)
	identity := session.Identity{Role: session.RolePresenter}
	old := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtime.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(3, 0, 0)))
	old.InputEpoch = core.Snapshot().InputEpoch
	old.BaseReliableSequence = core.Snapshot().ReliableSequence
	if err := core.BeginInputSynchronization(context.Background(), realtime.InputSynchronizationReason_INPUT_SYNCHRONIZATION_REASON_HISTORY_CAPACITY, false); err != nil {
		t.Fatal(err)
	}
	if samples, _, err := core.AcceptTracking(context.Background(), identity, old, time.Now(), 1); err != nil || len(samples) != 0 {
		t.Fatalf("stale epoch accepted: %v %v", samples, err)
	}
	old.InputEpoch = core.Snapshot().InputEpoch + 1
	if _, _, err := core.AcceptTracking(context.Background(), identity, old, time.Now(), 2); err == nil {
		t.Fatal("future epoch accepted")
	}
	old.InputEpoch = 0
	if _, _, err := core.AcceptTracking(context.Background(), identity, old, time.Now(), 3); err == nil {
		t.Fatal("missing epoch accepted")
	}
}

func TestTrackingRejectsFrameCapturedBeforeReplacementWhileWaiting(t *testing.T) {
	core, _ := v3FrozenCore(t)
	identity := session.Identity{Role: session.RolePresenter}
	before := core.Snapshot()
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtime.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(3, 0, 0)))
	frame.InputEpoch, frame.BaseReliableSequence = before.InputEpoch, before.ReliableSequence
	core.operationMu.Lock()
	done := make(chan error, 1)
	go func() {
		samples, _, err := core.AcceptTracking(context.Background(), identity, frame, time.Now(), 1)
		if err == nil && len(samples) != 0 {
			err = fmt.Errorf("pre-replacement sample accepted")
		}
		done <- err
	}()
	core.mu.Lock()
	event := core.nextEvent(&realtime.ProjectedReliableEvent{Payload: &realtime.ProjectedReliableEvent_RuntimeViewReplaced{RuntimeViewReplaced: &realtime.RuntimeViewReplaced{}}})
	core.publishV2Events([]*realtime.ProjectedReliableEvent{event})
	core.mu.Unlock()
	core.operationMu.Unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	frame.BaseReliableSequence = event.Sequence
	samples, _, err := core.AcceptTracking(context.Background(), identity, frame, time.Now(), 2)
	if err != nil || len(samples) != 1 {
		t.Fatalf("current cut rejected: %v %v", samples, err)
	}
	frame.FrameSequence++
	frame.BaseReliableSequence++
	if _, _, err := core.AcceptTracking(context.Background(), identity, frame, time.Now(), 3); err == nil {
		t.Fatal("future reliable cut accepted")
	}
}

func TestTrackingProfileRequiresVisibleHandGlowTargetAndCapability(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"demo","scene":{"nodes":{"target":{"id":"target","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"go","priority":1,"order":0,"trigger":{"kind":"logicalInput","actor":{"kind":"presenter"},"action":"go"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"effect.start","effectId":"glow","nodeId":"target","owner":{"kind":"presentation"},"seed":1,"effect":{"kind":"handGlow","hand":"left","size":1,"color":{"red":1,"green":1,"blue":1,"alpha":1},"speed":1,"durationMilliseconds":1000}}],"next":{"kind":"stay"}}]}}}}},"variables":{},"timelines":{}}`)
	core, err := newV3RegressionSession(definition)
	if err != nil {
		t.Fatal(err)
	}
	profile := &delivery.ProjectionProfileDescriptor{VisibleNodeIds: []string{"target"}, RuntimeCatalog: &presentation.ProjectedRuntimeCatalog{CatalogContractVersion: 3}, RequiredRuntimeCapabilities: []presentation.RuntimeCapability{presentation.RuntimeCapability_RUNTIME_CAPABILITY_EFFECT_PLAYBACK}}
	if core.ValidateTrackingProfile(profile) == nil {
		t.Fatal("missing hand target admitted")
	}
	profile.RuntimeCatalog.TrackedPoseTargets = []presentation.AnchorTarget{presentation.AnchorTarget_ANCHOR_TARGET_LEFT_HAND}
	if core.ValidateTrackingProfile(profile) == nil {
		t.Fatal("missing delivery capability admitted")
	}
	profile.RequiredRuntimeCapabilities = append(profile.RequiredRuntimeCapabilities, presentation.RuntimeCapability_RUNTIME_CAPABILITY_TRACKED_POSE_DELIVERY)
	if err := core.ValidateTrackingProfile(profile); err != nil {
		t.Fatal(err)
	}
	profile.RuntimeCatalog.TrackedPoseTargets = append(profile.RuntimeCatalog.TrackedPoseTargets, presentation.AnchorTarget_ANCHOR_TARGET_RIGHT_HAND)
	if core.ValidateTrackingProfile(profile) == nil {
		t.Fatal("profile exposed an unneeded hand")
	}
	profile.RuntimeCatalog.TrackedPoseTargets = []presentation.AnchorTarget{presentation.AnchorTarget_ANCHOR_TARGET_LEFT_HAND}
	profile.Key = &delivery.ProjectionProfileKey{Role: presentation.SessionRole_SESSION_ROLE_PRESENTER}
	if core.ValidateTrackingProfile(profile) == nil {
		t.Fatal("presenter without tracking producer capability admitted")
	}
	profile.RequiredRuntimeCapabilities = append(profile.RequiredRuntimeCapabilities, presentation.RuntimeCapability_RUNTIME_CAPABILITY_TRACKING)
	if err := core.ValidateTrackingProfile(profile); err != nil {
		t.Fatal(err)
	}
}
