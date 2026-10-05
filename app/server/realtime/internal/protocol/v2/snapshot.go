package protocolv2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

// ValidateSnapshot verifies the exact active resource closure against a trusted
// catalog. Authoritative Flow/Cue validation remains owned by the Runtime Core.
func ValidateSnapshot(snapshot *realtimev2.CanonicalRuntimeSnapshot, catalog *presentationv2.ProjectedRuntimeCatalog, assignmentEpoch uint64) error {
	if err := ValidateMessage(snapshot); err != nil {
		return err
	}
	if snapshot.StepExecution.StepEntryEpoch != snapshot.Progression.StepEntryEpoch {
		return fmt.Errorf("message_invalid: step execution epoch")
	}
	for _, run := range snapshot.ActiveRuns {
		if run.RunId.RunSequence > snapshot.LastAllocatedRunSequence {
			return fmt.Errorf("message_invalid: run allocator")
		}
	}
	return validateRuntimeState(snapshot, catalog, assignmentEpoch)
}

type runtimeStateCut interface {
	GetProgression() *realtimev2.ProgressionRuntimeState
	GetClock() *realtimev2.RuntimeClockSnapshot
	GetNodeStates() []*realtimev2.NodeRuntimeState
	GetSurfaceStates() []*realtimev2.SurfaceRuntimeState
	GetVariables() []*realtimev2.VariableState
	GetMediaStates() []*realtimev2.MediaRuntimeState
	GetModelClipStates() []*realtimev2.ModelClipRuntimeState
	GetActiveRuns() []*realtimev2.RuntimeRunSnapshot
}

func validateRuntimeState(snapshot runtimeStateCut, catalog *presentationv2.ProjectedRuntimeCatalog, assignmentEpoch uint64) error {
	if err := ValidateMessage(catalog); err != nil {
		return err
	}
	if assignmentEpoch == 0 {
		return fmt.Errorf("message_invalid: assignment epoch")
	}
	if snapshot.GetProgression().StepEnteredAtRuntimeTimeMs > snapshot.GetClock().RuntimeTimeMs {
		return fmt.Errorf("message_invalid: progression clock")
	}
	group := snapshot.GetProgression().CurrentGroupId
	active := func(owner *presentationv2.ResourceOwner) bool {
		return owner.GetPresentation() != nil || owner.GetGroup().GetGroupId() == group
	}
	nodes := make(map[string]*presentationv2.ProjectedNodeDefinition)
	surfaces := make(map[string]*presentationv2.ProjectedSurfaceDefinition)
	variables := make(map[string]*presentationv2.ProjectedVariableDefinition)
	models := make(map[string]*presentationv2.ProjectedNodeDefinition)
	clips := make(map[string]*presentationv2.ProjectedModelClipDefinition)
	for _, node := range catalog.Nodes {
		if active(node.Owner) {
			nodes[node.NodeId] = node
			if node.GetModel() != nil {
				models[node.NodeId] = node
			}
		}
	}
	for _, surface := range catalog.Surfaces {
		if active(surface.Owner) {
			surfaces[surface.SurfaceId] = surface
		}
	}
	for _, variable := range catalog.Variables {
		if active(variable.Owner) {
			variables[variable.VariableId] = variable
		}
	}
	for _, clip := range catalog.ModelClips {
		if active(clip.Owner) {
			clips[clip.ModelNodeId+"\x00"+clip.ClipId] = clip
		}
	}
	if len(snapshot.GetNodeStates()) != len(nodes) || len(snapshot.GetSurfaceStates()) != len(surfaces) || len(snapshot.GetVariables()) != len(variables) || len(snapshot.GetModelClipStates()) != len(models) {
		return fmt.Errorf("message_invalid: snapshot resource closure")
	}
	seen := make(map[string]bool)
	for _, state := range snapshot.GetNodeStates() {
		if nodes[state.NodeId] == nil || seen[state.NodeId] {
			return fmt.Errorf("message_invalid: node state closure")
		}
		seen[state.NodeId] = true
	}
	seen = make(map[string]bool)
	for _, state := range snapshot.GetSurfaceStates() {
		surface := surfaces[state.SurfaceId]
		if surface == nil || seen[state.SurfaceId] {
			return fmt.Errorf("message_invalid: surface state closure")
		}
		seen[state.SurfaceId] = true
		found := false
		for _, id := range surface.ReachableStateIds {
			if state.StateId == id {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("message_invalid: surface state reference")
		}
	}
	seen = make(map[string]bool)
	for _, state := range snapshot.GetVariables() {
		variable := variables[state.VariableId]
		if variable == nil || seen[state.VariableId] {
			return fmt.Errorf("message_invalid: variable state closure")
		}
		seen[state.VariableId] = true
		kind := presentationv2.ScalarType_SCALAR_TYPE_UNSPECIFIED
		switch state.Value.Value.(type) {
		case *presentationv2.ScalarValue_StringValue:
			kind = presentationv2.ScalarType_SCALAR_TYPE_STRING
		case *presentationv2.ScalarValue_NumberValue:
			kind = presentationv2.ScalarType_SCALAR_TYPE_NUMBER
		case *presentationv2.ScalarValue_BooleanValue:
			kind = presentationv2.ScalarType_SCALAR_TYPE_BOOLEAN
		case *presentationv2.ScalarValue_NullValue:
			kind = presentationv2.ScalarType_SCALAR_TYPE_NULL
		}
		if kind != variable.Type {
			return fmt.Errorf("message_invalid: variable scalar type")
		}
	}

	runs := make(map[uint64]*realtimev2.RuntimeRunSnapshot)
	blocking := make(map[uint64]bool)
	for _, run := range snapshot.GetActiveRuns() {
		if run.RunId.AssignmentEpoch != assignmentEpoch || runs[run.RunId.RunSequence] != nil || run.StartedAtRuntimeTimeMs > snapshot.GetClock().RuntimeTimeMs {
			return fmt.Errorf("message_invalid: run allocator, assignment or clock")
		}
		if owner := run.Owner.GetGroup(); owner != nil && (owner.GroupId != group || owner.GroupEntryEpoch != snapshot.GetProgression().GroupEntryEpoch) {
			return fmt.Errorf("message_invalid: run owner epoch")
		}
		runs[run.RunId.RunSequence] = run
		if run.Completion == presentationv2.RunCompletion_RUN_COMPLETION_BLOCKING {
			blocking[run.RunId.RunSequence] = true
		}
		switch body := run.Run.(type) {
		case *realtimev2.RuntimeRunSnapshot_SurfaceTransition:
			surface := surfaces[body.SurfaceTransition.SurfaceId]
			if surface == nil {
				return fmt.Errorf("message_invalid: transition surface")
			}
			if body.SurfaceTransition.FromStateId == body.SurfaceTransition.ToStateId {
				return fmt.Errorf("message_invalid: same state transition")
			}
			from, to := false, false
			for _, id := range surface.ReachableStateIds {
				from = from || id == body.SurfaceTransition.FromStateId
				to = to || id == body.SurfaceTransition.ToStateId
			}
			if !from || !to || snapshot.GetClock().RuntimeTimeMs-run.StartedAtRuntimeTimeMs >= body.SurfaceTransition.DurationMs {
				return fmt.Errorf("message_invalid: transition state or deadline")
			}
		case *realtimev2.RuntimeRunSnapshot_Timeline:
			found := false
			for _, timeline := range catalog.Timelines {
				if timeline.TimelineId == body.Timeline.TimelineId && active(timeline.Owner) {
					found = true
					if snapshot.GetClock().RuntimeTimeMs-run.StartedAtRuntimeTimeMs >= timeline.DurationMs {
						return fmt.Errorf("message_invalid: timeline deadline")
					}
				}
			}
			if !found {
				return fmt.Errorf("message_invalid: timeline reference")
			}
		case *realtimev2.RuntimeRunSnapshot_Media:
			if surfaces[body.Media.SurfaceId] == nil || !surfaces[body.Media.SurfaceId].HasVideo {
				return fmt.Errorf("message_invalid: media target")
			}
		case *realtimev2.RuntimeRunSnapshot_ModelClip:
			if models[body.ModelClip.ModelNodeId] == nil {
				return fmt.Errorf("message_invalid: model target")
			}
			validateClip := func(playback *realtimev2.ClipPlayback, retainTerminalPose bool) error {
				clip := clips[body.ModelClip.ModelNodeId+"\x00"+playback.ClipId]
				if clip == nil || clip.ModelAssetId != models[body.ModelClip.ModelNodeId].GetModel().ModelAssetId {
					return fmt.Errorf("message_invalid: model clip reference")
				}
				return validatePlaybackClock(playback.Playback, snapshot.GetClock().RuntimeTimeMs, clip.DurationMs, playback.Speed, playback.Loop || retainTerminalPose)
			}
			if single := body.ModelClip.GetSingle(); single != nil {
				if err := validateClip(single, false); err != nil {
					return err
				}
			} else if crossfade := body.ModelClip.GetCrossfade(); crossfade != nil {
				if crossfade.FromIsHeld && crossfade.From.Playback.GetPaused() == nil {
					return fmt.Errorf("message_invalid: held crossfade source must be paused")
				}
				if err := validateClip(crossfade.From, true); err != nil {
					return err
				}
				if err := validateClip(crossfade.To, true); err != nil {
					return err
				}
				if err := validatePlaybackClock(crossfade.TransitionClock, snapshot.GetClock().RuntimeTimeMs, crossfade.DurationMs, 1, false); err != nil {
					return err
				}
			}
		}
	}
	phase := snapshot.GetProgression().GetTransitioning()
	if phase == nil && len(blocking) != 0 {
		return fmt.Errorf("message_invalid: stable phase has blocking runs")
	}
	if phase != nil {
		if len(phase.BlockingRunIds) != len(blocking) {
			return fmt.Errorf("message_invalid: blocking run closure")
		}
		phaseSeen := make(map[uint64]bool)
		for _, id := range phase.BlockingRunIds {
			if id.AssignmentEpoch != assignmentEpoch || !blocking[id.RunSequence] || phaseSeen[id.RunSequence] {
				return fmt.Errorf("message_invalid: blocking run reference")
			}
			phaseSeen[id.RunSequence] = true
		}
	}
	for _, state := range snapshot.GetSurfaceStates() {
		count := 0
		for _, run := range runs {
			if transition := run.GetSurfaceTransition(); transition != nil && transition.SurfaceId == state.SurfaceId {
				count++
				if !proto.Equal(state.TransitionRunId, run.RunId) || state.StateId != transition.ToStateId {
					return fmt.Errorf("message_invalid: transition state disagreement")
				}
			}
		}
		if count > 1 || count == 0 && state.TransitionRunId != nil {
			return fmt.Errorf("message_invalid: transition run closure")
		}
	}
	expectedMedia := 0
	for _, surface := range surfaces {
		if surface.HasVideo {
			expectedMedia++
		}
	}
	if len(snapshot.GetMediaStates()) != expectedMedia {
		return fmt.Errorf("message_invalid: media state closure")
	}
	seen = make(map[string]bool)
	for _, state := range snapshot.GetMediaStates() {
		if surfaces[state.SurfaceId] == nil || !surfaces[state.SurfaceId].HasVideo || seen[state.SurfaceId] {
			return fmt.Errorf("message_invalid: media state target")
		}
		seen[state.SurfaceId] = true
		if state.GetActive() != nil {
			run := runs[state.GetActive().RunId.RunSequence]
			if run == nil || !proto.Equal(run.RunId, state.GetActive().RunId) || run.GetMedia() == nil || run.GetMedia().SurfaceId != state.SurfaceId || !proto.Equal(run.GetMedia().Playback, state.GetActive().Playback) {
				return fmt.Errorf("message_invalid: media run disagreement")
			}
		}
	}
	seen = make(map[string]bool)
	for _, state := range snapshot.GetModelClipStates() {
		if models[state.ModelNodeId] == nil || seen[state.ModelNodeId] {
			return fmt.Errorf("message_invalid: model state target")
		}
		seen[state.ModelNodeId] = true
		validateHeld := func(pose *realtimev2.ClipHeldPose) error {
			clip := clips[state.ModelNodeId+"\x00"+pose.ClipId]
			if clip == nil || clip.ModelAssetId != models[state.ModelNodeId].GetModel().ModelAssetId || pose.PositionMs > float64(clip.DurationMs) {
				return fmt.Errorf("message_invalid: held model clip reference or position")
			}
			return nil
		}
		if held := state.GetHeldClip(); held != nil {
			if err := validateHeld(held); err != nil {
				return err
			}
		}
		if blend := state.GetHeldBlend(); blend != nil {
			if err := validateHeld(blend.From); err != nil {
				return err
			}
			if err := validateHeld(blend.To); err != nil {
				return err
			}
		}
		if state.GetActive() != nil {
			run := runs[state.GetActive().RunId.RunSequence]
			if run == nil || !proto.Equal(run.RunId, state.GetActive().RunId) || run.GetModelClip() == nil || run.GetModelClip().ModelNodeId != state.ModelNodeId {
				return fmt.Errorf("message_invalid: model run disagreement")
			}
		}
	}
	for _, run := range runs {
		if media := run.GetMedia(); media != nil {
			matched := false
			for _, state := range snapshot.GetMediaStates() {
				current := state.GetActive()
				if state.SurfaceId == media.SurfaceId && current != nil && proto.Equal(current.RunId, run.RunId) && proto.Equal(current.Playback, media.Playback) {
					matched = true
				}
			}
			if !matched {
				return fmt.Errorf("message_invalid: media run lacks matching active state")
			}
		}
		if model := run.GetModelClip(); model != nil {
			matched := false
			for _, state := range snapshot.GetModelClipStates() {
				current := state.GetActive()
				if state.ModelNodeId == model.ModelNodeId && current != nil && proto.Equal(current.RunId, run.RunId) {
					matched = true
				}
			}
			if !matched {
				return fmt.Errorf("message_invalid: model run lacks matching active state")
			}
		}
	}
	return nil
}

func validatePlaybackClock(clock *realtimev2.PlaybackClock, runtimeTime, duration uint64, speed float64, allowPastEnd bool) error {
	position := clock.GetPaused().GetPositionMs()
	if playing := clock.GetPlaying(); playing != nil {
		if playing.ReferenceRuntimeTimeMs > runtimeTime {
			return fmt.Errorf("message_invalid: playback reference is in the future")
		}
		position = playing.PositionAtReferenceMs + float64(runtimeTime-playing.ReferenceRuntimeTimeMs)*speed
	}
	if math.IsInf(position, 0) || math.IsNaN(position) {
		return fmt.Errorf("message_invalid: computed playback position is not finite")
	}
	if !allowPastEnd && position >= float64(duration) {
		return fmt.Errorf("message_invalid: playback position exceeds duration")
	}
	return nil
}

// DecodeCheckpoint hashes the received bytes before parsing; protobuf unknown
// fields never change the integrity source through a parse/serialize roundtrip.
func DecodeCheckpoint(envelope, expected *realtimev2.DurableCheckpointEnvelope, catalog *presentationv2.ProjectedRuntimeCatalog) (*realtimev2.CanonicalRuntimeSnapshot, error) {
	if err := ValidateMessage(envelope); err != nil {
		return nil, err
	}
	if expected == nil || envelope.SessionId != expected.SessionId || envelope.RuntimeId != expected.RuntimeId || envelope.RuntimeKind != expected.RuntimeKind || envelope.AssignmentEpoch != expected.AssignmentEpoch || !proto.Equal(envelope.Publication, expected.Publication) || envelope.DefinitionHash != expected.DefinitionHash || envelope.RenderBundleHash != expected.RenderBundleHash {
		return nil, fmt.Errorf("publication_fence_mismatch: checkpoint identity")
	}
	digest := sha256.Sum256(envelope.CanonicalSnapshotPayload)
	if envelope.CanonicalSnapshotHash != "sha256:"+hex.EncodeToString(digest[:]) {
		return nil, fmt.Errorf("message_invalid: checkpoint payload hash")
	}
	snapshot := new(realtimev2.CanonicalRuntimeSnapshot)
	if err := proto.Unmarshal(envelope.CanonicalSnapshotPayload, snapshot); err != nil {
		return nil, fmt.Errorf("message_invalid: checkpoint protobuf: %w", err)
	}
	if snapshot.ReliableSequence != envelope.ReliableSequence {
		return nil, fmt.Errorf("message_invalid: checkpoint reliable sequence")
	}
	if _, err := DecodeRecoveryMetadata(envelope); err != nil {
		return nil, err
	}
	canonicalizeSamplePositions(snapshot.ProtoReflect())
	if err := ValidateSnapshot(snapshot, catalog, envelope.AssignmentEpoch); err != nil {
		return nil, err
	}
	snapshot.Clock.Status = &realtimev2.RuntimeClockSnapshot_Paused{Paused: &realtimev2.Paused{Reason: realtimev2.PauseReason_PAUSE_REASON_PROCESS_RECOVERED}}
	return snapshot, nil
}

// EncodeCheckpoint writes only known canonical fields and derives the cut and
// hash from deterministic snapshot bytes, never from caller-supplied claims.
func EncodeCheckpoint(snapshot *realtimev2.CanonicalRuntimeSnapshot, metadata *realtimev2.DurableCheckpointEnvelope, catalog *presentationv2.ProjectedRuntimeCatalog) (*realtimev2.DurableCheckpointEnvelope, error) {
	if metadata == nil {
		return nil, fmt.Errorf("message_invalid: checkpoint metadata")
	}
	if snapshot == nil {
		return nil, fmt.Errorf("message_invalid: canonical snapshot")
	}
	snapshot = proto.Clone(snapshot).(*realtimev2.CanonicalRuntimeSnapshot)
	canonicalizeSamplePositions(snapshot.ProtoReflect())
	if err := ValidateSnapshot(snapshot, catalog, metadata.AssignmentEpoch); err != nil {
		return nil, err
	}
	if err := rejectUnknown(snapshot.ProtoReflect()); err != nil {
		return nil, err
	}
	checkpoint := proto.Clone(metadata).(*realtimev2.DurableCheckpointEnvelope)
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	checkpoint.CanonicalSnapshotPayload = payload
	checkpoint.CanonicalSnapshotHash = "sha256:" + hex.EncodeToString(digest[:])
	checkpoint.ReliableSequence = snapshot.ReliableSequence
	if len(checkpoint.RecoveryPayload) != 0 {
		hash := sha256.Sum256(checkpoint.RecoveryPayload)
		checkpoint.RecoveryHash = proto.String("sha256:" + hex.EncodeToString(hash[:]))
	}
	if _, err := DecodeRecoveryMetadata(checkpoint); err != nil {
		return nil, err
	}
	if err := ValidateMessage(checkpoint); err != nil {
		return nil, err
	}
	if err := rejectUnknown(checkpoint.ProtoReflect()); err != nil {
		return nil, err
	}
	return checkpoint, nil
}
