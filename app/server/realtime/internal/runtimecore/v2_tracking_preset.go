package runtimecore

import (
	"math"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

type v2TrackingGestureState struct {
	initialized, armed, moving                           bool
	previousAt, restSince, anchorAt                      uint64
	previousLeft, previousRight, anchorLeft, anchorRight [3]float64
	leftAvailable, rightAvailable                        bool
	forward, right                                       [3]float64
}

func v2TrackingValidPreset(cue v2TrackingCue) bool {
	if cue.ID == "" || cue.Kind != "motion" || cue.SubjectKind != "anchor" {
		return false
	}
	switch cue.Preset {
	case "spreadHands", "closeHands":
		return cue.HandTarget == "bothHands"
	case "swipeLeft", "swipeRight", "swipeDown", "swipeUp", "pushForward", "pullBackward":
		return cue.HandTarget == "eitherHand" || cue.HandTarget == "leftHand" || cue.HandTarget == "rightHand"
	default:
		return false
	}
}

func v2GestureSubtract(a, b [3]float64) [3]float64 {
	return [3]float64{a[0] - b[0], a[1] - b[1], a[2] - b[2]}
}

func v2GestureLength(a [3]float64) float64 { return math.Hypot(math.Hypot(a[0], a[1]), a[2]) }

func v2GestureDot(a, b [3]float64) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }

func v2GesturePosition(p *presentationv2.Pose) [3]float64 {
	return [3]float64{p.Position.X, p.Position.Y, p.Position.Z}
}

func v2GestureAnchor(state *v2TrackingGestureState, at uint64, left, right [3]float64, head *presentationv2.Pose) {
	state.anchorAt, state.anchorLeft, state.anchorRight = at, left, right
	// Canonical presentation space uses -Z forward and +X right.
	forward := v2TrackingRotate(head.Rotation, &presentationv2.Vector3{Z: -1})
	length := math.Hypot(forward.X, forward.Z)
	if length < .03162277660168379 {
		right := v2TrackingRotate(head.Rotation, &presentationv2.Vector3{X: 1})
		forward.X, forward.Z = right.Z, -right.X
		length = math.Hypot(forward.X, forward.Z)
	}
	state.forward = [3]float64{forward.X / length, 0, forward.Z / length}
	state.right = [3]float64{-state.forward[2], 0, state.forward[0]}
}

func v2TrackingPreset(state *v2TrackingGestureState, cue v2TrackingCue, samples []v2PresentedTrackingSample, at uint64) bool {
	var head, leftSample, rightSample *v2PresentedTrackingSample
	for i := range samples {
		switch samples[i].Target {
		case realtimev2.TrackedTarget_TRACKED_TARGET_HEAD:
			head = &samples[i]
		case realtimev2.TrackedTarget_TRACKED_TARGET_LEFT_HAND:
			leftSample = &samples[i]
		case realtimev2.TrackedTarget_TRACKED_TARGET_RIGHT_HAND:
			rightSample = &samples[i]
		}
	}
	leftAvailable := leftSample != nil && leftSample.PositionAvailable && cue.HandTarget != "rightHand"
	rightAvailable := rightSample != nil && rightSample.PositionAvailable && cue.HandTarget != "leftHand"
	twoHands := cue.HandTarget == "bothHands"
	if head == nil || !head.PositionAvailable || !head.RotationAvailable || twoHands && (!leftAvailable || !rightAvailable) || !twoHands && !leftAvailable && !rightAvailable {
		*state = v2TrackingGestureState{}
		return false
	}
	var left, right [3]float64
	if leftAvailable {
		left = v2GestureSubtract(v2GesturePosition(leftSample.Pose), v2GesturePosition(head.Pose))
	}
	if rightAvailable {
		right = v2GestureSubtract(v2GesturePosition(rightSample.Pose), v2GesturePosition(head.Pose))
	}
	if !state.initialized || at <= state.previousAt || at-state.previousAt > 500 || state.leftAvailable != leftAvailable || state.rightAvailable != rightAvailable {
		*state = v2TrackingGestureState{initialized: true, previousAt: at, restSince: at, previousLeft: left, previousRight: right, leftAvailable: leftAvailable, rightAvailable: rightAvailable}
		return false
	}
	dt := float64(at-state.previousAt) / 1000
	still := (!leftAvailable || v2GestureLength(v2GestureSubtract(left, state.previousLeft)) <= .12*dt) && (!rightAvailable || v2GestureLength(v2GestureSubtract(right, state.previousRight)) <= .12*dt)
	state.previousAt, state.previousLeft, state.previousRight = at, left, right
	if !state.armed {
		if !still {
			state.restSince = at
		}
		if still && at-state.restSince >= 200 {
			state.armed = true
			v2GestureAnchor(state, at, left, right, head.Pose)
		}
		return false
	}
	if !state.moving && still {
		v2GestureAnchor(state, at, left, right, head.Pose)
		return false
	}
	state.moving = true
	elapsed := at - state.anchorAt
	if elapsed > cue.WindowMilliseconds {
		state.armed, state.moving, state.restSince = false, false, at
		return false
	}
	duration := float64(elapsed) / 1000
	matched := false
	if twoHands {
		matched = v2GestureMatchSeparation(state, cue, left, right, duration)
	} else {
		matched = leftAvailable && v2GestureMatchDirection(state, cue, v2GestureSubtract(left, state.anchorLeft), duration) || rightAvailable && v2GestureMatchDirection(state, cue, v2GestureSubtract(right, state.anchorRight), duration)
	}
	if !matched {
		return false
	}
	state.armed, state.moving, state.restSince = false, false, at
	return true
}

func v2GestureMatchDirection(state *v2TrackingGestureState, cue v2TrackingCue, displacement [3]float64, duration float64) bool {
	var direction [3]float64
	switch cue.Preset {
	case "swipeRight":
		direction = state.right
	case "swipeLeft":
		for i := range direction {
			direction[i] = -state.right[i]
		}
	case "swipeUp":
		direction[1] = 1
	case "swipeDown":
		direction[1] = -1
	case "pushForward":
		direction = state.forward
	case "pullBackward":
		for i := range direction {
			direction[i] = -state.forward[i]
		}
	}
	distance := v2GestureDot(displacement, direction)
	offAxis := displacement
	for i := range offAxis {
		offAxis[i] -= direction[i] * distance
	}
	return distance >= cue.MinimumDistanceMeters && distance/duration >= .25 && v2GestureLength(offAxis) <= distance*.65
}

func v2GestureMatchSeparation(state *v2TrackingGestureState, cue v2TrackingCue, left, right [3]float64, duration float64) bool {
	initial := v2GestureLength(v2GestureSubtract(state.anchorRight, state.anchorLeft))
	final := v2GestureLength(v2GestureSubtract(right, left))
	spread := cue.Preset == "spreadHands"
	if spread && (initial > .5 || final < .6) || !spread && (initial < .6 || final > .5) {
		return false
	}
	sign := 1.
	if !spread {
		sign = -1
	}
	distance := (final - initial) * sign
	midpoint := [3]float64{}
	for i := range midpoint {
		midpoint[i] = (state.anchorLeft[i] + state.anchorRight[i]) / 2
	}
	leftDistance := (v2GestureLength(v2GestureSubtract(left, midpoint)) - v2GestureLength(v2GestureSubtract(state.anchorLeft, midpoint))) * sign
	rightDistance := (v2GestureLength(v2GestureSubtract(right, midpoint)) - v2GestureLength(v2GestureSubtract(state.anchorRight, midpoint))) * sign
	return distance >= cue.MinimumDistanceMeters && distance/duration >= .25 && leftDistance >= .1 && rightDistance >= .1
}
