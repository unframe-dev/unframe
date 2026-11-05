package runtimecore

import (
	"math"
	"sort"

	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	protocol "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/proto"
)

type v3EffectConfiguration struct {
	Kind                 string                   `json:"kind"`
	Size                 float64                  `json:"size"`
	Color                *presentation.SrgbaColor `json:"color"`
	Speed                float64                  `json:"speed"`
	DurationMilliseconds uint64                   `json:"durationMilliseconds"`
	WaveCycles           float64                  `json:"waveCycles"`
	Hand                 string                   `json:"hand"`
}

func (c v3EffectConfiguration) wire() (*presentation.EffectConfiguration, error) {
	if c.Color == nil {
		return nil, ErrV2RuntimeDefinition
	}
	hand := presentation.EffectHand(0)
	if c.Kind == "handGlow" {
		hand = map[string]presentation.EffectHand{"left": 1, "right": 2}[c.Hand]
	}
	config := &presentation.EffectConfiguration{Kind: map[string]presentation.EffectKind{"wave": 1, "handGlow": 2, "dissolve": 3}[c.Kind], Size: c.Size, Color: proto.Clone(c.Color).(*presentation.SrgbaColor), Speed: c.Speed, DurationMs: c.DurationMilliseconds, WaveCycles: c.WaveCycles, Hand: hand}
	duration := math.Ceil(float64(c.DurationMilliseconds) / c.Speed)
	if duration < 1 || duration > 9007199254740991 {
		return nil, ErrV2RuntimeDefinition
	}
	if err := protocol.ValidateMessage(config); err != nil {
		return nil, ErrV2RuntimeDefinition
	}
	return config, nil
}
func effectRunsEvent(snapshot *realtime.CanonicalRuntimeSnapshot) *realtime.ProjectedReliableEvent {
	changed := proto.Clone(&realtime.EffectRunsChanged{EffectRuns: snapshot.EffectRuns}).(*realtime.EffectRunsChanged)
	return &realtime.ProjectedReliableEvent{Payload: &realtime.ProjectedReliableEvent_EffectRunsChanged{EffectRunsChanged: changed}}
}
func (s *V2Session) evaluateV3EffectActions(next *realtime.CanonicalRuntimeSnapshot, cue v2Cue, causeID string) ([]*realtime.ProjectedReliableEvent, *realtime.CueBatchRejected, error) {
	changed := false
	claims := map[string]bool{}
	reject := func() ([]*realtime.ProjectedReliableEvent, *realtime.CueBatchRejected, error) {
		return nil, &realtime.CueBatchRejected{CueId: cue.ID, Reason: realtime.CueRejectionReason_CUE_REJECTION_REASON_ACTION_BATCH_CONFLICT}, nil
	}
	for _, action := range cue.Actions {
		if action.Kind != "effect.start" && action.Kind != "effect.stop" {
			continue
		}
		if claims[action.EffectID] {
			return reject()
		}
		claims[action.EffectID] = true
		if action.EffectID == "" {
			return nil, nil, ErrV2RuntimeDefinition
		}
		if action.Kind == "effect.stop" {
			kept := filterV2Slice(next.EffectRuns, func(run *realtime.EffectRunSnapshot) bool { return run.EffectId != action.EffectID })
			changed = changed || len(kept) != len(next.EffectRuns)
			next.EffectRuns = kept
			continue
		}
		for _, run := range next.EffectRuns {
			if run.EffectId == action.EffectID || (run.NodeId == action.NodeID && run.Configuration.Kind == 3 && action.Effect.Kind == "dissolve") {
				return reject()
			}
		}
		if len(next.EffectRuns) >= 32 {
			return reject()
		}
		config, err := action.Effect.wire()
		if err != nil {
			return nil, nil, err
		}
		found := false
		for _, node := range next.NodeStates {
			if node.NodeId == action.NodeID {
				found = true
			}
		}
		node, exists := s.definition.Scene.Nodes[action.NodeID]
		if !found || !exists || !v2OwnerActive(action.Owner, next.Progression.CurrentGroupId) || (action.Owner.Kind == "presentation" && node.Owner.Kind == "group") {
			return nil, nil, ErrV2RuntimeDefinition
		}
		if next.LastAllocatedRunSequence == math.MaxUint64 {
			return nil, nil, ErrV2RuntimeDefinition
		}
		owner := &presentation.RuntimeRunOwner{Scope: &presentation.RuntimeRunOwner_Presentation{Presentation: &presentation.PresentationRunOwner{}}}
		if action.Owner.Kind == "group" {
			owner.Scope = &presentation.RuntimeRunOwner_Group{Group: &presentation.GroupRunOwner{GroupId: action.Owner.GroupID, GroupEntryEpoch: next.Progression.GroupEntryEpoch}}
		}
		epoch := uint64(1)
		if s.checkpointMetadata != nil {
			epoch = s.checkpointMetadata.AssignmentEpoch
		}
		if next.Clock.RuntimeTimeMs > math.MaxUint64-uint64(math.Ceil(float64(config.DurationMs)/config.Speed)) {
			return nil, nil, ErrV2RuntimeDefinition
		}
		next.LastAllocatedRunSequence++
		next.EffectRuns = append(next.EffectRuns, &realtime.EffectRunSnapshot{RunId: &presentation.RuntimeRunId{AssignmentEpoch: epoch, RunSequence: next.LastAllocatedRunSequence}, Owner: owner, Cause: &presentation.RuntimeRunCause{CueId: cue.ID, CauseEventId: causeID, GroupId: next.Progression.CurrentGroupId, GroupEntryEpoch: next.Progression.GroupEntryEpoch, StepId: next.Progression.CurrentStepId, StepEntryEpoch: next.Progression.StepEntryEpoch}, StartedAtRuntimeTimeMs: next.Clock.RuntimeTimeMs, EffectId: action.EffectID, NodeId: action.NodeID, Configuration: config, Seed: action.Seed, Status: realtime.EffectRunStatus_EFFECT_RUN_STATUS_ACTIVE})
		changed = true
	}
	if !changed {
		return nil, nil, nil
	}
	sort.Slice(next.EffectRuns, func(i, j int) bool { return next.EffectRuns[i].EffectId < next.EffectRuns[j].EffectId })
	return []*realtime.ProjectedReliableEvent{effectRunsEvent(next)}, nil, nil
}
func nextV3EffectDue(snapshot *realtime.CanonicalRuntimeSnapshot, target uint64) (*realtime.EffectRunSnapshot, uint64, error) {
	var selected *realtime.EffectRunSnapshot
	var deadline uint64
	for _, run := range snapshot.EffectRuns {
		if run.Status == realtime.EffectRunStatus_EFFECT_RUN_STATUS_RETAINED {
			continue
		}
		duration := math.Ceil(float64(run.Configuration.DurationMs) / run.Configuration.Speed)
		if duration < 1 || duration >= float64(math.MaxUint64) {
			return nil, 0, ErrV2RuntimeDefinition
		}
		d := uint64(duration)
		if run.StartedAtRuntimeTimeMs > math.MaxUint64-d {
			return nil, 0, ErrV2RuntimeDefinition
		}
		due := run.StartedAtRuntimeTimeMs + d
		if due <= target && (selected == nil || due < deadline || due == deadline && run.EffectId < selected.EffectId) {
			selected, deadline = run, due
		}
	}
	return selected, deadline, nil
}
func completeV3Effect(snapshot *realtime.CanonicalRuntimeSnapshot, run *realtime.EffectRunSnapshot) []*realtime.ProjectedReliableEvent {
	var events []*realtime.ProjectedReliableEvent
	if run.Configuration.Kind == presentation.EffectKind_EFFECT_KIND_WAVE {
		run.Status = realtime.EffectRunStatus_EFFECT_RUN_STATUS_RETAINED
	} else {
		snapshot.EffectRuns = filterV2Slice(snapshot.EffectRuns, func(r *realtime.EffectRunSnapshot) bool { return r != run })
		if run.Configuration.Kind == presentation.EffectKind_EFFECT_KIND_DISSOLVE {
			for _, node := range snapshot.NodeStates {
				if node.NodeId == run.NodeId {
					node.Visible = false
					events = append(events, &realtime.ProjectedReliableEvent{Payload: &realtime.ProjectedReliableEvent_NodeStateCommitted{NodeStateCommitted: &realtime.NodeStateCommitted{State: proto.Clone(node).(*realtime.NodeRuntimeState)}}})
				}
			}
		}
	}
	return append(events, effectRunsEvent(snapshot))
}

func validateV3EffectAction(action v2Action, def v2Definition) error {
	if action.Kind == "effect.stop" {
		if action.EffectID == "" {
			return ErrV2RuntimeDefinition
		}
		return nil
	}
	if _, err := action.Effect.wire(); err != nil {
		return err
	}
	if action.EffectID == "" || def.Scene.Nodes[action.NodeID].ID != action.NodeID {
		return ErrV2RuntimeDefinition
	}
	if action.Owner.Kind != "presentation" && (action.Owner.Kind != "group" || def.Flow.Groups[action.Owner.GroupID].ID != action.Owner.GroupID) {
		return ErrV2RuntimeDefinition
	}
	return nil
}
