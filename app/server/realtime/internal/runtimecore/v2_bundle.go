package runtimecore

import (
	"encoding/json"
)

type v2RenderBundle struct {
	SchemaVersion uint32 `json:"schemaVersion"`
	Surfaces      map[string]struct {
		RenderSurfaces map[string]struct {
			Artifacts map[string]struct {
				Kind                 string `json:"kind"`
				DurationMilliseconds uint64 `json:"durationMilliseconds"`
				Loop                 bool   `json:"loop"`
			} `json:"artifacts"`
			StateBindings map[string]struct {
				Kind        string   `json:"kind"`
				ArtifactIDs []string `json:"artifactIds"`
			} `json:"stateBindings"`
		} `json:"renderSurfaces"`
	} `json:"surfaces"`
	Models map[string]struct {
		AssetID string `json:"assetId"`
		Clips   map[string]struct {
			SourceAnimationIndex uint32 `json:"sourceAnimationIndex"`
			DurationMilliseconds uint64 `json:"durationMilliseconds"`
		} `json:"clips"`
	} `json:"models"`
}

type v2ModelClipSpec struct {
	DurationMS           uint64
	SourceAnimationIndex uint32
}

func buildV2ModelClips(def v2Definition, raw json.RawMessage) (map[string]map[string]v2ModelClipSpec, error) {
	var bundle v2RenderBundle
	if json.Unmarshal(raw, &bundle) != nil || bundle.SchemaVersion != 2 {
		return nil, ErrV2RuntimeDefinition
	}
	models := make(map[string]map[string]v2ModelClipSpec)
	for nodeID, node := range def.Scene.Nodes {
		if node.Kind != "model" {
			continue
		}
		compiled, ok := bundle.Models[node.AssetID]
		if !ok || compiled.AssetID != node.AssetID || node.AssetID == "" {
			return nil, ErrV2RuntimeDefinition
		}
		clips := make(map[string]v2ModelClipSpec)
		for clipID, clip := range compiled.Clips {
			if clip.DurationMilliseconds == 0 {
				return nil, ErrV2RuntimeDefinition
			}
			clips[clipID] = v2ModelClipSpec{DurationMS: clip.DurationMilliseconds, SourceAnimationIndex: clip.SourceAnimationIndex}
		}
		models[nodeID] = clips
	}
	return models, nil
}

func buildV2MediaSpecs(def v2Definition, raw json.RawMessage) (map[string]map[string]v2MediaSpec, error) {
	var bundle v2RenderBundle
	if json.Unmarshal(raw, &bundle) != nil || bundle.SchemaVersion != 2 {
		return nil, ErrV2RuntimeDefinition
	}
	specs := make(map[string]map[string]v2MediaSpec)
	for surfaceID, surface := range def.Scene.Surfaces {
		videoNodeID := ""
		for contentID, node := range surface.Content.Nodes {
			if node.Kind == "video" {
				if videoNodeID != "" {
					return nil, ErrV2RuntimeDefinition
				}
				videoNodeID = contentID
			}
		}
		if videoNodeID == "" {
			continue
		}
		compiled, ok := bundle.Surfaces[surfaceID]
		if !ok {
			return nil, ErrV2RuntimeDefinition
		}
		host, ok := def.Scene.Nodes[surface.HostNodeID]
		if !ok {
			return nil, ErrV2RuntimeDefinition
		}
		states := make(map[string]v2MediaSpec)
		var canonicalDuration uint64
		for stateID, rawState := range surface.States {
			var state struct {
				ContentOverrides map[string]struct {
					Loop *bool `json:"loop"`
				} `json:"contentOverrides"`
			}
			if json.Unmarshal(rawState, &state) != nil {
				return nil, ErrV2RuntimeDefinition
			}
			loop := surface.Content.Nodes[videoNodeID].Loop
			if override, ok := state.ContentOverrides[videoNodeID]; ok && override.Loop != nil {
				loop = *override.Loop
			}
			seen := false
			for _, renderSurface := range compiled.RenderSurfaces {
				binding, ok := renderSurface.StateBindings[stateID]
				if !ok || binding.Kind != "artifacts" {
					continue
				}
				for _, artifactID := range binding.ArtifactIDs {
					artifact, ok := renderSurface.Artifacts[artifactID]
					if !ok {
						return nil, ErrV2RuntimeDefinition
					}
					if artifact.Kind != "video" {
						continue
					}
					if artifact.DurationMilliseconds == 0 || artifact.Loop != loop || canonicalDuration != 0 && artifact.DurationMilliseconds != canonicalDuration {
						return nil, ErrV2RuntimeDefinition
					}
					canonicalDuration = artifact.DurationMilliseconds
					seen = true
				}
			}
			if seen {
				states[stateID] = v2MediaSpec{SurfaceID: surfaceID, DurationMS: canonicalDuration, Loop: loop, Owner: host.Owner}
			}
		}
		specs[surfaceID] = states
	}
	return specs, nil
}
