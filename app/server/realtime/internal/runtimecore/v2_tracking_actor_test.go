package runtimecore

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestV2TrackingFrameFiresCanonicalZoneCue(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","stage":{"zones":{"zone":{"id":"zone","owner":{"kind":"presentation"},"center":[0,0,0],"size":[2,2,2]}}},"scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"enter","priority":1,"order":0,"trigger":{"kind":"zoneEdge","actor":{"kind":"system","source":"tracking"},"subject":{"kind":"participant","owner":{"kind":"presenter"}},"zoneId":"zone","edge":"enter","dwellMilliseconds":0,"hysteresisMeters":0},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	calibration := trackingTestPose(0, 0, 0)
	outside := trackingTestFrame(1, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(2, 0, 0)))
	if _, events, err := core.AcceptTracking(context.Background(), identity, outside, time.Unix(100, 0), 1); err != nil || len(events) != 0 {
		t.Fatalf("outside events=%#v err=%v", events, err)
	}
	inside := trackingTestFrame(2, calibration, trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, trackingTestPose(0, 0, 0)))
	_, events, err := core.AcceptTracking(context.Background(), identity, inside, time.Unix(100, 1), 2)
	if err != nil || len(events) != 1 || events[0].GetCueAccepted() == nil || events[0].GetCueAccepted().CueId != "enter" || core.Snapshot().ReliableSequence != 1 {
		t.Fatalf("inside events=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
}

func TestV2AnchorBindingUsesFreshPresenterBodyAndExpiresAfterFiveHundredMs(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"badge":{"id":"badge","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"anchor","target":"body","owner":{"kind":"presenter"},"followPosition":true,"followRotation":false},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	core, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	nodes := core.Snapshot().NodeStates
	patches, err := core.ProjectedAnchorBindings(nodes, 1)
	if err != nil || len(patches) != 1 || patches[0].GetUnavailable() == nil {
		t.Fatalf("initial binding=%#v err=%v", patches, err)
	}
	pose := trackingTestPose(3, 0, 0)
	frame := trackingTestFrame(1, trackingTestPose(0, 0, 0), trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_BODY, pose))
	if _, _, err := core.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, frame, time.Unix(100, 0), 1); err != nil {
		t.Fatal(err)
	}
	patches, err = core.ProjectedAnchorBindings(nodes, 501)
	if err != nil || patches[0].GetSample() == nil || patches[0].GetSample().Position.X != 3 || patches[0].GetSample().Rotation != nil {
		t.Fatalf("fresh binding=%#v err=%v", patches, err)
	}
	patches, err = core.ProjectedAnchorBindings(nodes, 502)
	if err != nil || patches[0].GetUnavailable() == nil {
		t.Fatalf("stale binding=%#v err=%v", patches, err)
	}
	core.mu.Lock()
	core.snapshot.PresentationOrigin.Version++
	core.mu.Unlock()
	patches, err = core.ProjectedAnchorBindings(nodes, 2)
	if err != nil || patches[0].GetUnavailable() == nil {
		t.Fatalf("origin-changed binding=%#v err=%v", patches, err)
	}
	headDefinition := bytes.ReplaceAll(definition, []byte(`"target":"body"`), []byte(`"target":"head"`))
	headDefinition = bytes.ReplaceAll(headDefinition, []byte(`"followPosition":true,"followRotation":false`), []byte(`"followPosition":false,"followRotation":true`))
	head, err := NewV2Session(headDefinition)
	if err != nil {
		t.Fatal(err)
	}
	headSample := trackingTestSample(realtimev2.TrackedTarget_TRACKED_TARGET_HEAD, trackingTestPose(0, 0, 0))
	headSample.PositionAvailable = false
	if _, _, err := head.AcceptTracking(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, trackingTestFrame(1, trackingTestPose(0, 0, 0), headSample), time.Unix(100, 0), 1); err != nil {
		t.Fatal(err)
	}
	patches, err = head.ProjectedAnchorBindings(head.Snapshot().NodeStates, 2)
	if err != nil || patches[0].GetSample() == nil || patches[0].GetSample().Position != nil || patches[0].GetSample().Rotation == nil {
		t.Fatalf("head rotation-only=%#v err=%v", patches, err)
	}
}
