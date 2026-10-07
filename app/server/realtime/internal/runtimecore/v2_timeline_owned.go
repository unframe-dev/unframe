package runtimecore

import (
	"encoding/json"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
)

func (s *V2Session) TimelineOwnedNodeProperties(snapshot *realtimev2.CanonicalRuntimeSnapshot) (map[string]map[string]bool, error) {
	owned := make(map[string]map[string]bool)
	for _, run := range snapshot.ActiveRuns {
		active := run.GetTimeline()
		if active == nil {
			continue
		}
		var timeline v2Timeline
		if err := json.Unmarshal(s.definition.Flow.Timelines[active.TimelineId], &timeline); err != nil || timeline.ID != active.TimelineId {
			return nil, ErrV2RuntimeDefinition
		}
		for _, track := range timeline.Tracks {
			if owned[track.Target.NodeID] == nil {
				owned[track.Target.NodeID] = make(map[string]bool)
			}
			owned[track.Target.NodeID][track.Target.Property] = true
		}
	}
	return owned, nil
}
