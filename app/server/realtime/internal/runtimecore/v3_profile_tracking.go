package runtimecore

import (
	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	protocol "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
)

// ValidateTrackingProfile verifies that a projection can receive all tracking
// required by its visible anchors and effects before admitting the connection.
func (s *V2Session) ValidateTrackingProfile(profile *delivery.ProjectionProfileDescriptor) error {
	if profile == nil || profile.RuntimeCatalog == nil || protocol.ValidateMessage(profile.RuntimeCatalog) != nil {
		return ErrV2RuntimeDefinition
	}
	targets := make(map[presentation.AnchorTarget]bool)
	for _, target := range profile.RuntimeCatalog.TrackedPoseTargets {
		targets[target] = true
	}
	capabilities := make(map[presentation.RuntimeCapability]bool)
	for _, capability := range profile.RequiredRuntimeCapabilities {
		capabilities[capability] = true
	}
	if (len(targets) != 0) != capabilities[presentation.RuntimeCapability_RUNTIME_CAPABILITY_TRACKED_POSE_DELIVERY] {
		return ErrV2RuntimeDefinition
	}
	needsPresenterTracking := false
	for _, node := range s.definition.Scene.Nodes {
		if node.Parent.Kind == "anchor" {
			needsPresenterTracking = true
		}
	}
	required := make(map[presentation.AnchorTarget]bool)
	for _, node := range profile.RuntimeCatalog.Nodes {
		if anchor := node.Parent.GetPresenterAnchor(); anchor != nil {
			required[anchor.Target] = true
		}
	}
	visible := make(map[string]bool)
	for _, id := range profile.VisibleNodeIds {
		visible[id] = true
	}
	for _, group := range s.definition.Flow.Groups {
		for _, step := range group.Steps {
			for _, cue := range step.Cues {
				for _, action := range cue.Actions {
					if action.Kind == "effect.start" && action.Effect.Kind == "handGlow" {
						needsPresenterTracking = true
					}
					if action.Kind != "effect.start" || !visible[action.NodeID] {
						continue
					}
					if !capabilities[presentation.RuntimeCapability_RUNTIME_CAPABILITY_EFFECT_PLAYBACK] {
						return ErrV2RuntimeDefinition
					}
					if action.Effect.Kind == "handGlow" {
						target := presentation.AnchorTarget_ANCHOR_TARGET_LEFT_HAND
						if action.Effect.Hand == "right" {
							target = presentation.AnchorTarget_ANCHOR_TARGET_RIGHT_HAND
						}
						required[target] = true
					}
				}
			}
		}
	}
	if profile.Key != nil && profile.Key.Role == presentation.SessionRole_SESSION_ROLE_PRESENTER && needsPresenterTracking && !capabilities[presentation.RuntimeCapability_RUNTIME_CAPABILITY_TRACKING] {
		return ErrV2RuntimeDefinition
	}
	if len(required) != len(targets) {
		return ErrV2RuntimeDefinition
	}
	for target := range required {
		if !targets[target] {
			return ErrV2RuntimeDefinition
		}
	}
	return nil
}
