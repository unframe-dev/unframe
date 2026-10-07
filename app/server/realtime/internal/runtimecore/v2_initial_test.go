package runtimecore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"testing"

	protocolv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/protocol/v2"
)

func TestV2DefinitionRejectsMediaActionsOutsidePublicSchema(t *testing.T) {
	for _, kind := range []string{"media.resume", "media.stop"} {
		t.Run(kind, func(t *testing.T) {
			definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"demo","scene":{"nodes":{},"surfaces":{}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[{"id":"invalid","priority":1,"order":0,"trigger":{"kind":"logicalInput","action":"next"},"firePolicy":{"kind":"repeatable"},"actions":[{"kind":"` + kind + `","surfaceId":"screen"}],"next":{"kind":"stay"}}]}}}},"variables":{},"timelines":{}}}`)
			if _, err := NewV2Session(definition); !errors.Is(err, ErrV2RuntimeDefinition) {
				t.Fatalf("schema-external media action %s admitted: %v", kind, err)
			}
		})
	}
}

func TestV2InitialSnapshotUsesDefinitionGroupAndOwnedResources(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"node-a":{"id":"node-a","kind":"container","owner":{"kind":"presentation"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"node-b":{"id":"node-b","kind":"surface","surfaceId":"surface-b","owner":{"kind":"group","groupId":"later"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface-b":{"id":"surface-b","hostNodeId":"node-b","initialStateId":"state-b","states":{"state-b":{}},"renderIntent":{"internalAnimation":{"kind":"none"}}}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}},"later":{"id":"later","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{"variable-a":{"id":"variable-a","owner":{"kind":"presentation"},"type":"number","initialValue":4}},"timelines":{}}}`)
	snapshot, err := NewV2InitialSnapshot(definition)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Progression.CurrentGroupId != "intro" || snapshot.Progression.CurrentStepId != "start" || snapshot.Progression.GroupEntryEpoch != 1 || snapshot.Progression.StepEntryEpoch != 1 || len(snapshot.NodeStates) != 1 || snapshot.NodeStates[0].NodeId != "node-a" || len(snapshot.SurfaceStates) != 0 || len(snapshot.Variables) != 1 || snapshot.Variables[0].Value.GetNumberValue() != 4 {
		t.Fatalf("initial snapshot = %#v", snapshot)
	}
	if err := protocolv2.ValidateMessage(snapshot); err != nil {
		t.Fatalf("initial snapshot wire validation: %v", err)
	}
}

func TestV2InitialSnapshotRejectsRuntimeKindsWithoutConsumer(t *testing.T) {
	base := `{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":%s,"surfaces":%s},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{},"timelines":{}}}`
	cases := []struct{ name, nodes, surfaces string }{
		{"model", `{"model":{"id":"model","kind":"model","owner":{"kind":"presentation"}}}`, `{}`},
		{"video", `{}`, `{"video":{"id":"video","renderIntent":{"internalAnimation":{"kind":"precomputed-video"}}}}`},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewV2InitialSnapshot(json.RawMessage(fmt.Sprintf(base, test.nodes, test.surfaces))); err != ErrV2RuntimeUnsupported {
				t.Fatalf("unsupported %s error = %v", test.name, err)
			}
		})
	}
}

func TestV2CanonicalCatalogCoversInactiveGroupResources(t *testing.T) {
	definition := json.RawMessage(`{"schemaVersion":2,"presentationId":"presentation-1","scene":{"nodes":{"a":{"id":"a","kind":"container","owner":{"kind":"presentation"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1},"b":{"id":"b","kind":"surface","surfaceId":"surface-b","owner":{"kind":"group","groupId":"later"},"parent":{"kind":"stage"},"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"active":true,"visible":true,"opacity":1}},"surfaces":{"surface-b":{"id":"surface-b","hostNodeId":"b","initialStateId":"state-b","states":{"state-b":{}},"physicalSizeMeters":[1,1],"logicalSize":[100,100],"fit":"contain"}}},"flow":{"initialGroupId":"intro","groups":{"intro":{"id":"intro","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}},"later":{"id":"later","initialStepId":"start","steps":{"start":{"id":"start","cues":[]}}}},"variables":{"v":{"id":"v","owner":{"kind":"presentation"},"type":"boolean","initialValue":true}},"timelines":{}}}`)
	catalog, err := BuildV2CanonicalCatalog(definition)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Nodes) != 2 || len(catalog.Surfaces) != 1 || len(catalog.Variables) != 1 || catalog.Surfaces[0].Owner.GetGroup().GroupId != "later" {
		t.Fatalf("catalog closure: %#v", catalog)
	}
	snapshot, err := NewV2InitialSnapshot(definition)
	if err != nil {
		t.Fatal(err)
	}
	if err := protocolv2.ValidateSnapshot(snapshot, catalog, 1); err != nil {
		t.Fatalf("snapshot closure: %v", err)
	}
}

func TestV2InitialSnapshotMatchesSharedDeclarativeConformance(t *testing.T) {
	raw, err := os.ReadFile("../../../../../packages/contracts/presentation/fixtures/initial-runtime-state.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Definition json.RawMessage `json:"definition"`
		Expected   json.RawMessage `json:"expected"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	snapshot, err := NewV2InitialSnapshot(fixture.Definition)
	if err != nil {
		t.Fatal(err)
	}
	expected := &realtimev2.CanonicalRuntimeSnapshot{}
	if err := protojson.Unmarshal(fixture.Expected, expected); err != nil {
		t.Fatal(err)
	}
	actual := &realtimev2.CanonicalRuntimeSnapshot{
		NodeStates:    snapshot.NodeStates,
		SurfaceStates: snapshot.SurfaceStates,
	}
	if !proto.Equal(actual, expected) {
		t.Fatalf("declarative initial state differs: actual %s expected %s", actual, expected)
	}
}
