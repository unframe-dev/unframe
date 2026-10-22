package authority

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	realtime "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type wireFixture struct {
	TypeName string          `json:"typeName"`
	Value    json.RawMessage `json:"value"`
	Hex      string          `json:"hex"`
}

func TestPresenterAuthorityWireConformance(t *testing.T) {
	path := filepath.Join("../../../../../../../packages/contracts/presentation/fixtures/wire", "presenter-authority.json")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []wireFixture
	if err := json.Unmarshal(content, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) == 0 {
		t.Fatal("presenter authority fixture is empty")
	}
	for _, fixture := range fixtures {
		t.Run(fixture.TypeName, func(t *testing.T) {
			message := authorityMessage(t, fixture.TypeName)
			if err := protojson.Unmarshal(fixture.Value, message); err != nil {
				t.Fatal(err)
			}
			wire, err := hex.DecodeString(fixture.Hex)
			if err != nil {
				t.Fatal(err)
			}
			decoded := message.ProtoReflect().New().Interface()
			if err := proto.Unmarshal(wire, decoded); err != nil {
				t.Fatal(err)
			}
			if !proto.Equal(message, decoded) {
				t.Fatal("Go decode differs from TypeScript fixture JSON")
			}
			if command, ok := decoded.(*realtime.GestureInputCommand); ok && command.GetCommandEpoch() != ^uint64(0) {
				t.Fatal("GestureInputCommand lost the full uint64 command epoch")
			}
			for _, candidate := range []proto.Message{message, decoded} {
				encoded, err := (proto.MarshalOptions{Deterministic: true}).Marshal(candidate)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(encoded, wire) {
					t.Fatal("Go encoded bytes differ from TypeScript fixture")
				}
			}
		})
	}
}

func authorityMessage(t *testing.T, typeName string) proto.Message {
	t.Helper()
	switch typeName {
	case "unframe.realtime.GestureInputCommand":
		return &realtime.GestureInputCommand{}
	case "unframe.realtime.ZoneInputCommand":
		return &realtime.ZoneInputCommand{}
	case "unframe.realtime.PresenterInputSynchronization":
		return &realtime.PresenterInputSynchronization{}
	case "unframe.realtime.InputSynchronizationAck":
		return &realtime.InputSynchronizationAck{}
	case "unframe.realtime.ProjectedAnchorBindingPatch":
		return &realtime.ProjectedAnchorBindingPatch{}
	case "unframe.realtime.RuntimeViewReplaced":
		return &realtime.RuntimeViewReplaced{}
	}
	t.Fatalf("unexpected fixture type %q", typeName)
	return nil
}
