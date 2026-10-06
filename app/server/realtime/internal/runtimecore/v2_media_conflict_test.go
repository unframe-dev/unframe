package runtimecore

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
	"google.golang.org/protobuf/proto"
)

func v2MediaConflictSession(t *testing.T, actions string) (*V2Session, *recordingV2Checkpoint) {
	t.Helper()
	definition := json.RawMessage(fmt.Sprintf(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"host-a":{"id":"host-a","kind":"surface","surfaceId":"a","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"host-b":{"id":"host-b","kind":"surface","surfaceId":"b","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"a":{"id":"a","hostNodeId":"host-a","initialStateId":"idle","states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]},"alt":{"id":"alt","contentOverrides":{},"enabledInteractionIds":[]}},"content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}},"b":{"id":"b","hostNodeId":"host-b","initialStateId":"idle","states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]}},"content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"start-media","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"start"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.play","surfaceId":"a"}],"next":{"kind":"stay"}},{"id":"start-b","priority":1,"order":1,"trigger":{"kind":"logicalInput","action":"start-b"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.play","surfaceId":"b"}],"next":{"kind":"stay"}},{"id":"act","priority":1,"order":1,"trigger":{"kind":"logicalInput","action":"act"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":%s,"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`, actions))
	if !json.Valid(definition) {
		t.Fatal("invalid media actor fixture")
	}
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"a":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":100,"loop":false}},"stateBindings":{"idle":{"kind":"artifacts","artifactIds":["video"]},"alt":{"kind":"artifacts","artifactIds":["video"]}}}}},"b":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":100,"loop":false}},"stateBindings":{"idle":{"kind":"artifacts","artifactIds":["video"]}}}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	writer := &recordingV2Checkpoint{}
	if err := core.ConfigureDurability(writer, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	freezeV2WallClock(core)
	return core, writer
}

func v2MediaActorInput(t *testing.T, core *V2Session, id, action string) (*realtimev2.CommandOutcome, []*realtimev2.ProjectedReliableEvent) {
	t.Helper()
	outcome, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: action})
	if err != nil {
		t.Fatal(err)
	}
	return outcome, events
}

func TestV2SameSurfaceStateAndMediaActionRejectsAtomicBatch(t *testing.T) {
	for _, transition := range []string{`{"kind":"cut"}`, `{"kind":"crossfade","durationMilliseconds":25,"easing":"linear","completion":"blocking"}`} {
		for _, media := range []string{`{"kind":"media.play","surfaceId":"a"}`, `{"kind":"media.pause","surfaceId":"a"}`, `{"kind":"media.seek","surfaceId":"a","positionSeconds":{"kind":"literal","value":0.04}}`} {
			for _, reverse := range []bool{false, true} {
				for _, active := range []bool{false, true} {
					name := fmt.Sprintf("transition=%s/media=%s/reverse=%t/active=%t", transition, media, reverse, active)
					t.Run(name, func(t *testing.T) {
						state := fmt.Sprintf(`{"kind":"surface.setState","surfaceId":"a","stateId":"alt","transition":%s}`, transition)
						actions := "[" + state + "," + media + "]"
						if reverse {
							actions = "[" + media + "," + state + "]"
						}
						core, writer := v2MediaConflictSession(t, actions)
						if active {
							v2MediaActorInput(t, core, "start-1", "start")
							if _, err := core.AdvanceTo(context.Background(), 20); err != nil {
								t.Fatal(err)
							}
						}
						before := core.Snapshot()
						outcome, events := v2MediaActorInput(t, core, "act-1", "act")
						if outcome.GetAccepted().GetCueBatchRejected().GetReason() != realtimev2.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT || len(events) != 1 || events[0].GetLogicalInputAccepted() == nil {
							t.Fatalf("batch was not rejected atomically: outcome=%#v events=%#v", outcome, events)
						}
						expected := proto.Clone(before).(*realtimev2.CanonicalRuntimeSnapshot)
						expected.ReliableSequence++
						if after := core.Snapshot(); !proto.Equal(after, expected) || writer.envelope.ReliableSequence != expected.ReliableSequence {
							t.Fatalf("rejected action changed canonical cut or checkpoint: before=%#v after=%#v", before, after)
						}
						stored, err := protocolv2.DecodeCheckpoint(writer.envelope, core.checkpointMetadata, core.validationCatalog)
						expected.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED}}
						if err != nil || !proto.Equal(stored, expected) {
							t.Fatalf("rejected action checkpoint contains candidate: stored=%#v err=%v", stored, err)
						}
					})
				}
			}
		}
	}
}

func TestV2DifferentSurfaceStateAndMediaActionsCommit(t *testing.T) {
	for _, transition := range []string{`{"kind":"cut"}`, `{"kind":"crossfade","durationMilliseconds":25,"easing":"linear","completion":"blocking"}`} {
		for _, media := range []struct {
			kind   string
			action string
		}{
			{kind: "play", action: `{"kind":"media.play","surfaceId":"b"}`},
			{kind: "pause", action: `{"kind":"media.pause","surfaceId":"b"}`},
			{kind: "seek", action: `{"kind":"media.seek","surfaceId":"b","positionSeconds":{"kind":"literal","value":0.04}}`},
		} {
			for _, reverse := range []bool{false, true} {
				t.Run(fmt.Sprintf("transition=%s/media=%s/reverse=%t", transition, media.kind, reverse), func(t *testing.T) {
					state := fmt.Sprintf(`{"kind":"surface.setState","surfaceId":"a","stateId":"alt","transition":%s}`, transition)
					actions := "[" + state + "," + media.action + "]"
					if reverse {
						actions = "[" + media.action + "," + state + "]"
					}
					core, _ := v2MediaConflictSession(t, actions)
					if media.kind != "play" {
						v2MediaActorInput(t, core, "start-b-1", "start-b")
						if _, err := core.AdvanceTo(context.Background(), 20); err != nil {
							t.Fatal(err)
						}
					}
					outcome, events := v2MediaActorInput(t, core, "act-1", "act")
					cut := core.Snapshot()
					run := mediaRun(cut, "b")
					active := mediaState(cut, "b").GetActive()
					if outcome.GetAccepted().GetCueCommitted() == nil || run == nil || active == nil || !proto.Equal(active.RunId, run.RunId) || !proto.Equal(active.Playback, run.GetMedia().Playback) {
						t.Fatalf("different surfaces conflicted: outcome=%#v events=%#v", outcome, events)
					}
					var a *realtimev2.SurfaceRuntimeState
					for _, surface := range cut.SurfaceStates {
						if surface.SurfaceId == "a" {
							a = surface
						}
					}
					if a == nil || a.StateId != "alt" || transition == `{"kind":"cut"}` && a.TransitionRunId != nil || transition != `{"kind":"cut"}` && a.TransitionRunId == nil {
						t.Fatalf("surface state incoherent after commit: %#v", a)
					}
					seenMedia, seenState := false, false
					for _, event := range events {
						switch media.kind {
						case "play":
							seenMedia = seenMedia || event.GetMediaStarted() != nil && proto.Equal(event.GetMediaStarted().Run, run) && active.Playback.GetPlaying() != nil && active.Playback.GetPlaying().PositionAtReferenceMs == 0
						case "pause":
							seenMedia = seenMedia || event.GetMediaPaused() != nil && proto.Equal(event.GetMediaPaused().Run, run) && event.GetMediaPaused().PositionMs == active.Playback.GetPaused().GetPositionMs() && active.Playback.GetPaused().GetPositionMs() == 20
						case "seek":
							seenMedia = seenMedia || event.GetMediaSeeked() != nil && proto.Equal(event.GetMediaSeeked().Run, run) && proto.Equal(event.GetMediaSeeked().Playback, active.Playback) && active.Playback.GetPlaying().GetPositionAtReferenceMs() == 40 && active.Playback.GetPlaying().GetReferenceRuntimeTimeMs() == 20
						}
						if transition == `{"kind":"cut"}` {
							changed := event.GetSurfaceStateChanged()
							seenState = seenState || changed != nil && changed.SurfaceId == "a" && changed.FromStateId == "idle" && changed.StateId == a.StateId
						} else {
							started := event.GetSurfaceTransitionStarted()
							seenState = seenState || started != nil && started.SurfaceId == "a" && started.FromStateId == "idle" && started.StateId == a.StateId && proto.Equal(started.RunId, a.TransitionRunId)
						}
					}
					if !seenMedia || !seenState {
						t.Fatalf("missing coherent committed action events: %#v cut=%#v", events, cut)
					}
				})
			}
		}
	}
}

func TestV2StateOnlyStopsOldMediaRunBeforeTransition(t *testing.T) {
	for _, transition := range []string{`{"kind":"cut"}`, `{"kind":"crossfade","durationMilliseconds":25,"easing":"linear","completion":"blocking"}`} {
		t.Run(transition, func(t *testing.T) {
			actions := fmt.Sprintf(`[{"kind":"surface.setState","surfaceId":"a","stateId":"alt","transition":%s}]`, transition)
			core, _ := v2MediaConflictSession(t, actions)
			v2MediaActorInput(t, core, "start-1", "start")
			if _, err := core.AdvanceTo(context.Background(), 20); err != nil {
				t.Fatal(err)
			}
			outcome, events := v2MediaActorInput(t, core, "act-1", "act")
			if outcome.GetAccepted().GetCueCommitted() == nil || mediaRun(core.Snapshot(), "a") != nil || core.Snapshot().MediaStates[0].GetStopped().HeldPositionMs != 20 {
				t.Fatalf("state-only transition did not stop old media: outcome=%#v events=%#v cut=%#v", outcome, events, core.Snapshot())
			}
			stopIndex, stateIndex := -1, -1
			for index, event := range events {
				if event.GetMediaStopped() != nil {
					stopIndex = index
				}
				if event.GetSurfaceStateChanged() != nil || event.GetSurfaceTransitionStarted() != nil {
					stateIndex = index
				}
			}
			if stopIndex < 0 || stateIndex < 0 || stopIndex >= stateIndex {
				t.Fatalf("old media stop ordering=%#v", events)
			}
		})
	}
}
