package protocolv2

import (
	"math"
	"strings"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
)

func publication() *presentationv2.PublicationFence {
	return &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}
}

func TestNodeStatePatchAllowsOnlyPresentTransformComponents(t *testing.T) {
	partial := &presentationv2.Transform{Position: &presentationv2.Vector3{X: 1, Y: 2, Z: 3}}
	if err := ValidateMessage(&realtimev2.NodeStatePatch{Transform: partial}); err != nil {
		t.Fatalf("partial transform patch rejected: %v", err)
	}
	if err := ValidateMessage(partial); err == nil {
		t.Fatal("partial full transform admitted")
	}
	if err := ValidateMessage(&realtimev2.NodeStatePatch{Transform: &presentationv2.Transform{}}); err == nil {
		t.Fatal("empty transform patch admitted")
	}
	fence := &presentationv2.RuntimeProjectionFence{SessionId: "session-1", Publication: publication(), AssignmentEpoch: 1, ProjectionProfileId: "profile-1", PresentationOriginVersion: 1}
	frame := &realtimev2.ElementStateFrame{Fence: fence, FrameSequence: 1, Kind: realtimev2.StateFrameKind_STATE_FRAME_KIND_KEYFRAME, Elements: []*realtimev2.ElementStatePatch{{ElementId: "node-1", Node: &realtimev2.NodeStatePatch{Transform: partial}}}}
	if err := ValidateMessage(&realtimev2.StateServerItem{Item: &realtimev2.StateServerItem_StateFrame{StateFrame: frame}}); err != nil {
		t.Fatalf("nested partial transform patch rejected: %v", err)
	}
}

func TestPublicationAdmission(t *testing.T) {
	valid := publication()
	if err := ValidateMessage(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*presentationv2.PublicationFence){
		func(v *presentationv2.PublicationFence) { v.PublicationEpoch = 0 },
		func(v *presentationv2.PublicationFence) { v.PresentationId = "../" },
		func(v *presentationv2.PublicationFence) { v.PublicationManifestHash = strings.Repeat("a", 64) },
	} {
		invalid := proto.Clone(valid).(*presentationv2.PublicationFence)
		mutate(invalid)
		if err := ValidateMessage(invalid); err == nil {
			t.Fatal("invalid publication admitted")
		}
	}
}

func TestUnknownOptionalFieldAndUnknownRequiredVariant(t *testing.T) {
	valid := publication()
	valid.ProtoReflect().SetUnknown([]byte{0xa0, 0x06, 0x01})
	if err := ValidateMessage(valid); err != nil {
		t.Fatal(err)
	}
	item := &realtimev2.ControlClientItem{}
	item.ProtoReflect().SetUnknown([]byte{0xa2, 0x06, 0x00})
	if err := ValidateMessage(item); err == nil {
		t.Fatal("unknown required variant admitted")
	}
}

func TestDuplicateAndUnorderedCatalogKeysAreRejected(t *testing.T) {
	node := func(id string) *presentationv2.ProjectedNodeDefinition {
		return &presentationv2.ProjectedNodeDefinition{NodeId: id, Owner: &presentationv2.ResourceOwner{Scope: &presentationv2.ResourceOwner_Presentation{Presentation: &presentationv2.PresentationResourceOwner{}}}, Parent: &presentationv2.SpatialParent{Parent: &presentationv2.SpatialParent_Stage{Stage: &presentationv2.StageParent{}}}, Node: &presentationv2.ProjectedNodeDefinition_Container{Container: &presentationv2.ContainerNode{}}}
	}
	for _, ids := range [][]string{{"b", "a"}, {"a", "a"}} {
		catalog := &presentationv2.ProjectedRuntimeCatalog{CatalogContractVersion: 2, Nodes: []*presentationv2.ProjectedNodeDefinition{node(ids[0]), node(ids[1])}}
		if err := ValidateMessage(catalog); err == nil {
			t.Fatalf("catalog keys %v admitted", ids)
		}
	}
}

func TestQuaternionUsesSharedNormToleranceAndSign(t *testing.T) {
	for _, rotation := range []*presentationv2.Quaternion{{X: 0.7071067811865476, Y: -0.7071067811865476}, {W: 1 + 0.75e-9}} {
		if err := ValidateMessage(rotation); err != nil {
			t.Fatalf("contract quaternion rejected: %v", err)
		}
	}
	if err := ValidateMessage(&presentationv2.Quaternion{X: -0.7071067811865476, Y: 0.7071067811865476}); err == nil {
		t.Fatal("noncanonical sign admitted")
	}
}

func TestPlaybackPositionsCanonicalizeNegativeZeroButScalarDoesNot(t *testing.T) {
	position := &realtimev2.PausedClock{PositionMs: math.Copysign(0, -1)}
	if err := ValidateMessage(position); err != nil {
		t.Fatal(err)
	}
	if err := ValidateMessage(&presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NumberValue{NumberValue: math.Copysign(0, -1)}}); err == nil {
		t.Fatal("negative zero scalar admitted")
	}
	if err := ValidateMessage(&realtimev2.PausedClock{PositionMs: -1}); err == nil {
		t.Fatal("negative playback position admitted")
	}
}

func TestHeldMediaPositionsAreNonnegativeAndFinite(t *testing.T) {
	for _, position := range []float64{-1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		for _, message := range []proto.Message{
			&realtimev2.MediaStoppedState{HeldPositionMs: position},
			&realtimev2.MediaStoppedSeeked{SurfaceId: "surface", HeldPositionMs: position},
			&realtimev2.MediaStopped{SurfaceId: "surface", HeldPositionMs: position},
			&realtimev2.MediaCompleted{SurfaceId: "surface", HeldPositionMs: position},
		} {
			if err := ValidateMessage(message); err == nil {
				t.Fatalf("invalid held position admitted: %T %v", message, position)
			}
		}
	}
	for _, message := range []proto.Message{
		&realtimev2.MediaStoppedState{HeldPositionMs: math.Copysign(0, -1)},
		&realtimev2.MediaStoppedSeeked{SurfaceId: "surface", HeldPositionMs: math.Copysign(0, -1)},
	} {
		if err := ValidateMessage(message); err != nil {
			t.Fatalf("negative zero sample rejected: %T: %v", message, err)
		}
	}
}

func TestNilMarkerDoesNotSupplyRequiredOneof(t *testing.T) {
	for _, message := range []proto.Message{
		&presentationv2.ScalarValue{Value: &presentationv2.ScalarValue_NullValue{}},
		&realtimev2.ControlClientItem{Item: &realtimev2.ControlClientItem_Handshake{}},
	} {
		if err := ValidateMessage(message); err == nil {
			t.Fatalf("nil selected message admitted: %T", message)
		}
	}
}
