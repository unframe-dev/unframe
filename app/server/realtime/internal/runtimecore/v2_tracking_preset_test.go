package runtimecore

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func presetFrame(seq uint64, head, left, right [3]float64) *realtimev2.TrackingFrame {
	return trackingTestFrame(seq, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(head[0], head[1], head[2])), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND, trackingTestPose(left[0], left[1], left[2])), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_RIGHT_HAND, trackingTestPose(right[0], right[1], right[2])))
}

func TestV2TrackingMotionPresetsDirectionsAndSingleFire(t *testing.T) {
	for _, test := range []struct {
		preset string
		delta  [3]float64
	}{{"swipeLeft", [3]float64{-.3, 0, 0}}, {"swipeRight", [3]float64{.3, 0, 0}}, {"swipeDown", [3]float64{0, -.3, 0}}, {"swipeUp", [3]float64{0, .3, 0}}, {"pushForward", [3]float64{0, 0, -.3}}, {"pullBackward", [3]float64{0, 0, .3}}} {
		t.Run(test.preset, func(t *testing.T) {
			for _, hand := range []int{0, 1} {
				e := &v2TrackingEvaluator{}
				def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: test.preset, MinimumDistanceMeters: .28, WindowMilliseconds: 1200}}}
				left, right := [3]float64{-.2, 0, 0}, [3]float64{.2, 0, 0}
				for i, at := range []uint64{0, 100, 200, 300, 400} {
					if i == 3 {
						if hand == 0 {
							for j := range left {
								left[j] += test.delta[j]
							}
						} else {
							for j := range right {
								right[j] += test.delta[j]
							}
						}
					}
					_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, left, right), time.Unix(100, 0), at, def, 1)
					if err != nil || (len(fired) == 1) != (i == 3) {
						t.Fatalf("hand=%d at=%d fired=%v err=%v", hand, at, fired, err)
					}
				}
			}
		})
	}
}

func TestV2TrackingPresetRejectsTranslationAndMissingHead(t *testing.T) {
	e := &v2TrackingEvaluator{}
	def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "swipeRight", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}}}
	for i, at := range []uint64{0, 100, 200, 300} {
		x := 0.
		if i == 3 {
			x = .5
		}
		_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{x, 0, 0}, [3]float64{x - .2, 0, 0}, [3]float64{x + .2, 0, 0}), time.Unix(100, 0), at, def, 1)
		if err != nil || len(fired) > 0 {
			t.Fatalf("translation fired=%v err=%v", fired, err)
		}
	}
	frame := presetFrame(5, [3]float64{}, [3]float64{}, [3]float64{})
	frame.Samples = frame.Samples[1:]
	if _, fired, err := e.Accept(frame, time.Unix(100, 0), 400, def, 1); err != nil || len(fired) > 0 {
		t.Fatalf("missing head fired=%v err=%v", fired, err)
	}
	if e.states["g"].gesture.initialized {
		t.Fatal("missing head retained gesture history")
	}
}

func TestV2TrackingPresetSpreadAndClose(t *testing.T) {
	for _, preset := range []string{"spreadHands", "closeHands"} {
		e := &v2TrackingEvaluator{}
		def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "bothHands", Preset: preset, MinimumDistanceMeters: .3, WindowMilliseconds: 1200}}}
		for i, at := range []uint64{0, 100, 200, 300} {
			span := .4
			if preset == "closeHands" {
				span = .8
			}
			if i == 3 {
				span = 1.2 - span
			}
			_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, [3]float64{-span / 2, 0, 0}, [3]float64{span / 2, 0, 0}), time.Unix(100, 0), at, def, 1)
			if err != nil || (len(fired) == 1) != (i == 3) {
				t.Fatalf("preset=%s fired=%v err=%v", preset, fired, err)
			}
		}
	}
}

func TestV2TrackingPresetYawUsesInitialHeading(t *testing.T) {
	e := &v2TrackingEvaluator{}
	def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "pushForward", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}}}
	for i, at := range []uint64{0, 100, 200, 300} {
		left := [3]float64{-.2, 0, 0}
		if i == 3 {
			left[0] -= .3
		}
		frame := presetFrame(uint64(i+1), [3]float64{}, left, [3]float64{.2, 0, 0})
		frame.Samples[0].QuestLocalPose.Rotation = &presentationv2.Quaternion{Y: .7071067811865476, W: .7071067811865476}
		if i == 3 {
			frame.Samples[0].QuestLocalPose.Rotation = &presentationv2.Quaternion{W: 1}
		}
		_, fired, err := e.Accept(frame, time.Unix(100, 0), at, def, 1)
		if err != nil || (len(fired) == 1) != (i == 3) {
			t.Fatalf("fired=%v err=%v", fired, err)
		}
	}
}

func TestV2TrackingPresetStartsCanonicalTimeline(t *testing.T) {
	core, err := NewV2Session(json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"panel":{"id":"panel","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":0}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"cue-next","priority":1,"order":0,"trigger":{"kind":"motion","preset":"swipeUp","actor":{"kind":"system","source":"tracking"},"subject":{"kind":"anchor","owner":{"kind":"presenter"},"target":"eitherHand"},"minimumDistanceMeters":0.28,"windowMilliseconds":1200},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"timeline.play","timelineId":"fade","completion":"blocking","conflict":"reject"}],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[]}}}},"variables":{},"timelines":{"fade":{"id":"fade","owner":{"kind":"presentation"},"durationMilliseconds":100,"tracks":[{"target":{"nodeId":"panel","property":"opacity"},"keyframes":[{"timeMilliseconds":0,"value":0,"easingToNext":"linear"},{"timeMilliseconds":100,"value":1}]}]}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	core.checkpointMetadata = &realtimev2.DurableCheckpointEnvelope{AssignmentEpoch: 1}
	freezeV2WallClock(core)
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	for i, at := range []uint64{0, 100, 200, 300} {
		left := [3]float64{-.2, 0, 0}
		if i == 3 {
			left[1] = .3
		}
		_, events, err := core.AcceptTracking(context.Background(), identity, presetFrame(uint64(i+1), [3]float64{}, left, [3]float64{.2, 0, 0}), time.Unix(100, 0), at)
		if err != nil {
			t.Fatalf("at=%d: %v", at, err)
		}
		if i < 3 && len(events) > 0 {
			t.Fatalf("early events=%v", events)
		}
		if i == 3 && len(events) < 2 {
			t.Fatalf("missing cue/timeline events=%v", events)
		}
	}
	snapshot := core.Snapshot()
	if snapshot.Progression.GetTransitioning() == nil || len(snapshot.ActiveRuns) != 1 {
		t.Fatalf("motion did not start blocking timeline: %v", snapshot)
	}
	if _, err := core.AdvanceTo(context.Background(), 100); err != nil {
		t.Fatal(err)
	}
	if core.Snapshot().NodeStates[0].Opacity != 1 || core.Snapshot().Progression.CurrentStepId != "second" {
		t.Fatal("fade did not complete and enter next step")
	}
}

func TestV2TrackingPresetScopeChangeRequiresNewRest(t *testing.T) {
	e := &v2TrackingEvaluator{}
	def := v2TrackingDefinition{CurrentStepID: "one", Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "swipeRight", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}}}
	for i, at := range []uint64{0, 100, 200, 300, 400, 500, 600, 700, 800, 900} {
		x := 0.
		if i >= 3 {
			x = float64(i-2) * .3
		}
		if i >= 6 {
			x = .9
		}
		if i == 9 {
			x = 1.2
		}
		if i == 4 {
			def.CurrentStepID = "two"
			def.StepEntryEpoch++
		}
		_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, [3]float64{x, 0, 0}, [3]float64{.2, 0, 0}), time.Unix(100, 0), at, def, 1)
		if err != nil || (len(fired) == 1) != (i == 3 || i == 9) {
			t.Fatalf("at=%d fired=%v err=%v", at, fired, err)
		}
	}
}

func TestV2TrackingPresetRejectsIncorrectOrUnpreparedMotion(t *testing.T) {
	for _, test := range []struct {
		name    string
		window  uint64
		samples [][3]float64
		times   []uint64
	}{
		{"before rest", 1200, [][3]float64{{0, 0, 0}, {.4, 0, 0}}, []uint64{0, 100}},
		{"wrong direction", 1200, [][3]float64{{0, 0, 0}, {0, 0, 0}, {0, 0, 0}, {-.4, 0, 0}}, []uint64{0, 100, 200, 300}},
		{"off axis", 1200, [][3]float64{{0, 0, 0}, {0, 0, 0}, {0, 0, 0}, {.3, .5, 0}}, []uint64{0, 100, 200, 300}},
		{"window expired", 150, [][3]float64{{0, 0, 0}, {0, 0, 0}, {0, 0, 0}, {.1, 0, 0}, {.4, 0, 0}}, []uint64{0, 100, 200, 300, 400}},
		{"tracking gap", 1200, [][3]float64{{0, 0, 0}, {0, 0, 0}, {0, 0, 0}, {.4, 0, 0}}, []uint64{0, 100, 200, 800}},
	} {
		t.Run(test.name, func(t *testing.T) {
			e := &v2TrackingEvaluator{}
			def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "swipeRight", MinimumDistanceMeters: .28, WindowMilliseconds: test.window}}}
			for i, left := range test.samples {
				_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, left, [3]float64{.2, 0, 0}), time.Unix(100, 0), test.times[i], def, 1)
				if err != nil || len(fired) > 0 {
					t.Fatalf("at=%d fired=%v err=%v", test.times[i], fired, err)
				}
			}
		})
	}
}

func TestV2TrackingPresetRequiresBothArmsToSpread(t *testing.T) {
	e := &v2TrackingEvaluator{}
	def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "bothHands", Preset: "spreadHands", MinimumDistanceMeters: .3, WindowMilliseconds: 1200}}}
	for i, at := range []uint64{0, 100, 200, 300} {
		right := .2
		if i == 3 {
			right = .6
		}
		_, fired, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, [3]float64{-.2, 0, 0}, [3]float64{right, 0, 0}), time.Unix(100, 0), at, def, 1)
		if err != nil || len(fired) > 0 {
			t.Fatalf("one moving arm fired=%v err=%v", fired, err)
		}
	}
}

func TestV2TrackingPresetDefinitionRejectsInvalidTargetAndPreset(t *testing.T) {
	for _, test := range []struct{ preset, target, kind string }{{"unknown", "eitherHand", "motion"}, {"swipeRight", "bothHands", "motion"}, {"spreadHands", "eitherHand", "motion"}, {"swipeUp", "head", "motion"}, {"swipeUp", "eitherHand", "zoneEdge"}, {"", "bothHands", "motion"}} {
		cue := v2TrackingCue{ID: "g", Kind: test.kind, Preset: test.preset, HandTarget: test.target, SubjectKind: "anchor", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}
		if err := v2TrackingValidateDefinition(v2TrackingDefinition{Cues: []v2TrackingCue{cue}}); err == nil {
			t.Fatalf("accepted %+v", test)
		}
	}
}

func TestV2TrackingRejectedFrameBreaksArmGesture(t *testing.T) {
	e := &v2TrackingEvaluator{}
	def := v2TrackingDefinition{Cues: []v2TrackingCue{{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "swipeRight", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}}}
	for i, at := range []uint64{0, 100, 200} {
		if _, _, err := e.Accept(presetFrame(uint64(i+1), [3]float64{}, [3]float64{}, [3]float64{}), time.Unix(100, 0), at, def, 1); err != nil {
			t.Fatal(err)
		}
	}
	invalid := presetFrame(4, [3]float64{math.NaN(), 0, 0}, [3]float64{}, [3]float64{})
	if _, _, err := e.Accept(invalid, time.Unix(100, 0), 250, def, 1); err == nil {
		t.Fatal("accepted invalid frame")
	}
	if _, fired, err := e.Accept(presetFrame(5, [3]float64{}, [3]float64{.4, 0, 0}, [3]float64{}), time.Unix(100, 0), 300, def, 1); err != nil || len(fired) > 0 {
		t.Fatalf("invalid frame bridged gesture fired=%v err=%v", fired, err)
	}
}

func TestV2TrackingPresetMissingRequiredPosesBreaksGesture(t *testing.T) {
	for _, missing := range []string{"headRotation", "bothHands", "selectedHand"} {
		t.Run(missing, func(t *testing.T) {
			e := &v2TrackingEvaluator{}
			cue := v2TrackingCue{ID: "g", Kind: "motion", SubjectKind: "anchor", HandTarget: "eitherHand", Preset: "swipeRight", MinimumDistanceMeters: .28, WindowMilliseconds: 1200}
			if missing == "bothHands" {
				cue.HandTarget, cue.Preset = "bothHands", "spreadHands"
			}
			if missing == "selectedHand" {
				cue.HandTarget = "leftHand"
			}
			def := v2TrackingDefinition{Cues: []v2TrackingCue{cue}}
			for i, at := range []uint64{0, 100, 200, 300} {
				frame := presetFrame(uint64(i+1), [3]float64{}, [3]float64{-.2, 0, 0}, [3]float64{.2, 0, 0})
				if i == 3 {
					if missing == "headRotation" {
						frame.Samples[0].RotationAvailable = false
					} else {
						frame.Samples[1].PositionAvailable = false
					}
				}
				if _, fired, err := e.Accept(frame, time.Unix(100, 0), at, def, 1); err != nil || len(fired) > 0 {
					t.Fatalf("fired=%v err=%v", fired, err)
				}
			}
			if e.states["g"].gesture.initialized {
				t.Fatal("missing pose retained history")
			}
		})
	}
}
