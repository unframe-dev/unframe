package runtimecore

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"github.com/unframe-dev/unframe/app/server/realtime/internal/session"
)

func TestV2MediaSpecsUseEffectiveStateLoopAndBoundVideoVariants(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"screen","owner":{"kind":"presentation"}}},"surfaces":{"screen":{"id":"screen","hostNodeId":"host","content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"renderIntent":{"internalAnimation":{"kind":"precomputed-video","durationMilliseconds":77}},"states":{"stopped":{"id":"stopped","contentOverrides":{}},"looping":{"id":"looping","contentOverrides":{"video":{"kind":"video","loop":true}}},"hidden":{"id":"hidden","contentOverrides":{}}}}}},"flow":{}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"screen":{"renderSurfaces":{"render":{"artifacts":{"nonloop":{"kind":"video","durationMilliseconds":100,"loop":false},"loop1":{"kind":"video","durationMilliseconds":100,"loop":true},"loop2":{"kind":"video","durationMilliseconds":100,"loop":true}},"stateBindings":{"stopped":{"kind":"artifacts","artifactIds":["nonloop"]},"looping":{"kind":"artifacts","artifactIds":["loop1","loop2"]}}}}}}}`)
	var def v2Definition
	if err := json.Unmarshal(definition, &def); err != nil {
		t.Fatal(err)
	}
	specs, err := buildV2MediaSpecs(def, bundle)
	if _, hasHidden := specs["screen"]["hidden"]; err != nil || specs["screen"]["stopped"].Loop || !specs["screen"]["looping"].Loop || specs["screen"]["looping"].DurationMS != 100 || hasHidden {
		t.Fatalf("specs=%#v error=%v", specs, err)
	}
	bad := json.RawMessage(`{"schemaVersion":2,"surfaces":{"screen":{"renderSurfaces":{"render":{"artifacts":{"nonloop":{"kind":"video","durationMilliseconds":100,"loop":false},"loop1":{"kind":"video","durationMilliseconds":100,"loop":true},"loop2":{"kind":"video","durationMilliseconds":100,"loop":false}},"stateBindings":{"stopped":{"kind":"artifacts","artifactIds":["nonloop"]},"looping":{"kind":"artifacts","artifactIds":["loop1","loop2"]}}}}}}}`)
	if _, err := buildV2MediaSpecs(def, bad); err == nil {
		t.Fatal("mixed loop variants admitted")
	}
}

func TestV2SessionWithBundleInitializesVideoMediaState(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"screen","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"screen":{"id":"screen","hostNodeId":"host","initialStateId":"idle","states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]}},"content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"play"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.play","surfaceId":"screen"}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	definition = bytes.Replace(definition, []byte(`"cues":[`), []byte(`"cues":[{"id":"complete","priority":2,"order":0,"trigger":{"kind":"mediaCompleted","surfaceId":"screen"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[],"next":{"kind":"stay"}},`), 1)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"screen":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":100,"loop":false}},"stateBindings":{"idle":{"kind":"artifacts","artifactIds":["video"]}}}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	cut := core.Snapshot()
	if len(cut.MediaStates) != 1 || cut.MediaStates[0].SurfaceId != "screen" || cut.MediaStates[0].GetStopped() == nil || core.mediaSpecs["screen"]["idle"].DurationMS != 100 {
		t.Fatalf("initial media state=%#v", cut.MediaStates)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-1", LogicalEventName: "play"})
	if err != nil || len(core.Snapshot().ActiveRuns) != 1 || core.Snapshot().MediaStates[0].GetActive() == nil {
		t.Fatalf("media play events=%#v snapshot=%#v err=%v", events, core.Snapshot(), err)
	}
	found := false
	for _, event := range events {
		found = found || event.GetMediaStarted() != nil
	}
	if !found {
		t.Fatalf("media play event missing: %#v", events)
	}
	completed, err := core.AdvanceTo(context.Background(), 150)
	if err != nil || len(core.Snapshot().ActiveRuns) != 0 || core.Snapshot().MediaStates[0].GetStopped().HeldPositionMs != 0 {
		t.Fatalf("media completion events=%#v cut=%#v err=%v", completed, core.Snapshot(), err)
	}
	found = false
	for _, event := range completed {
		found = found || event.GetMediaCompleted() != nil && event.GetMediaCompleted().HeldPositionMs == 100 && event.OccurredAtRuntimeTimeMs == 100
	}
	if !found {
		t.Fatalf("media completion event missing: %#v", completed)
	}
	if len(completed) != 2 || completed[1].GetCueAccepted().CueId != "complete" {
		t.Fatalf("media completion cue=%#v", completed)
	}
	hiddenDefinition := bytes.Replace(definition, []byte(`"states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]}}`), []byte(`"states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]},"hidden":{"id":"hidden","contentOverrides":{},"enabledInteractionIds":[]}}`), 1)
	hiddenDefinition = bytes.Replace(hiddenDefinition, []byte(`"cues":[`), []byte(`"cues":[{"id":"hide","priority":2,"order":1,"trigger":{"kind":"logicalInput","action":"hide"},"firePolicy":{"kind":"oncePerStepEntry"},"actions":[{"kind":"surface.setState","surfaceId":"screen","stateId":"hidden","transition":{"kind":"cut"}}],"next":{"kind":"stay"}},`), 1)
	hidden, err := NewV2SessionWithBundle(hiddenDefinition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := hidden.ConfigureDurability(&recordingV2Checkpoint{}, metadata, hidden.validationCatalog); err != nil {
		t.Fatal(err)
	}
	if _, _, err := hidden.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-2", LogicalEventName: "play"}); err != nil {
		t.Fatal(err)
	}
	if _, err := hidden.AdvanceTo(context.Background(), 25); err != nil {
		t.Fatal(err)
	}
	_, changed, err := hidden.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "hide-1", LogicalEventName: "hide"})
	if err != nil || len(hidden.Snapshot().ActiveRuns) != 0 || hidden.Snapshot().MediaStates[0].GetStopped().HeldPositionMs != 25 || hidden.Snapshot().SurfaceStates[0].StateId != "hidden" {
		t.Fatalf("state change=%#v cut=%#v err=%v", changed, hidden.Snapshot(), err)
	}
	stopIndex, stateIndex := -1, -1
	for i, event := range changed {
		if event.GetMediaStopped() != nil {
			stopIndex = i
		}
		if event.GetSurfaceStateChanged() != nil {
			stateIndex = i
		}
	}
	if stopIndex < 0 || stateIndex < 0 || stopIndex >= stateIndex {
		t.Fatalf("media stop must precede state change: %#v", changed)
	}
	outcome, noMedia, err := hidden.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-hidden", LogicalEventName: "play"})
	if err != nil || outcome.GetAccepted().GetCueBatchRejected() == nil || len(hidden.Snapshot().ActiveRuns) != 0 {
		t.Fatalf("hidden media action outcome=%#v events=%#v err=%v", outcome, noMedia, err)
	}
	controlsDefinition := bytes.Replace(definition, []byte(`"cues":[`), []byte(`"cues":[{"id":"pause","priority":2,"order":0,"trigger":{"kind":"logicalInput","action":"pause"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.pause","surfaceId":"screen"}],"next":{"kind":"stay"}},{"id":"seek","priority":2,"order":1,"trigger":{"kind":"logicalInput","action":"seek"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.seek","surfaceId":"screen","positionSeconds":{"kind":"literal","value":0.04}}],"next":{"kind":"stay"}},{"id":"resume","priority":2,"order":2,"trigger":{"kind":"logicalInput","action":"resume"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.play","surfaceId":"screen"}],"next":{"kind":"stay"}},`), 1)
	controls, err := NewV2SessionWithBundle(controlsDefinition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := controls.ConfigureDurability(&recordingV2Checkpoint{}, metadata, controls.validationCatalog); err != nil {
		t.Fatal(err)
	}
	input := func(id, name string) []*realtimev2.ProjectedReliableEvent {
		t.Helper()
		_, emitted, err := controls.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: name})
		if err != nil {
			t.Fatal(err)
		}
		return emitted
	}
	hasMediaEvent := func(events []*realtimev2.ProjectedReliableEvent, kind string) bool {
		for _, event := range events {
			switch kind {
			case "pause":
				if event.GetMediaPaused() != nil {
					return true
				}
			case "seek":
				if event.GetMediaSeeked() != nil {
					return true
				}
			case "resume":
				if event.GetMediaResumed() != nil {
					return true
				}
			}
		}
		return false
	}
	input("media-play", "play")
	if _, err := controls.AdvanceTo(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	paused := input("media-pause", "pause")
	if !hasMediaEvent(paused, "pause") {
		t.Fatalf("pause events=%#v", paused)
	}
	seeked := input("media-seek", "seek")
	if !hasMediaEvent(seeked, "seek") {
		t.Fatalf("seek events=%#v", seeked)
	}
	resumed := input("media-resume", "resume")
	if !hasMediaEvent(resumed, "resume") {
		t.Fatalf("resume events=%#v", resumed)
	}
	seekStopped, err := NewV2SessionWithBundle(controlsDefinition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := seekStopped.ConfigureDurability(&recordingV2Checkpoint{}, metadata, seekStopped.validationCatalog); err != nil {
		t.Fatal(err)
	}
	_, stoppedSeek, err := seekStopped.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "media-stopped-seek", LogicalEventName: "seek"})
	if err != nil {
		t.Fatal(err)
	}
	stoppedSeeked := false
	for _, event := range stoppedSeek {
		stoppedSeeked = stoppedSeeked || event.GetMediaStoppedSeeked() != nil
	}
	if !stoppedSeeked || seekStopped.Snapshot().MediaStates[0].GetStopped().HeldPositionMs != 40 {
		t.Fatalf("stopped seek=%#v cut=%#v", stoppedSeek, seekStopped.Snapshot())
	}
}

func TestV2MediaPlayResumesFromPublicDefinition(t *testing.T) {
	definition, err := os.ReadFile("testdata/media-public-definition.json")
	if err != nil {
		t.Fatal(err)
	}
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"video":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":1000,"loop":false}},"stateBindings":{"default":{"kind":"artifacts","artifactIds":["video"]}}}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	input := func(id, action string) []*realtimev2.ProjectedReliableEvent {
		t.Helper()
		_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: action})
		if err != nil {
			t.Fatal(err)
		}
		return events
	}
	input("play-1", "play")
	if _, err := core.AdvanceTo(context.Background(), 100); err != nil {
		t.Fatal(err)
	}
	input("pause-1", "pause")
	resumed := input("play-2", "play")
	for _, event := range resumed {
		if event.GetMediaResumed() != nil && core.Snapshot().MediaStates[0].GetActive() != nil {
			return
		}
	}
	t.Fatalf("public media.play did not resume paused run: %#v", resumed)
}

func TestV2SessionWithBundleInitializesModelCatalogFromArtifact(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if len(core.Snapshot().ModelClipStates) != 1 || core.Snapshot().ModelClipStates[0].GetDefaultPose() == nil || len(core.validationCatalog.ModelClips) != 1 || core.validationCatalog.ModelClips[0].DurationMs != 125 || core.validationCatalog.ModelClips[0].SourceAnimationIndex != 3 {
		t.Fatalf("model state=%#v catalog=%#v", core.Snapshot().ModelClipStates, core.validationCatalog.ModelClips)
	}
}

func TestV2ModelActionCompletesAtArtifactDeadline(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"play"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":1,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-1", LogicalEventName: "play"})
	if err != nil || len(core.Snapshot().ActiveRuns) != 1 {
		t.Fatalf("play=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
	completed, err := core.AdvanceTo(context.Background(), 150)
	if err != nil || len(core.Snapshot().ActiveRuns) != 0 || core.Snapshot().ModelClipStates[0].GetHeldClip() == nil {
		t.Fatalf("complete=%#v cut=%#v err=%v", completed, core.Snapshot(), err)
	}
	if len(completed) != 1 || completed[0].GetModelClipCompleted() == nil || completed[0].OccurredAtRuntimeTimeMs != 125 {
		t.Fatalf("events=%#v", completed)
	}
	ending, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := ending.ConfigureDurability(&recordingV2Checkpoint{}, metadata, ending.validationCatalog); err != nil {
		t.Fatal(err)
	}
	ending.ConfigureCompletion(&recordingV2Completion{})
	if _, _, err := ending.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-2", LogicalEventName: "play"}); err != nil {
		t.Fatal(err)
	}
	_, ended, err := ending.RuntimeControl(context.Background(), session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.RuntimeControlCommand{ClientEventId: "end-1", Kind: realtimev2.RuntimeControlKind_RUNTIME_CONTROL_KIND_END, PresentationOriginVersion: ending.Snapshot().PresentationOrigin.Version})
	if err != nil || len(ended) < 3 || ended[0].GetModelClipCanceled() == nil || ending.Snapshot().ModelClipStates[0].GetDefaultPose() == nil {
		t.Fatalf("end events=%#v cut=%#v err=%v", ended, ending.Snapshot(), err)
	}
	fadeDefinition := bytes.Replace(definition, []byte(`"cues":[`), []byte(`"cues":[{"id":"fade","priority":2,"order":0,"trigger":{"kind":"logicalInput","action":"fade"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.play","nodeId":"actor","clipId":"idle","speed":1,"loop":false,"completion":"nonBlocking","transition":{"kind":"crossfade","durationMilliseconds":20,"easing":"linear"}}],"next":{"kind":"stay"}},`), 1)
	fadeBundle := bytes.Replace(bundle, []byte(`"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125}`), []byte(`"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125},"idle":{"sourceAnimationIndex":4,"durationMilliseconds":100}`), 1)
	fading, err := NewV2SessionWithBundle(fadeDefinition, fadeBundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := fading.ConfigureDurability(&recordingV2Checkpoint{}, metadata, fading.validationCatalog); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fading.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "play-3", LogicalEventName: "play"}); err != nil {
		t.Fatal(err)
	}
	if _, err := fading.AdvanceTo(context.Background(), 125); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fading.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: "fade-1", LogicalEventName: "fade"}); err != nil {
		t.Fatal(err)
	}
	transitioned, err := fading.AdvanceTo(context.Background(), 145)
	if err != nil || len(transitioned) != 1 || transitioned[0].GetModelClipCrossfadeCompleted() == nil || len(fading.Snapshot().ActiveRuns) != 1 {
		t.Fatalf("crossfade=%#v cut=%#v err=%v", transitioned, fading.Snapshot(), err)
	}
	controlsDefinition := bytes.Replace(definition, []byte(`"cues":[`), []byte(`"cues":[{"id":"pause","priority":2,"order":0,"trigger":{"kind":"logicalInput","action":"pause"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.pause","nodeId":"actor"}],"next":{"kind":"stay"}},{"id":"resume","priority":2,"order":1,"trigger":{"kind":"logicalInput","action":"resume"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.resume","nodeId":"actor"}],"next":{"kind":"stay"}},{"id":"stop","priority":2,"order":2,"trigger":{"kind":"logicalInput","action":"stop"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.stop","nodeId":"actor"}],"next":{"kind":"stay"}},`), 1)
	controls, err := NewV2SessionWithBundle(controlsDefinition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	if err := controls.ConfigureDurability(&recordingV2Checkpoint{}, metadata, controls.validationCatalog); err != nil {
		t.Fatal(err)
	}
	inputModel := func(id, name string) []*realtimev2.ProjectedReliableEvent {
		t.Helper()
		_, emitted, err := controls.LogicalInput(session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}, &realtimev2.LogicalInputCommand{ClientEventId: id, LogicalEventName: name})
		if err != nil {
			t.Fatal(err)
		}
		return emitted
	}
	inputModel("model-play", "play")
	if _, err := controls.AdvanceTo(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	paused := inputModel("model-pause", "pause")
	if !hasV2ModelEvent(paused, "pause") {
		t.Fatalf("pause=%#v", paused)
	}
	resumed := inputModel("model-resume", "resume")
	if !hasV2ModelEvent(resumed, "resume") {
		t.Fatalf("resume=%#v", resumed)
	}
	if _, err := controls.AdvanceTo(context.Background(), 30); err != nil {
		t.Fatal(err)
	}
	stopped := inputModel("model-stop", "stop")
	if !hasV2ModelEvent(stopped, "stop") || controls.Snapshot().ModelClipStates[0].GetHeldClip() == nil || len(controls.Snapshot().ActiveRuns) != 0 {
		t.Fatalf("stop=%#v cut=%#v", stopped, controls.Snapshot())
	}
}

func hasV2ModelEvent(events []*realtimev2.ProjectedReliableEvent, kind string) bool {
	for _, event := range events {
		switch kind {
		case "pause":
			if event.GetModelClipPaused() != nil {
				return true
			}
		case "resume":
			if event.GetModelClipResumed() != nil {
				return true
			}
		case "stop":
			if event.GetModelClipStopped() != nil {
				return true
			}
		}
	}
	return false
}

func TestV2ModelGroupExitCancelsOwnedRunBeforeGroupEvents(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"actor":{"id":"actor","kind":"model","assetId":"avatar","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"play"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"modelClip.play","nodeId":"actor","clipId":"walk","speed":1,"loop":false,"completion":"nonBlocking","transition":{"kind":"immediate"}}],"next":{"kind":"stay"}},{"id":"leave","priority":1,"order":1,"trigger":{"kind":"logicalInput","action":"leave"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"group","groupId":"out"}}]}}},"out":{"id":"out","initialStepId":"empty","steps":{"empty":{"id":"empty","cues":[]}}}},"variables":{},"timelines":{}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{},"models":{"avatar":{"assetId":"avatar","clips":{"walk":{"sourceAnimationIndex":3,"durationMilliseconds":125}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "play-1", LogicalEventName: "play"}); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "leave-1", LogicalEventName: "leave"})
	if err != nil || len(core.Snapshot().ActiveRuns) != 0 || len(core.Snapshot().ModelClipStates) != 0 {
		t.Fatalf("group exit events=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
	cancel, exit := -1, -1
	for i, event := range events {
		if event.GetModelClipCanceled() != nil {
			cancel = i
		}
		if event.GetGroupExited() != nil {
			exit = i
		}
	}
	if cancel < 0 || exit < 0 || cancel >= exit {
		t.Fatalf("cancellation order=%#v", events)
	}
}

func TestV2MediaGroupExitCancelsOwnedRunBeforeGroupEvents(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{"host":{"id":"host","kind":"surface","surfaceId":"screen","owner":{"kind":"group","groupId":"intro"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"screen":{"id":"screen","hostNodeId":"host","initialStateId":"idle","states":{"idle":{"id":"idle","contentOverrides":{},"enabledInteractionIds":[]}},"content":{"kind":"structured","nodes":{"video":{"kind":"video","loop":false}}},"physicalSizeMeters":[1,1],"logicalSize":[1,1],"fit":"contain","renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"play","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"play"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"media.play","surfaceId":"screen"}],"next":{"kind":"stay"}},{"id":"leave","priority":1,"order":1,"trigger":{"kind":"logicalInput","action":"leave"},"firePolicy":{"kind":"repeatable"},"actions":[],"next":{"kind":"group","groupId":"out"}}]}}},"out":{"id":"out","initialStepId":"empty","steps":{"empty":{"id":"empty","cues":[]}}}},"variables":{},"timelines":{}}}`)
	bundle := json.RawMessage(`{"schemaVersion":2,"surfaces":{"screen":{"renderSurfaces":{"render":{"artifacts":{"video":{"kind":"video","durationMilliseconds":100,"loop":false}},"stateBindings":{"idle":{"kind":"artifacts","artifactIds":["video"]}}}}}}}`)
	core, err := NewV2SessionWithBundle(definition, bundle)
	if err != nil {
		t.Fatal(err)
	}
	metadata := &realtimev2.DurableCheckpointEnvelope{SchemaVersion: 2, SessionId: "session-1", RuntimeId: "runtime-1", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", RenderBundleHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := core.ConfigureDurability(&recordingV2Checkpoint{}, metadata, core.validationCatalog); err != nil {
		t.Fatal(err)
	}
	identity := session.Identity{Role: session.RolePresenter, ParticipantID: "presenter-1"}
	if _, _, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "play-1", LogicalEventName: "play"}); err != nil {
		t.Fatal(err)
	}
	_, events, err := core.LogicalInput(identity, &realtimev2.LogicalInputCommand{ClientEventId: "leave-1", LogicalEventName: "leave"})
	if err != nil || len(core.Snapshot().ActiveRuns) != 0 || len(core.Snapshot().MediaStates) != 0 {
		t.Fatalf("group exit events=%#v cut=%#v err=%v", events, core.Snapshot(), err)
	}
	cancel, exit := -1, -1
	for i, event := range events {
		if event.GetMediaCanceled() != nil {
			cancel = i
		}
		if event.GetGroupExited() != nil {
			exit = i
		}
	}
	if cancel < 0 || exit < 0 || cancel >= exit {
		t.Fatalf("cancellation order=%#v", events)
	}
}
