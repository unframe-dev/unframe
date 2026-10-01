package protocolv2

import (
	"math"
	"strings"
	"testing"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	"google.golang.org/protobuf/proto"
)

func publication() *presentationv2.PublicationFence {
	return &presentationv2.PublicationFence{PresentationId: "demo", PublicationEpoch: 1, PublicationManifestHash: "sha256:" + strings.Repeat("a", 64)}
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
