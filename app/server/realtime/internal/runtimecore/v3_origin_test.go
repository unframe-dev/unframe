package runtimecore

import (
	"context"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
	"math"
	"testing"
	"time"
)

func TestPresentationOriginAbsoluteUpdateAndRetry(t *testing.T) {
	core, _ := reviewSession(t)
	sync := v3Acknowledge(t, core)
	id := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	command := &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID("origin"), CommandEpoch: sync.CommandEpoch, Pose: &presentation.Pose{Position: &presentation.Vector3{Y: 0.7}, Rotation: &presentation.Quaternion{W: 1}}}
	first, events, err := core.PresentationOrigin(context.Background(), id, command)
	if err != nil || first.GetAccepted() == nil || len(events) == 0 || events[0].GetPresentationOriginChanged().GetOrigin().GetVersion() != 1 {
		t.Fatalf("update=%v events=%v error=%v", first, events, err)
	}
	snapshot := core.Snapshot()
	if snapshot.PresentationOrigin.Version != 1 || !proto.Equal(snapshot.PresentationOrigin.Pose, command.Pose) {
		t.Fatalf("snapshot origin=%v", snapshot.PresentationOrigin)
	}
	retry, events, err := core.PresentationOrigin(context.Background(), id, command)
	if err != nil || !proto.Equal(first, retry) || len(events) != 0 || core.Snapshot().ReliableSequence != snapshot.ReliableSequence {
		t.Fatalf("retry=%v events=%v error=%v", retry, events, err)
	}
	replay, err := core.Replay(first.GetAccepted().ReliableSequence - 1)
	if err != nil || !proto.Equal(replay[0].GetPresentationOriginChanged().Origin, snapshot.PresentationOrigin) {
		t.Fatalf("replay=%v error=%v", replay, err)
	}
}

func TestPresentationOriginRejectsUnauthorizedStaleAndInvalidUpdates(t *testing.T) {
	for _, test := range []string{"viewer", "stale", "invalid-pose", "nan-position", "infinite-position", "invalid-command-id", "reused-id"} {
		t.Run(test, func(t *testing.T) {
			core, _ := reviewSession(t)
			sync := v3Acknowledge(t, core)
			id := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
			command := &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID("origin"), CommandEpoch: sync.CommandEpoch, Pose: &presentation.Pose{Position: &presentation.Vector3{}, Rotation: &presentation.Quaternion{W: 1}}}
			switch test {
			case "viewer":
				id.Role = session.RoleViewer
			case "stale":
				command.ExpectedPresentationOriginVersion = 1
			case "nan-position":
				command.Pose.Position.Y = math.NaN()
			case "infinite-position":
				command.Pose.Position.Y = math.Inf(1)
			case "invalid-command-id":
				command.ClientEventId = "invalid-id"
			case "invalid-pose":
				command.Pose.Rotation.W = 2
			case "reused-id":
				if _, _, err := core.PresentationOrigin(context.Background(), id, command); err != nil {
					t.Fatal(err)
				}
				command.Pose.Position.Y = 2
			}
			before := core.Snapshot()
			if _, _, err := core.PresentationOrigin(context.Background(), id, command); err == nil {
				t.Fatal("invalid update accepted")
			}
			if !proto.Equal(before, core.Snapshot()) {
				t.Fatal("rejected update changed snapshot")
			}
		})
	}
}

func TestPresentationOriginDropsTrackingFromPreviousCut(t *testing.T) {
	core, _ := reviewSession(t)
	sync := v3Acknowledge(t, core)
	id := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	command := &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID("origin"), CommandEpoch: sync.CommandEpoch, Pose: &presentation.Pose{Position: &presentation.Vector3{Y: 0.7}, Rotation: &presentation.Quaternion{W: 1}}}
	if _, _, err := core.PresentationOrigin(context.Background(), id, command); err != nil {
		t.Fatal(err)
	}
	frame := &realtime.TrackingFrame{FrameSequence: 1, PresentationFromQuestLocal: &presentation.Pose{Position: &presentation.Vector3{}, Rotation: &presentation.Quaternion{W: 1}}, Samples: []*realtime.TrackedPoseSample{{Target: realtime.TrackedTarget_TRACKED_TARGET_HEAD, QuestLocalPose: &presentation.Pose{Position: &presentation.Vector3{Y: 1.7}, Rotation: &presentation.Quaternion{W: 1}}}}}
	samples, _, err := core.AcceptTracking(context.Background(), id, trackingFrameAtCut(core, frame), time.Now(), 1)
	if err != nil || len(samples) != 0 {
		t.Fatalf("stale samples=%v error=%v", samples, err)
	}
	frame.PresentationOriginVersion = 1
	samples, _, err = core.AcceptTracking(context.Background(), id, trackingFrameAtCut(core, frame), time.Now(), 2)
	if err != nil || len(samples) != 1 {
		t.Fatalf("current samples=%v error=%v", samples, err)
	}
}

func TestPresentationOriginTrackingRemovesStageTransform(t *testing.T) {
	core, _ := reviewSession(t)
	sync := v3Acknowledge(t, core)
	id := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	rotation := &presentation.Quaternion{Y: math.Sqrt(0.5), W: math.Sqrt(0.5)}
	_, _, err := core.PresentationOrigin(context.Background(), id, &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID("rotated-origin"), CommandEpoch: sync.CommandEpoch, Pose: &presentation.Pose{Position: &presentation.Vector3{X: 1, Y: 0.7, Z: 2}, Rotation: rotation}})
	if err != nil {
		t.Fatal(err)
	}
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtime.TrackedTarget_TRACKED_TARGET_HEAD, &presentation.Pose{Position: &presentation.Vector3{X: 3, Y: 1.7, Z: 2}, Rotation: rotation}))
	frame.PresentationOriginVersion = 1
	samples, _, err := core.AcceptTracking(context.Background(), id, trackingFrameAtCut(core, frame), time.Now(), 1)
	if err != nil || len(samples) != 1 {
		t.Fatalf("samples=%v error=%v", samples, err)
	}
	got := samples[0].Pose
	if math.Abs(got.Position.X) > 1e-9 || math.Abs(got.Position.Y-1) > 1e-9 || math.Abs(got.Position.Z-2) > 1e-9 || math.Abs(got.Rotation.W-1) > 1e-9 || math.Abs(got.Rotation.Y) > 1e-9 {
		t.Fatalf("stage-local tracking=%v", got)
	}
}

func TestPresentationOriginRebasesFrozenAnchorsAndReplacement(t *testing.T) {
	core, writer := v3FrozenCore(t)
	v3SeedAnchor(t, core, 1, 3)
	id := session.Identity{ParticipantID: "presenter-1", Role: session.RolePresenter}
	frame := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtime.TrackedTarget_TRACKED_TARGET_LEFT_HAND, trackingTestPose(3, 0, 0)))
	if _, _, err := core.AcceptTracking(context.Background(), id, trackingFrameAtCut(core, frame), time.Now(), 2); err != nil {
		t.Fatal(err)
	}
	v3FrozenControl(t, core, "pause", realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE)
	sync := core.InputSynchronization()
	command := &realtime.PresentationOriginCommand{ClientEventId: v3TestEventID("frozen-origin"), CommandEpoch: sync.CommandEpoch, Pose: &presentation.Pose{Position: &presentation.Vector3{X: 1, Y: 0.7, Z: 2}, Rotation: &presentation.Quaternion{Y: math.Sqrt(0.5), W: math.Sqrt(0.5)}}}
	first, events, err := core.PresentationOrigin(context.Background(), id, command)
	if err != nil || first.GetAccepted() == nil || len(events) < 2 {
		t.Fatalf("origin=%v events=%v error=%v", first, events, err)
	}
	frozen := core.Snapshot().FrozenAnchors[0]
	if math.Abs(frozen.Position.X-2) > 1e-9 || math.Abs(frozen.Position.Y+0.7) > 1e-9 || math.Abs(frozen.Position.Z-2) > 1e-9 || frozen.Rotation != nil {
		t.Fatalf("rebased frozen=%v", frozen)
	}
	rotated := core.Snapshot().FrozenAnchors[1]
	if rotated.Rotation == nil || math.Abs(rotated.Rotation.Y+math.Sqrt(0.5)) > 1e-9 || math.Abs(rotated.Rotation.W-math.Sqrt(0.5)) > 1e-9 {
		t.Fatalf("frozen rotation=%v", rotated)
	}
	replacement := events[1].GetRuntimeViewReplaced()
	if replacement == nil || !proto.Equal(frozen, replacement.RuntimeView.FrozenAnchors[0]) {
		t.Fatalf("replacement=%v", replacement)
	}
	flushV2(t, core)
	restored, _ := v3FrozenCore(t)
	if err := restored.RestoreCheckpoint(writer.envelope); err != nil {
		t.Fatal(err)
	}
	retry, events, err := restored.PresentationOrigin(context.Background(), id, command)
	if err != nil || !proto.Equal(first, retry) || len(events) != 0 || !proto.Equal(restored.Snapshot().PresentationOrigin, core.Snapshot().PresentationOrigin) {
		t.Fatalf("restored retry=%v events=%v error=%v", retry, events, err)
	}
}
