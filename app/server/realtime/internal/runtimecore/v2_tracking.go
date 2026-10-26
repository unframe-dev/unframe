package runtimecore

import (
	"errors"
	"math"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

var errV2TrackingFrame = errors.New("v2 tracking frame is invalid")

type v2TrackingZone struct {
	ID     string
	Owner  v2Owner
	Center [3]float64
}

type v2TrackingDefinition struct{}

type v2PresentedTrackingSample struct {
	Target            realtimev2.TrackedTarget
	Pose              *presentationv2.Pose
	PositionAvailable bool
	RotationAvailable bool
	ReceivedAt        time.Time
	ObservedAtMs      uint64
	FrameSequence     uint64
	OriginVersion     uint64
}

type v2TrackingEvaluator struct {
	lastFrameSequence uint64
	originVersion     uint64
	hasOriginVersion  bool
	lastReceivedAt    time.Time
	lastObservedAtMs  uint64
	lastSamples       map[realtimev2.TrackedTarget]v2PresentedTrackingSample
}

func (e *v2TrackingEvaluator) Clone() v2TrackingEvaluator {
	if e == nil {
		return v2TrackingEvaluator{}
	}
	clone := *e
	if e.lastSamples != nil {
		clone.lastSamples = make(map[realtimev2.TrackedTarget]v2PresentedTrackingSample, len(e.lastSamples))
		for target, sample := range e.lastSamples {
			if sample.Pose != nil {
				sample.Pose = proto.Clone(sample.Pose).(*presentationv2.Pose)
			}
			clone.lastSamples[target] = sample
		}
	}
	return clone
}

func (e *v2TrackingEvaluator) Accept(frame *realtimev2.TrackingFrame, receivedAt time.Time, observedAtMs uint64, definition v2TrackingDefinition, originVersion uint64) ([]v2PresentedTrackingSample, []string, error) {
	if e == nil || frame == nil || receivedAt.IsZero() || frame.FrameSequence == 0 || frame.FrameSequence <= e.lastFrameSequence || len(frame.Samples) > 4 || frame.PresentationFromQuestLocal == nil || protocolv2.ValidateMessage(frame.PresentationFromQuestLocal) != nil {
		return nil, nil, errV2TrackingFrame
	}
	if e.hasOriginVersion && originVersion < e.originVersion || e.lastFrameSequence != 0 && observedAtMs < e.lastObservedAtMs {
		return nil, nil, errV2TrackingFrame
	}
	seen := make(map[realtimev2.TrackedTarget]struct{}, len(frame.Samples))
	samples := make([]v2PresentedTrackingSample, 0, len(frame.Samples))
	for _, sample := range frame.Samples {
		if sample == nil || sample.QuestLocalPose == nil || protocolv2.ValidateMessage(sample) != nil {
			return nil, nil, errV2TrackingFrame
		}
		if _, exists := seen[sample.Target]; exists {
			return nil, nil, errV2TrackingFrame
		}
		seen[sample.Target] = struct{}{}
		pose, err := v2TrackingComposePose(frame.PresentationFromQuestLocal, sample)
		if err != nil {
			return nil, nil, err
		}
		samples = append(samples, v2PresentedTrackingSample{
			Target: sample.Target, Pose: pose, PositionAvailable: sample.PositionAvailable,
			RotationAvailable: sample.RotationAvailable, ReceivedAt: receivedAt,
			ObservedAtMs:  observedAtMs,
			FrameSequence: frame.FrameSequence, OriginVersion: originVersion,
		})
	}
	if !e.hasOriginVersion || originVersion != e.originVersion {
		e.lastSamples = make(map[realtimev2.TrackedTarget]v2PresentedTrackingSample)
	}
	for _, sample := range samples {
		e.lastSamples[sample.Target] = sample
	}
	e.lastFrameSequence = frame.FrameSequence
	e.originVersion = originVersion
	e.hasOriginVersion = true
	e.lastReceivedAt = receivedAt
	e.lastObservedAtMs = observedAtMs
	return samples, nil, nil
}

func v2TrackingComposePose(calibration *presentationv2.Pose, sample *realtimev2.TrackedPoseSample) (*presentationv2.Pose, error) {
	pose := &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}
	calibrationRotation := v2TrackingUnit(calibration.Rotation)
	if sample.PositionAvailable {
		rotated := v2TrackingRotate(calibrationRotation, sample.QuestLocalPose.Position)
		pose.Position.X = calibration.Position.X + rotated.X
		pose.Position.Y = calibration.Position.Y + rotated.Y
		pose.Position.Z = calibration.Position.Z + rotated.Z
	}
	if sample.RotationAvailable {
		pose.Rotation = v2TrackingUnit(v2TrackingMultiply(calibrationRotation, v2TrackingUnit(sample.QuestLocalPose.Rotation)))
	}
	for _, scalar := range []*float64{&pose.Position.X, &pose.Position.Y, &pose.Position.Z, &pose.Rotation.X, &pose.Rotation.Y, &pose.Rotation.Z, &pose.Rotation.W} {
		if math.IsNaN(*scalar) || math.IsInf(*scalar, 0) {
			return nil, errV2TrackingFrame
		}
	}
	if v2TrackingNegativeQuaternion(pose.Rotation) {
		pose.Rotation.X, pose.Rotation.Y, pose.Rotation.Z, pose.Rotation.W = -pose.Rotation.X, -pose.Rotation.Y, -pose.Rotation.Z, -pose.Rotation.W
	}
	for _, scalar := range []*float64{&pose.Position.X, &pose.Position.Y, &pose.Position.Z, &pose.Rotation.X, &pose.Rotation.Y, &pose.Rotation.Z, &pose.Rotation.W} {
		if *scalar == 0 {
			*scalar = 0
		}
	}
	if protocolv2.ValidateMessage(pose) != nil {
		return nil, errV2TrackingFrame
	}
	return pose, nil
}

func v2TrackingUnit(q *presentationv2.Quaternion) *presentationv2.Quaternion {
	norm := math.Sqrt(q.X*q.X + q.Y*q.Y + q.Z*q.Z + q.W*q.W)
	return &presentationv2.Quaternion{X: q.X / norm, Y: q.Y / norm, Z: q.Z / norm, W: q.W / norm}
}

func v2TrackingNegativeQuaternion(q *presentationv2.Quaternion) bool {
	for _, scalar := range []float64{q.W, q.X, q.Y, q.Z} {
		if scalar != 0 {
			return scalar < 0
		}
	}
	return false
}

func v2TrackingMultiply(a, b *presentationv2.Quaternion) *presentationv2.Quaternion {
	return &presentationv2.Quaternion{
		X: a.W*b.X + a.X*b.W + a.Y*b.Z - a.Z*b.Y,
		Y: a.W*b.Y - a.X*b.Z + a.Y*b.W + a.Z*b.X,
		Z: a.W*b.Z + a.X*b.Y - a.Y*b.X + a.Z*b.W,
		W: a.W*b.W - a.X*b.X - a.Y*b.Y - a.Z*b.Z,
	}
}

func v2TrackingRotate(q *presentationv2.Quaternion, v *presentationv2.Vector3) *presentationv2.Vector3 {
	uX, uY, uZ := q.X, q.Y, q.Z
	tX, tY, tZ := 2*(uY*v.Z-uZ*v.Y), 2*(uZ*v.X-uX*v.Z), 2*(uX*v.Y-uY*v.X)
	return &presentationv2.Vector3{
		X: v.X + q.W*tX + uY*tZ - uZ*tY,
		Y: v.Y + q.W*tY + uZ*tX - uX*tZ,
		Z: v.Z + q.W*tZ + uX*tY - uY*tX,
	}
}
