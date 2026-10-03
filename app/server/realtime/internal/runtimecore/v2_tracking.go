package runtimecore

import (
	"errors"
	"fmt"
	"math"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

var errV2TrackingFrame = errors.New("v2 tracking frame is invalid")

const v2TrackingMaxSafeMilliseconds uint64 = 9007199254740991

type v2TrackingZone struct {
	ID     string
	Owner  v2Owner
	Center [3]float64
	Size   [3]float64
}

type v2TrackingCue struct {
	ID                    string
	Kind                  string
	SubjectKind           string
	Target                realtimev2.TrackedTarget
	ZoneID                string
	Edge                  string
	DwellMilliseconds     uint64
	HysteresisMeters      float64
	MinimumDistanceMeters float64
	WindowMilliseconds    uint64
}

type v2TrackingDefinition struct {
	Zones           map[string]v2TrackingZone
	Cues            []v2TrackingCue
	CurrentGroupID  string
	GroupEntryEpoch uint64
	CurrentStepID   string
	StepEntryEpoch  uint64
}

type v2TrackingPoint struct {
	at       uint64
	position [3]float64
}

type v2TrackingCueState struct {
	seeded        bool
	inside        bool
	pending       bool
	pendingInside bool
	pendingSince  uint64
	windowSeeded  bool
	windowStart   v2TrackingPoint
	windowFired   bool
}

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
	states            map[string]v2TrackingCueState
	scope             string
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
	if e.states != nil {
		clone.states = make(map[string]v2TrackingCueState, len(e.states))
		for id, state := range e.states {
			clone.states[id] = state
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
	if err := v2TrackingValidateDefinition(definition); err != nil {
		return nil, nil, err
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
	scope := fmt.Sprintf("%s\x00%d\x00%s\x00%d", definition.CurrentGroupID, definition.GroupEntryEpoch, definition.CurrentStepID, definition.StepEntryEpoch)
	if !e.hasOriginVersion || originVersion != e.originVersion || e.scope != scope {
		e.lastSamples = make(map[realtimev2.TrackedTarget]v2PresentedTrackingSample, len(samples))
		e.states = make(map[string]v2TrackingCueState, len(definition.Cues))
	}
	fired := make([]string, 0)
	for _, cue := range definition.Cues {
		target := cue.Target
		if cue.SubjectKind == "participant" {
			target = realtimev2.TrackedTarget_TRACKED_TARGET_BODY
		}
		for _, sample := range samples {
			if sample.Target != target {
				continue
			}
			state := e.states[cue.ID]
			previous := e.lastSamples[target]
			if !sample.PositionAvailable || previous.PositionAvailable && observedAtMs-previous.ObservedAtMs > 500 {
				state = v2TrackingCueState{}
			}
			if sample.PositionAvailable {
				if cue.Kind == "zoneEdge" {
					zone := definition.Zones[cue.ZoneID]
					if v2OwnerActive(zone.Owner, definition.CurrentGroupID) && v2TrackingZoneEdge(&state, cue, zone, sample.Pose.Position, observedAtMs) {
						fired = append(fired, cue.ID)
					}
				} else if v2TrackingMotion(&state, cue, sample.Pose.Position, observedAtMs) {
					fired = append(fired, cue.ID)
				}
			}
			e.states[cue.ID] = state
			break
		}
	}
	for _, sample := range samples {
		e.lastSamples[sample.Target] = sample
	}
	e.lastFrameSequence = frame.FrameSequence
	e.originVersion = originVersion
	e.hasOriginVersion = true
	e.lastReceivedAt = receivedAt
	e.lastObservedAtMs = observedAtMs
	e.scope = scope
	return samples, fired, nil
}

func v2TrackingValidateDefinition(definition v2TrackingDefinition) error {
	seen := make(map[string]struct{}, len(definition.Cues))
	for _, cue := range definition.Cues {
		if cue.ID == "" || cue.SubjectKind != "participant" && cue.SubjectKind != "anchor" || cue.SubjectKind == "participant" && cue.Target != realtimev2.TrackedTarget_TRACKED_TARGET_UNSPECIFIED || cue.SubjectKind == "anchor" && (cue.Target < realtimev2.TrackedTarget_TRACKED_TARGET_HEAD || cue.Target > realtimev2.TrackedTarget_TRACKED_TARGET_BODY) {
			return errV2TrackingFrame
		}
		if _, exists := seen[cue.ID]; exists {
			return errV2TrackingFrame
		}
		seen[cue.ID] = struct{}{}
		switch cue.Kind {
		case "zoneEdge":
			zone, ok := definition.Zones[cue.ZoneID]
			if !ok || zone.ID != cue.ZoneID || zone.Owner.Kind != "presentation" && (zone.Owner.Kind != "group" || zone.Owner.GroupID == "") || cue.Edge != "enter" && cue.Edge != "exit" || !v2TrackingFinite(cue.HysteresisMeters) || cue.HysteresisMeters < 0 || cue.DwellMilliseconds > v2TrackingMaxSafeMilliseconds {
				return errV2TrackingFrame
			}
			for i := range zone.Size {
				if !v2TrackingFinite(zone.Center[i]) || !v2TrackingFinite(zone.Size[i]) || zone.Size[i] <= 0 {
					return errV2TrackingFrame
				}
			}
		case "motion":
			if !v2TrackingFinite(cue.MinimumDistanceMeters) || cue.MinimumDistanceMeters <= 0 || cue.WindowMilliseconds == 0 || cue.WindowMilliseconds > v2TrackingMaxSafeMilliseconds {
				return errV2TrackingFrame
			}
		default:
			return errV2TrackingFrame
		}
	}
	return nil
}

func v2TrackingFinite(number float64) bool {
	return !math.IsNaN(number) && !math.IsInf(number, 0) && !(number == 0 && math.Signbit(number))
}

func v2TrackingZoneEdge(state *v2TrackingCueState, cue v2TrackingCue, zone v2TrackingZone, position *presentationv2.Vector3, at uint64) bool {
	inside := v2TrackingInsideZone(zone, position, 0)
	if !state.seeded {
		state.seeded, state.inside = true, inside
		return false
	}
	if state.inside {
		inside = v2TrackingInsideZone(zone, position, cue.HysteresisMeters)
	}
	if inside == state.inside {
		state.pending = false
		return false
	}
	if !state.pending || state.pendingInside != inside {
		state.pending, state.pendingInside, state.pendingSince = true, inside, at
	}
	if at-state.pendingSince < cue.DwellMilliseconds {
		return false
	}
	state.inside, state.pending = inside, false
	return inside && cue.Edge == "enter" || !inside && cue.Edge == "exit"
}

func v2TrackingInsideZone(zone v2TrackingZone, p *presentationv2.Vector3, margin float64) bool {
	coordinates := [3]float64{p.X, p.Y, p.Z}
	for i, value := range coordinates {
		distance := math.Abs(value - zone.Center[i])
		limit := zone.Size[i]/2 + margin
		if math.IsInf(distance, 0) || math.IsInf(limit, 0) {
			if math.Abs(value/2-zone.Center[i]/2) > zone.Size[i]/4+margin/2 {
				return false
			}
			continue
		}
		if distance > limit {
			return false
		}
	}
	return true
}

func v2TrackingMotion(state *v2TrackingCueState, cue v2TrackingCue, position *presentationv2.Vector3, at uint64) bool {
	if !state.windowSeeded || at-state.windowStart.at >= cue.WindowMilliseconds {
		state.windowSeeded = true
		state.windowStart = v2TrackingPoint{at: at, position: [3]float64{position.X, position.Y, position.Z}}
		state.windowFired = false
		return false
	}
	if state.windowFired {
		return false
	}
	start := state.windowStart.position
	dx, dy, dz := position.X-start[0], position.Y-start[1], position.Z-start[2]
	if math.Hypot(math.Hypot(dx, dy), dz) < cue.MinimumDistanceMeters {
		return false
	}
	state.windowFired = true
	return true
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
