package runtimecore

import (
	"math"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func trackingTestPose(x, y, z float64) *presentationv2.Pose {
	return &presentationv2.Pose{Position: &presentationv2.Vector3{X: x, Y: y, Z: z}, Rotation: &presentationv2.Quaternion{W: 1}}
}

func trackingTestFrame(sequence uint64, calibration *presentationv2.Pose, samples ...*realtimev2.TrackedPoseSample) *realtimev2.TrackingFrame {
	return &realtimev2.TrackingFrame{FrameSequence: sequence, PresentationFromQuestLocal: calibration, Samples: samples}
}

func trackingTestSample(target realtimev2.TrackedTarget, pose *presentationv2.Pose) *realtimev2.TrackedPoseSample {
	return &realtimev2.TrackedPoseSample{Target: target, QuestLocalPose: pose, PositionAvailable: true, RotationAvailable: true}
}

func trackingTestAccept(evaluator *v2TrackingEvaluator, frame *realtimev2.TrackingFrame, at time.Time, definition v2TrackingDefinition, originVersion uint64) ([]v2PresentedTrackingSample, []string, error) {
	return evaluator.Accept(frame, at, uint64(at.Sub(time.Unix(100, 0))/time.Millisecond), definition, originVersion)
}

func TestV2TrackingAcceptTransformsWithSameFrameCalibration(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	receivedAt := time.Unix(100, 0)
	frame := trackingTestFrame(1, trackingTestPose(10, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(2, 3, 4)))
	samples, fired, err := trackingTestAccept(evaluator, frame, receivedAt, v2TrackingDefinition{}, 1)
	if err != nil || len(samples) != 1 || len(fired) != 0 {
		t.Fatalf("samples=%#v fired=%#v err=%v", samples, fired, err)
	}
	if samples[0].Pose.Position.X != 12 || samples[0].Pose.Position.Y != 3 || samples[0].Pose.Position.Z != 4 || !samples[0].ReceivedAt.Equal(receivedAt) || samples[0].FrameSequence != 1 || samples[0].OriginVersion != 1 {
		t.Fatalf("transformed sample=%#v", samples[0])
	}
}

func TestV2TrackingRejectsInvalidFramesWithoutAdvancingSequence(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	at := time.Unix(100, 0)
	valid := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(0, 0, 0)))
	badRotation := trackingTestPose(0, 0, 0)
	badRotation.Rotation = &presentationv2.Quaternion{W: 2}
	negativeZero := trackingTestPose(math.Copysign(0, -1), 0, 0)
	invalid := []*realtimev2.TrackingFrame{
		trackingTestFrame(0, trackingTestPose(0, 0, 0)),
		trackingTestFrame(1, nil),
		trackingTestFrame(1, trackingTestPose(math.NaN(), 0, 0)),
		trackingTestFrame(1, badRotation),
		trackingTestFrame(1, negativeZero),
		trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_UNSPECIFIED, trackingTestPose(0, 0, 0))),
		trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(0, 0, 0)), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(1, 0, 0))),
		trackingTestFrame(1, trackingTestPose(0, 0, 0), nil),
	}
	for _, frame := range invalid {
		if _, _, err := trackingTestAccept(evaluator, frame, at, v2TrackingDefinition{}, 1); err == nil {
			t.Fatalf("accepted invalid frame %#v", frame)
		}
	}
	if _, _, err := trackingTestAccept(evaluator, valid, at, v2TrackingDefinition{}, 1); err != nil {
		t.Fatalf("invalid frames advanced sequence: %v", err)
	}
	if _, _, err := trackingTestAccept(evaluator, valid, at.Add(time.Millisecond), v2TrackingDefinition{}, 1); err == nil {
		t.Fatal("accepted duplicate frame sequence")
	}
}

func TestV2TrackingRotatesPositionAndCanonicalizesOrientation(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	half := math.Sqrt(0.5)
	calibration := trackingTestPose(1, 0, 0)
	calibration.Rotation = &presentationv2.Quaternion{Z: half, W: half}
	frame := trackingTestFrame(1, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND, trackingTestPose(1, 0, 0)))
	samples, _, err := trackingTestAccept(evaluator, frame, time.Unix(100, 0), v2TrackingDefinition{}, 1)
	if err != nil || len(samples) != 1 || math.Abs(samples[0].Pose.Position.X-1) > 1e-9 || math.Abs(samples[0].Pose.Position.Y-1) > 1e-9 || math.Abs(samples[0].Pose.Rotation.Z-half) > 1e-9 {
		t.Fatalf("rotated=%#v err=%v", samples, err)
	}
}

func TestV2TrackingCanonicalizesZeroAfterQuaternionSignFlip(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	calibration := trackingTestPose(0, 0, 0)
	calibration.Rotation = &presentationv2.Quaternion{Z: 1}
	local := trackingTestPose(0, 0, 0)
	local.Rotation = &presentationv2.Quaternion{Z: 1}
	frame := trackingTestFrame(1, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, local))
	samples, _, err := trackingTestAccept(evaluator, frame, time.Unix(100, 0), v2TrackingDefinition{}, 1)
	if err != nil || len(samples) != 1 || samples[0].Pose.Rotation.W != 1 || math.Signbit(samples[0].Pose.Rotation.X) || math.Signbit(samples[0].Pose.Rotation.Y) || math.Signbit(samples[0].Pose.Rotation.Z) {
		t.Fatalf("canonical pose=%#v err=%v", samples, err)
	}
}

func TestV2TrackingComposedRotationStaysCanonicalAtInputNormTolerance(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	calibration := trackingTestPose(0, 0, 0)
	calibration.Rotation.W = 1 + 7.5e-10
	local := trackingTestPose(0, 0, 0)
	local.Rotation.W = 1 + 7.5e-10
	frame := trackingTestFrame(1, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, local))
	samples, _, err := evaluator.Accept(frame, time.Unix(100, 0), 1, v2TrackingDefinition{}, 1)
	if err != nil || len(samples) != 1 || samples[0].Pose.Rotation.W != 1 {
		t.Fatalf("composed rotation=%#v err=%v", samples, err)
	}
}

func TestV2TrackingUnavailableComponentsDoNotBorrowOldPose(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	at := time.Unix(100, 0)
	full := trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND, trackingTestPose(1, 2, 3))
	if _, _, err := trackingTestAccept(evaluator, trackingTestFrame(1, trackingTestPose(10, 0, 0), full), at, v2TrackingDefinition{}, 1); err != nil {
		t.Fatal(err)
	}
	partial := &realtimev2.TrackedPoseSample{Target: realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND, QuestLocalPose: trackingTestPose(7, 8, 9), RotationAvailable: true}
	samples, _, err := trackingTestAccept(evaluator, trackingTestFrame(2, trackingTestPose(10, 0, 0), partial), at.Add(time.Millisecond), v2TrackingDefinition{}, 1)
	if err != nil || len(samples) != 1 || samples[0].PositionAvailable || samples[0].Pose.Position.X != 0 || samples[0].Pose.Position.Y != 0 || samples[0].Pose.Position.Z != 0 || samples[0].Pose.Rotation.W != 1 {
		t.Fatalf("partial=%#v err=%v", samples, err)
	}
}
