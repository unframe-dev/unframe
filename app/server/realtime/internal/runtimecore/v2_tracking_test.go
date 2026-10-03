package runtimecore

import (
	"math"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
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

func TestV2TrackingSafeUIntDwellUsesInjectedMonotonicMilliseconds(t *testing.T) {
	state := &v2TrackingCueState{}
	zone := v2TrackingZone{Size: [3]float64{2, 2, 2}}
	cue := v2TrackingCue{Edge: "enter", DwellMilliseconds: v2TrackingMaxSafeMilliseconds}
	outside := &presentationv2.Vector3{X: 2}
	inside := &presentationv2.Vector3{}
	for _, point := range []struct {
		observed uint64
		position *presentationv2.Vector3
		fire     bool
	}{{1, outside, false}, {2, inside, false}, {2 + v2TrackingMaxSafeMilliseconds - 1, inside, false}, {2 + v2TrackingMaxSafeMilliseconds, inside, true}} {
		if fired := v2TrackingZoneEdge(state, cue, zone, point.position, point.observed); fired != point.fire {
			t.Fatalf("observed=%d fired=%v", point.observed, fired)
		}
	}
}

func TestV2TrackingCloneIsolatesDetectorAndPoseMemory(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	seed := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, _, err := evaluator.Accept(seed, at, 1, definition, 1); err != nil {
		t.Fatal(err)
	}
	clone := evaluator.Clone()
	clone.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY].Pose.Position.X = 99
	if evaluator.lastSamples[realtimev2.TrackedTarget_TRACKED_TARGET_BODY].Pose.Position.X != 2 {
		t.Fatal("clone shares pose memory")
	}
	enter := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	if _, fired, err := clone.Accept(enter, at, 2, definition, 1); err != nil || len(fired) != 1 {
		t.Fatalf("clone fired=%v err=%v", fired, err)
	}
	if evaluator.lastFrameSequence != 1 || evaluator.states["enter"].inside {
		t.Fatalf("original was mutated: %#v", evaluator)
	}
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

func TestV2TrackingOriginChangeReseedsWithoutSyntheticEdge(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	first := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, fired, err := trackingTestAccept(evaluator, first, at, definition, 1); err != nil || len(fired) != 0 {
		t.Fatalf("first fired=%#v err=%v", fired, err)
	}
	second := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	if _, fired, err := trackingTestAccept(evaluator, second, at.Add(time.Millisecond), definition, 2); err != nil || len(fired) != 0 {
		t.Fatalf("origin change fired=%#v err=%v", fired, err)
	}
	if _, _, err := trackingTestAccept(evaluator, trackingTestFrame(3, trackingTestPose(0, 0, 0)), at.Add(2*time.Millisecond), definition, 1); err == nil {
		t.Fatal("accepted stale origin")
	}
}

func TestV2TrackingZoneDwellCancelsOnReturnAndFiresAfterContinuousCrossing(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter", DwellMilliseconds: 100}},
	}
	at := time.Unix(100, 0)
	positions := []float64{2, 0, 2, 0, 0}
	delays := []time.Duration{0, 10, 50, 60, 160}
	for i, position := range positions {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(delays[i]*time.Millisecond), definition, 1)
		if err != nil {
			t.Fatal(err)
		}
		want := i == 4
		if (len(fired) == 1 && fired[0] == "enter") != want {
			t.Fatalf("frame %d fired=%v", i+1, fired)
		}
	}
}

func TestV2TrackingMotionUsesBodyNetDisplacementWithinWindow(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 2, WindowMilliseconds: 100}}}
	at := time.Unix(100, 0)
	positions := []float64{0, 1, 0, 2.1, 3}
	delays := []time.Duration{0, 20, 40, 60, 200}
	for i, position := range positions {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(delays[i]*time.Millisecond), definition, 1)
		if err != nil {
			t.Fatal(err)
		}
		want := i == 3
		if (len(fired) == 1 && fired[0] == "move") != want {
			t.Fatalf("frame %d fired=%v", i+1, fired)
		}
	}
}

func TestV2TrackingUnavailablePositionReseedsDetector(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	for i, sample := range []*realtimev2.TrackedPoseSample{
		trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)),
		{Target: realtimev2.TrackedTarget_TRACKED_TARGET_BODY, QuestLocalPose: trackingTestPose(0, 0, 0), RotationAvailable: true},
		trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)),
	} {
		_, fired, err := trackingTestAccept(evaluator, trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), sample), at.Add(time.Duration(i)*time.Millisecond), definition, 1)
		if err != nil || len(fired) != 0 {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
	}
}

func TestV2TrackingOverflowDoesNotAdvanceSequenceOrDetector(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 1, WindowMilliseconds: 100}}}
	at := time.Unix(100, 0)
	overflow := trackingTestFrame(1, trackingTestPose(math.MaxFloat64, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(math.MaxFloat64, 0, 0)))
	if _, _, err := trackingTestAccept(evaluator, overflow, at, definition, 1); err == nil {
		t.Fatal("accepted overflowing presentation pose")
	}
	seed := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	if _, fired, err := trackingTestAccept(evaluator, seed, at, definition, 1); err != nil || len(fired) != 0 {
		t.Fatalf("invalid frame changed sequence or detector: fired=%v err=%v", fired, err)
	}
	move := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, fired, err := trackingTestAccept(evaluator, move, at.Add(time.Millisecond), definition, 1); err != nil || len(fired) != 1 || fired[0] != "move" {
		t.Fatalf("motion after valid seed: fired=%v err=%v", fired, err)
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

func TestV2TrackingInactiveGroupZoneDoesNotFire(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		CurrentGroupID: "other",
		Zones:          map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "group", GroupID: "group"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:           []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	for i, position := range []float64{2, 0} {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		if _, fired, err := trackingTestAccept(evaluator, frame, at.Add(time.Duration(i)*time.Millisecond), definition, 1); err != nil || len(fired) != 0 {
			t.Fatalf("inactive zone fired=%v err=%v", fired, err)
		}
	}
}

func TestV2TrackingExitUsesExpandedHysteresisBoundary(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "exit", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "exit", HysteresisMeters: 0.5}},
	}
	at := time.Unix(100, 0)
	for i, position := range []float64{0, 1.2, 1.6} {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(time.Duration(i)*time.Millisecond), definition, 1)
		if err != nil || (len(fired) == 1 && fired[0] == "exit") != (i == 2) {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
	}
}

func TestV2TrackingStaleSampleReseedsZoneWithoutAnEnter(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	for i, point := range []struct {
		position float64
		delay    time.Duration
	}{{2, 0}, {0, 501 * time.Millisecond}} {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(point.position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(point.delay), definition, 1)
		if err != nil || len(fired) != 0 {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
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

func TestV2TrackingAdmitsContractSafeUIntDurationWithoutOverflow(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues: []v2TrackingCue{
			{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter", DwellMilliseconds: v2TrackingMaxSafeMilliseconds},
			{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 1, WindowMilliseconds: v2TrackingMaxSafeMilliseconds},
		},
	}
	at := time.Unix(100, 0)
	for i, position := range []float64{2, 0} {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(time.Duration(i)*time.Millisecond), definition, 1)
		if err != nil || i == 1 && len(fired) != 1 || i == 1 && fired[0] != "move" {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
	}
}

func TestV2TrackingExtremeFiniteZoneDoesNotBecomeUnbounded(t *testing.T) {
	zone := v2TrackingZone{Center: [3]float64{-math.MaxFloat64, 0, 0}, Size: [3]float64{math.MaxFloat64, 1, 1}}
	if v2TrackingInsideZone(zone, &presentationv2.Vector3{X: math.MaxFloat64}, math.MaxFloat64) {
		t.Fatal("overflow made an extreme zone contain the opposite extreme")
	}
}

func TestV2TrackingFixedWindowRearmsOnlyFromNextWindowSeed(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 2, WindowMilliseconds: 100}}}
	at := time.Unix(100, 0)
	positions := []float64{0, 2, 4, 10, 12}
	delays := []time.Duration{0, 20, 40, 100, 120}
	for i, position := range positions {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(delays[i]*time.Millisecond), definition, 1)
		want := i == 1 || i == 4
		if err != nil || (len(fired) == 1 && fired[0] == "move") != want {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
	}
}

func TestV2TrackingFixedWindowThresholdNotReachedStartsOver(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 2, WindowMilliseconds: 100}}}
	at := time.Unix(100, 0)
	positions := []float64{0, 1, 3, 4, 5}
	delays := []time.Duration{0, 80, 100, 120, 140}
	for i, position := range positions {
		frame := trackingTestFrame(uint64(i+1), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(position, 0, 0)))
		_, fired, err := trackingTestAccept(evaluator, frame, at.Add(delays[i]*time.Millisecond), definition, 1)
		if err != nil || (len(fired) == 1 && fired[0] == "move") != (i == 4) {
			t.Fatalf("frame %d fired=%v err=%v", i+1, fired, err)
		}
	}
}

func TestV2TrackingReentryToSameStepEpochReseedsZone(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{
		CurrentGroupID: "group", GroupEntryEpoch: 1, CurrentStepID: "step", StepEntryEpoch: 1,
		Zones: map[string]v2TrackingZone{"zone": {ID: "zone", Owner: v2Owner{Kind: "presentation"}, Center: [3]float64{}, Size: [3]float64{2, 2, 2}}},
		Cues:  []v2TrackingCue{{ID: "enter", Kind: "zoneEdge", SubjectKind: "participant", ZoneID: "zone", Edge: "enter"}},
	}
	at := time.Unix(100, 0)
	first := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, _, err := trackingTestAccept(evaluator, first, at, definition, 1); err != nil {
		t.Fatal(err)
	}
	definition.StepEntryEpoch++
	second := trackingTestFrame(2, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	if _, fired, err := trackingTestAccept(evaluator, second, at.Add(time.Millisecond), definition, 1); err != nil || len(fired) != 0 {
		t.Fatalf("step reentry fired=%v err=%v", fired, err)
	}
}

func TestV2TrackingLongFixedWindowKeepsOneStartingPoint(t *testing.T) {
	evaluator := &v2TrackingEvaluator{}
	definition := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "move", Kind: "motion", SubjectKind: "participant", MinimumDistanceMeters: 1000, WindowMilliseconds: v2TrackingMaxSafeMilliseconds}}}
	at := time.Unix(100, 0)
	for i := 1; i <= 1000; i++ {
		frame := trackingTestFrame(uint64(i), trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(float64(i)/1000, 0, 0)))
		if _, fired, err := trackingTestAccept(evaluator, frame, at.Add(time.Duration(i)*time.Millisecond), definition, 1); err != nil || len(fired) != 0 {
			t.Fatalf("frame %d fired=%v err=%v", i, fired, err)
		}
	}
	if len(evaluator.states) != 1 || !evaluator.states["move"].windowSeeded || evaluator.states["move"].windowStart.position[0] != 0.001 {
		t.Fatalf("window state=%#v", evaluator.states)
	}
}
