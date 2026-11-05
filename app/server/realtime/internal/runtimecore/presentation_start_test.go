package runtimecore

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestViewerCanJoinBeforePresentationTimerStarts(t *testing.T) {
	ctx := context.Background()
	definition := json.RawMessage(`{"schemaVersion":1,"presentationId":"presentation-1","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"timer","priority":1,"order":0,"trigger":{"kind":"timer","afterMilliseconds":100},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"step","stepId":"second"}}]},"second":{"id":"second","cues":[]}}}}},"variables":{},"timelines":{}}`)
	runtime, err := NewV2Session(definition)
	if err != nil {
		t.Fatal(err)
	}
	runtime.WaitForPresentationStart()
	if err := runtime.JoinParticipant(ctx, session.Identity{Role: session.RoleViewer, ParticipantID: "viewer-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.AdvanceFromWall(ctx, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	before := runtime.Snapshot()
	if before.Clock.GetPaused() == nil || before.Clock.RuntimeTimeMs != 0 || before.Progression.CurrentStepId != "start" {
		t.Fatalf("viewer join advanced the waiting presentation: %v %v", before.Clock, before.Progression)
	}

	if err := runtime.StartPresentation(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.AdvanceTo(ctx, 99); err != nil {
		t.Fatal(err)
	}
	if step := runtime.Snapshot().Progression.CurrentStepId; step != "start" {
		t.Fatalf("timer fired before its deadline: %s", step)
	}
	if _, err := runtime.AdvanceTo(ctx, 100); err != nil {
		t.Fatal(err)
	}
	after := runtime.Snapshot()
	if after.Clock.GetRunning() == nil || after.Progression.CurrentStepId != "second" {
		t.Fatalf("timer did not advance after presentation start: %v %v", after.Clock, after.Progression)
	}
}

func TestPresentationStartIsAppliedOnlyOnce(t *testing.T) {
	ctx := context.Background()
	runtime, err := newV3RegressionSession(json.RawMessage(reviewDefinition))
	if err != nil {
		t.Fatal(err)
	}
	presenter := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	runtime.WaitForPresentationStart()
	resume := v3TestRuntimeControl(runtime, &realtime.RuntimeControlCommand{
		ClientEventId: "resume",
		Kind:          realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_RESUME,
	})
	if _, _, err := runtime.RuntimeControl(ctx, presenter, resume); err == nil {
		t.Fatal("presenter resumed before the Control Plane confirmed start")
	}
	if err := runtime.StartPresentation(ctx); err != nil {
		t.Fatal(err)
	}
	pause := v3TestRuntimeControl(runtime, &realtime.RuntimeControlCommand{
		ClientEventId: "pause",
		Kind:          realtime.RuntimeControlKind_RUNTIME_CONTROL_KIND_PAUSE,
	})
	if _, _, err := runtime.RuntimeControl(ctx, presenter, pause); err != nil {
		t.Fatal(err)
	}
	paused := runtime.Snapshot()
	if err := runtime.StartPresentation(ctx); err != nil {
		t.Fatal(err)
	}
	if current := runtime.Snapshot(); current.Clock.GetPaused() == nil || current.ReliableSequence != paused.ReliableSequence {
		t.Fatal("repeated start confirmation resumed an explicitly paused presentation")
	}
}
