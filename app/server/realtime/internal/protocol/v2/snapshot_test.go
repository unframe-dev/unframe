package protocolv2

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func snapshotFixture() *realtimev2.CanonicalRuntimeSnapshot {
	return &realtimev2.CanonicalRuntimeSnapshot{
		SchemaVersion: 2, ReliableSequence: 3,
		Clock:              &realtimev2.RuntimeClockSnapshot{Status: &realtimev2.RuntimeClockSnapshot_Running{Running: &realtimev2.Running{}}},
		Progression:        &realtimev2.ProgressionRuntimeState{CurrentGroupId: "group", GroupEntryEpoch: 1, CurrentStepId: "step", StepEntryEpoch: 1, Phase: &realtimev2.ProgressionRuntimeState_Stable{Stable: &realtimev2.StableProgression{}}},
		StepExecution:      &realtimev2.StepExecutionSnapshot{StepEntryEpoch: 1},
		PresentationOrigin: &realtimev2.PresentationOrigin{Pose: &presentationv2.Pose{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}}},
	}
}
func checkpointFixture(t *testing.T) (*realtimev2.DurableCheckpointEnvelope, *presentationv2.ProjectedRuntimeCatalog) {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshotFixture())
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	return &realtimev2.DurableCheckpointEnvelope{
		SchemaVersion: 2, CheckpointSequence: 1, SessionId: "session", RuntimeId: "runtime", RuntimeKind: realtimev2.RuntimeKind_RUNTIME_KIND_CLOUD, AssignmentEpoch: 1, Publication: publication(), DefinitionHash: "sha256:" + strings.Repeat("b", 64), RenderBundleHash: "sha256:" + strings.Repeat("c", 64), ReliableSequence: 3, CanonicalSnapshotHash: "sha256:" + hex.EncodeToString(digest[:]), CanonicalSnapshotPayload: payload,
	}, &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2}
}
func TestCheckpointRecovery(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	snapshot, err := DecodeCheckpoint(envelope, envelope, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Clock.GetPaused().GetReason() != realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED || snapshot.ReliableSequence != 3 {
		t.Fatal("recovery must preserve cut and pause without advancing clock")
	}
	if err := ValidateSnapshot(snapshotFixture(), catalog, 1); err != nil {
		t.Fatal(err)
	}
}
func TestCheckpointRejectsPayloadTamperingAndTrustedFenceMismatch(t *testing.T) {
	envelope, catalog := checkpointFixture(t)
	altered := proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
	altered.CanonicalSnapshotPayload = append(altered.CanonicalSnapshotPayload, 0x78, 0x01)
	if _, err := DecodeCheckpoint(altered, envelope, catalog); err == nil {
		t.Fatal("tampered raw bytes admitted")
	}
	altered = proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
	altered.AssignmentEpoch = 2
	if _, err := DecodeCheckpoint(altered, envelope, catalog); err == nil {
		t.Fatal("wrong assignment admitted")
	}
	altered = proto.Clone(envelope).(*realtimev2.DurableCheckpointEnvelope)
	altered.ReliableSequence = 4
	if _, err := DecodeCheckpoint(altered, envelope, catalog); err == nil {
		t.Fatal("inconsistent outer cut admitted")
	}
}
func TestSnapshotRejectsMissingActiveOwnedResource(t *testing.T) {
	catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2, Nodes: []*presentationv2.ProjectedNodeDefinition{{NodeId: "node", Owner: &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}, Parent: &presentationv2.SpatialParent{Parent: &presentationv2.SpatialParent_Stage{Stage: &presentationv2.StageParent{}}}, Node: &presentationv2.ProjectedNodeDefinition_Container{Container: &presentationv2.ContainerNode{}}}}}
	if err := ValidateSnapshot(snapshotFixture(), catalog, 1); err == nil {
		t.Fatal("missing active Node state admitted")
	}
}

func TestCheckpointWriterRejectsUnknownSnapshotFields(t *testing.T) {
	metadata, catalog := checkpointFixture(t)
	snapshot := snapshotFixture()
	snapshot.Clock.ProtoReflect().SetUnknown([]byte{0xa0, 0x06, 0x01})
	if _, err := EncodeCheckpoint(snapshot, metadata, catalog); err == nil {
		t.Fatal("unknown snapshot fields written into durable canonical payload")
	}
	snapshot = snapshotFixture()
	checkpoint, err := EncodeCheckpoint(snapshot, metadata, catalog)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(checkpoint, metadata) {
		t.Fatal("canonical writer changed fixed checkpoint fixture")
	}
}

func TestSnapshotRejectsMediaRunWithoutMatchingActiveState(t *testing.T) {
	snapshot := snapshotFixture()
	_, catalog := checkpointFixture(t)
	catalog.Surfaces = []*presentationv2.ProjectedSurfaceDefinition{{SurfaceId: "surface", HostNodeId: "host", ReachableStateIds: []string{"state"}, HasVideo: true, PhysicalSizeMeters: &presentationv2.Vector2{X: 1, Y: 1}, LogicalSize: &presentationv2.Vector2{X: 1, Y: 1}, Fit: presentationv2.SurfaceFit_SURFACE_FIT_CONTAIN, Owner: &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}}}
	snapshot.SurfaceStates = []*realtimev2.SurfaceRuntimeState{{SurfaceId: "surface", StateId: "state"}}
	snapshot.MediaStates = []*realtimev2.MediaRuntimeState{{SurfaceId: "surface", State: &realtimev2.MediaRuntimeState_Stopped{Stopped: &realtimev2.MediaStoppedState{}}}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	snapshot.LastAllocatedRunSequence = 1
	snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}, Owner: &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}, Cause: &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "event", GroupId: "group", GroupEntryEpoch: 1, StepId: "step", StepEntryEpoch: 1}, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, Run: &realtimev2.RuntimeRunSnapshot_Media{Media: &realtimev2.MediaRunSnapshot{SurfaceId: "surface", Playback: &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{}}}}}}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("active Media Run with stopped state admitted")
	}
	snapshot.MediaStates[0].State = &realtimev2.MediaRuntimeState_Active{Active: &realtimev2.MediaActive{RunId: proto.Clone(snapshot.ActiveRuns[0].RunId).(*presentationv2.RuntimeRunId), Playback: proto.Clone(snapshot.ActiveRuns[0].GetMedia().Playback).(*realtimev2.PlaybackClock)}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	duplicate := proto.Clone(snapshot.ActiveRuns[0]).(*realtimev2.RuntimeRunSnapshot)
	duplicate.RunId.RunSequence = 2
	snapshot.LastAllocatedRunSequence = 2
	snapshot.ActiveRuns = append(snapshot.ActiveRuns, duplicate)
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("two active Media Runs for one state admitted")
	}
}

func TestSnapshotRejectsModelRunWithDefaultPose(t *testing.T) {
	snapshot := snapshotFixture()
	_, catalog := checkpointFixture(t)
	catalog.Nodes = []*presentationv2.ProjectedNodeDefinition{{NodeId: "model", Parent: &presentationv2.SpatialParent{Parent: &presentationv2.SpatialParent_Stage{Stage: &presentationv2.StageParent{}}}, Owner: &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}, Node: &presentationv2.ProjectedNodeDefinition_Model{Model: &presentationv2.ModelNode{ModelAssetId: "asset"}}}}
	catalog.ModelClips = []*presentationv2.ProjectedModelClipDefinition{{ModelNodeId: "model", ModelAssetId: "asset", ClipId: "clip", DurationMs: 1000, Owner: proto.Clone(catalog.Nodes[0].Owner).(*presentationv2.ResourceOwner)}}
	snapshot.NodeStates = []*realtimev2.NodeRuntimeState{{NodeId: "model", Transform: &presentationv2.Transform{Position: &presentationv2.Vector3{}, Rotation: &presentationv2.Quaternion{W: 1}, Scale: &presentationv2.Vector3{X: 1, Y: 1, Z: 1}}}}
	snapshot.ModelClipStates = []*realtimev2.ModelClipRuntimeState{{ModelNodeId: "model", State: &realtimev2.ModelClipRuntimeState_DefaultPose{DefaultPose: &realtimev2.DefaultModelPose{}}}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	snapshot.LastAllocatedRunSequence = 1
	snapshot.ActiveRuns = []*realtimev2.RuntimeRunSnapshot{{RunId: &presentationv2.RuntimeRunId{AssignmentEpoch: 1, RunSequence: 1}, Owner: &presentationv2.RuntimeRunOwner{Scope: &presentationv2.RuntimeRunOwner_Presentation{Presentation: &presentationv2.PresentationRunOwner{}}}, Cause: &presentationv2.RuntimeRunCause{CueId: "cue", CauseEventId: "event", GroupId: "group", GroupEntryEpoch: 1, StepId: "step", StepEntryEpoch: 1}, Completion: presentationv2.RunCompletion_RUN_COMPLETION_NON_BLOCKING, Run: &realtimev2.RuntimeRunSnapshot_ModelClip{ModelClip: &realtimev2.ModelClipRunSnapshot{ModelNodeId: "model", Phase: &realtimev2.ModelClipRunSnapshot_Single{Single: &realtimev2.ClipPlayback{ClipId: "clip", Speed: 1, Playback: &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{}}}}}}}}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("active Model Run with default pose admitted")
	}
	snapshot.ModelClipStates[0].State = &realtimev2.ModelClipRuntimeState_Active{Active: &realtimev2.ModelClipActive{RunId: proto.Clone(snapshot.ActiveRuns[0].RunId).(*presentationv2.RuntimeRunId)}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal(err)
	}
	snapshot.ActiveRuns[0].GetModelClip().GetSingle().ClipId = "unknown"
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("unknown model clip admitted")
	}
	playback := snapshot.ActiveRuns[0].GetModelClip().GetSingle()
	playback.ClipId = "clip"
	playback.Playback.GetPaused().PositionMs = 2000
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("non-loop playback beyond clip duration admitted")
	}
	playback.Loop = true
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal("loop playback uses an unwrapped sample position:", err)
	}
	playback.Playback.Clock = &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{}}
	playback.Speed = 1e308
	snapshot.Clock.RuntimeTimeMs = 2
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("loop playback with an overflowing computed position admitted")
	}
	playback.Speed = 1
	snapshot.Clock.RuntimeTimeMs = 2000
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal("finite unwrapped loop playback position:", err)
	}
	playback.Loop = false
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("non-loop playback with elapsed position beyond duration admitted")
	}
	snapshot.Clock.RuntimeTimeMs = 1000
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("single clip at its natural completion deadline admitted")
	}
	snapshot.Clock.RuntimeTimeMs = 2000
	snapshot.ActiveRuns[0].GetModelClip().Phase = &realtimev2.ModelClipRunSnapshot_Crossfade{Crossfade: &realtimev2.ModelClipCrossfade{
		From: &realtimev2.ClipPlayback{ClipId: "clip", Speed: 1, Playback: &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Paused{Paused: &realtimev2.PausedClock{PositionMs: 1000}}}},
		To:   playback, FromIsHeld: true, DurationMs: 100, Easing: presentationv2.Easing_EASING_LINEAR,
		TransitionClock: &realtimev2.PlaybackClock{Clock: &realtimev2.PlaybackClock_Playing{Playing: &realtimev2.PlayingClock{ReferenceRuntimeTimeMs: 1999}}},
	}}
	if err := ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatal("crossfade retains source and target terminal poses:", err)
	}
	snapshot.ActiveRuns[0].GetModelClip().GetCrossfade().TransitionClock.GetPlaying().ReferenceRuntimeTimeMs = 1900
	if err := ValidateSnapshot(snapshot, catalog, 1); err == nil {
		t.Fatal("crossfade at its transition deadline admitted")
	}
}
