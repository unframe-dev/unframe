package protocolv2

import (
	"fmt"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

// NegotiateControl never accepts client identity or a downgraded protocol.
func NegotiateControl(handshake *realtimev2.ControlHandshake, required []presentationv2.RuntimeCapability) error {
	if err := ValidateMessage(handshake); err != nil {
		return err
	}
	supported := make(map[presentationv2.RuntimeCapability]bool)
	for _, capability := range handshake.SupportedCapabilities {
		supported[capability] = true
	}
	previous := presentationv2.RuntimeCapability_RUNTIME_CAPABILITY_UNSPECIFIED
	for _, capability := range required {
		if capability <= previous || presentationv2.RuntimeCapability_name[int32(capability)] == "" || !supported[capability] {
			return fmt.Errorf("protocol_incompatible: required capability")
		}
		previous = capability
	}
	return nil
}

// ConnectionCursor owns the applied Control cut and latest-wins State sequence.
// It does not advance any application state when a wire item is rejected.
// The connection owner serializes admission and application before advancing it.
type ConnectionCursor struct {
	fence            *presentationv2.RuntimeProjectionFence
	connectionID     string
	reliableSequence uint64
	stateSequence    uint64
	nodes            map[string]*presentationv2.ProjectedNodeDefinition
}

func NewConnectionCursor(snapshot *realtimev2.ConnectionSnapshotEnvelope, expected *presentationv2.RuntimeProjectionFence, catalog *presentationv2.ProjectedRuntimeCatalog) (*ConnectionCursor, error) {
	if err := ValidateMessage(snapshot); err != nil {
		return nil, err
	}
	if err := ValidateMessage(expected); err != nil {
		return nil, err
	}
	if !proto.Equal(snapshot.Fence, expected) {
		return nil, fmt.Errorf("publication_fence_mismatch: connection snapshot")
	}
	instance := snapshot.ProjectionInstance
	projected := snapshot.Snapshot
	view := projected.RuntimeView
	if err := ValidateProjectedView(view, catalog); err != nil {
		return nil, err
	}
	if instance.ProjectionProfileId != expected.ProjectionProfileId || instance.AssignmentEpoch != expected.AssignmentEpoch || projected.ProjectionProfileId != expected.ProjectionProfileId || projected.AssignmentEpoch != expected.AssignmentEpoch || view.ProjectionProfileId != expected.ProjectionProfileId || view.AssignmentEpoch != expected.AssignmentEpoch || snapshot.ReliableSequence != projected.ReliableSequence || snapshot.ReliableSequence != view.BaseReliableSequence || view.PresentationOrigin.Version != expected.PresentationOriginVersion {
		return nil, fmt.Errorf("message_invalid: snapshot cut, projection or origin disagreement")
	}
	nodes := make(map[string]*presentationv2.ProjectedNodeDefinition)
	for _, node := range catalog.Nodes {
		nodes[node.NodeId] = proto.Clone(node).(*presentationv2.ProjectedNodeDefinition)
	}
	return &ConnectionCursor{fence: proto.Clone(expected).(*presentationv2.RuntimeProjectionFence), connectionID: snapshot.ConnectionId, reliableSequence: snapshot.ReliableSequence, nodes: nodes}, nil
}

func (cursor *ConnectionCursor) Resume() *realtimev2.ResumeCursor {
	return &realtimev2.ResumeCursor{PriorConnectionId: cursor.connectionID, AppliedReliableSequence: cursor.reliableSequence, Fence: proto.Clone(cursor.fence).(*presentationv2.RuntimeProjectionFence)}
}

func (cursor *ConnectionCursor) ApplyReliable(event *realtimev2.ProjectedReliableEvent) error {
	if err := ValidateMessage(event); err != nil {
		return err
	}
	if !proto.Equal(event.Fence, cursor.fence) {
		return fmt.Errorf("publication_fence_mismatch: reliable event")
	}
	if cursor.reliableSequence == ^uint64(0) || event.Sequence != cursor.reliableSequence+1 {
		return fmt.Errorf("message_invalid: reliable sequence gap")
	}
	cursor.reliableSequence = event.Sequence
	return nil
}

func (cursor *ConnectionCursor) ApplyAdvance(advance *realtimev2.ProjectionAdvance) error {
	if err := ValidateMessage(advance); err != nil {
		return err
	}
	if !proto.Equal(advance.Fence, cursor.fence) {
		return fmt.Errorf("publication_fence_mismatch: projection advance")
	}
	if advance.FromExclusive != cursor.reliableSequence || advance.ThroughSequence <= advance.FromExclusive {
		return fmt.Errorf("message_invalid: projection advance gap")
	}
	cursor.reliableSequence = advance.ThroughSequence
	return nil
}

// AdmitState rejects deltas after gaps and frames ahead of the Control cut. The
// application checks active property ownership before apply.
func (cursor *ConnectionCursor) AdmitState(frame *realtimev2.ElementStateFrame) error {
	if err := ValidateMessage(frame); err != nil {
		return err
	}
	if !proto.Equal(frame.Fence, cursor.fence) {
		return fmt.Errorf("publication_fence_mismatch: state frame")
	}
	if frame.BaseReliableSequence > cursor.reliableSequence || frame.FrameSequence <= cursor.stateSequence {
		return fmt.Errorf("message_invalid: stale or future state frame")
	}
	if frame.Kind == realtimev2.StateFrameKind_STATE_FRAME_KIND_DELTA && (cursor.stateSequence == 0 || frame.FrameSequence != cursor.stateSequence+1) {
		return fmt.Errorf("message_invalid: state delta gap; keyframe required")
	}
	seen := make(map[string]bool)
	for _, element := range frame.Elements {
		if cursor.nodes[element.ElementId] == nil {
			return fmt.Errorf("message_invalid: State frame addresses a profile-external Node")
		}
		if seen[element.ElementId] {
			return fmt.Errorf("message_invalid: duplicate state element")
		}
		seen[element.ElementId] = true
		node := element.Node
		if node.Active == nil && node.Visible == nil && node.Opacity == nil && node.Transform == nil {
			return fmt.Errorf("message_invalid: empty state patch")
		}
		if frame.Kind == realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME && (node.Active == nil || node.Visible == nil || node.Opacity == nil || node.Transform == nil) {
			return fmt.Errorf("message_invalid: incomplete keyframe patch")
		}
	}
	anchors := make(map[string]bool)
	for _, patch := range frame.AnchorBindings {
		node := cursor.nodes[patch.NodeId]
		if node == nil || node.Parent.GetPresenterAnchor() == nil || anchors[patch.NodeId] {
			return fmt.Errorf("message_invalid: Anchor binding is outside profile, not bound or duplicate")
		}
		anchors[patch.NodeId] = true
		if sample := patch.GetSample(); sample != nil {
			parent := node.Parent.GetPresenterAnchor()
			if (sample.Position != nil) != parent.FollowPosition || (sample.Rotation != nil) != parent.FollowRotation || sample.TrackingFrameSequence == 0 || sample.ObservedAtRuntimeMonotonicMs > frame.ProducedAtRuntimeMonotonicMs || frame.ProducedAtRuntimeMonotonicMs-sample.ObservedAtRuntimeMonotonicMs > 500 {
				return fmt.Errorf("message_invalid: Anchor sample components or freshness")
			}
		}
	}
	cursor.stateSequence = frame.FrameSequence
	return nil
}

// ValidateProjectedView checks the active resource closure and references at the
// received cut against the trusted profile catalog.
func ValidateProjectedView(view *realtimev2.ParticipantRuntimeView, catalog *presentationv2.ProjectedRuntimeCatalog) error {
	if err := ValidateMessage(view); err != nil {
		return err
	}
	return validateRuntimeState(view, catalog, view.AssignmentEpoch)
}
