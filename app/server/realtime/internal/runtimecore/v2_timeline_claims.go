package runtimecore

import "encoding/json"

func (s *V2Session) v2TimelineBatchConflict(cue v2Cue) (bool, error) {
	claimed := map[string]bool{}
	owned, err := s.TimelineOwnedNodeProperties(s.snapshot)
	if err != nil {
		return false, err
	}
	claim := func(key string) bool {
		if claimed[key] {
			return false
		}
		claimed[key] = true
		return true
	}
	for _, action := range cue.Actions {
		switch action.Kind {
		case "node.patch":
			for field := range action.Patch {
				properties := []string{field}
				if field == "transform" {
					properties = []string{"transform.position", "transform.rotation", "transform.scale"}
				}
				for _, property := range properties {
					if owned[action.NodeID][property] || !claim("node:"+action.NodeID+":"+property) {
						return true, nil
					}
				}
			}
		case "timeline.play", "timeline.stop":
			if !claim("timeline:" + action.TimelineID) {
				return true, nil
			}
			if action.Kind == "timeline.stop" {
				active := false
				for _, run := range s.snapshot.ActiveRuns {
					if run.GetTimeline().GetTimelineId() == action.TimelineID {
						active = true
					}
				}
				if !active {
					continue
				}
			}
			var timeline v2Timeline
			if json.Unmarshal(s.definition.Flow.Timelines[action.TimelineID], &timeline) != nil {
				return false, ErrV2RuntimeDefinition
			}
			for _, track := range timeline.Tracks {
				if action.Kind == "timeline.play" && owned[track.Target.NodeID][track.Target.Property] || !claim("node:"+track.Target.NodeID+":"+track.Target.Property) {
					return true, nil
				}
			}
		}
	}
	return false, nil
}
