package conformance

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	deliveryv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery/v2"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime/v2"
	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type wireFixture struct {
	TypeName string          `json:"typeName"`
	Value    json.RawMessage `json:"value"`
	Hex      string          `json:"hex"`
}

func TestSharedWireConformance(t *testing.T) {
	for _, filename := range []string{"conformance.json", "valid-delivery.json"} {
		path := filepath.Join("../../../../../../packages/contracts/presentation/v2/fixtures/wire", filename)
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var fixtures []wireFixture
		if filename == "valid-delivery.json" {
			var fixture wireFixture
			if err := json.Unmarshal(content, &fixture); err != nil {
				t.Fatal(err)
			}
			fixtures = []wireFixture{fixture}
		} else if err := json.Unmarshal(content, &fixtures); err != nil {
			t.Fatal(err)
		}
		for _, fixture := range fixtures {
			t.Run(filename+"/"+fixture.TypeName, func(t *testing.T) {
				var message proto.Message
				switch fixture.TypeName {
				case "unframe.delivery.v2.DeliveryManifest":
					message = &deliveryv2.DeliveryManifest{}
				case "unframe.realtime.v2.ControlClientItem":
					message = &realtimev2.ControlClientItem{}
				default:
					t.Fatalf("unexpected fixture type %q", fixture.TypeName)
				}
				wire, err := hex.DecodeString(fixture.Hex)
				if err != nil {
					t.Fatal(err)
				}
				if err := protojson.Unmarshal(fixture.Value, message); err != nil {
					t.Fatal(err)
				}
				encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
				if err != nil {
					t.Fatal(err)
				}
				if filename == "conformance.json" && !bytes.Equal(encoded, wire) {
					t.Fatal("Go encoded bytes differ from TypeScript fixture")
				}
				decoded := proto.Clone(message)
				proto.Reset(decoded)
				if err := proto.Unmarshal(wire, decoded); err != nil {
					t.Fatal(err)
				}
				if !proto.Equal(decoded, message) {
					t.Fatal("Go decode differs from fixture JSON")
				}
				if filename == "valid-delivery.json" {
					roundtrip := proto.Clone(message)
					proto.Reset(roundtrip)
					if err := proto.Unmarshal(encoded, roundtrip); err != nil {
						t.Fatal(err)
					}
					if !proto.Equal(roundtrip, decoded) {
						t.Fatal("Go re-encode changed compiled Delivery semantics")
					}
				}
				if filename == "valid-delivery.json" {
					if err := protocolv2.ValidateMessage(decoded); err != nil {
						t.Fatal(err)
					}
					manifest := decoded.(*deliveryv2.DeliveryManifest)
					if len(manifest.GetProjectionProfile().GetRenderSurfaces()) < 2 ||
						len(manifest.GetProjectionProfile().GetSemanticSurfaces()) == 0 ||
						manifest.GetProjectionProfile().GetRuntimeCatalog() == nil {
						t.Fatal("compiled Delivery fixture lacks multi-partition semantics")
					}
				}
				future := append(append([]byte{}, wire...), 0x98, 0x06, 0x01)
				proto.Reset(decoded)
				if err := proto.Unmarshal(future, decoded); err != nil {
					t.Fatal(err)
				}
				preserved, err := proto.Marshal(decoded)
				if err != nil {
					t.Fatal(err)
				}
				if filename == "conformance.json" && !bytes.Equal(preserved, future) ||
					filename == "valid-delivery.json" && !bytes.HasSuffix(preserved, []byte{0x98, 0x06, 0x01}) {
					t.Fatal("unknown field was not preserved")
				}
			})
		}
	}
}
