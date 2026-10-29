package protocolv2

import (
	"fmt"

	presentationv2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// DecodeCheckpointFromAssignment requires an independently authorized source fence.
// A checkpoint's own identity is never sufficient authority to cross assignments.
func DecodeCheckpointFromAssignment(envelope, target, source *realtimev2.DurableCheckpointEnvelope, catalog *presentationv2.ProjectedRuntimeCatalog) (*realtimev2.CanonicalRuntimeSnapshot, error) {
	if source == nil || target == nil || envelope == nil || source.AssignmentEpoch == 0 || source.AssignmentEpoch > target.AssignmentEpoch || source.CheckpointSequence != envelope.CheckpointSequence || source.SessionId != target.SessionId || !proto.Equal(source.Publication, target.Publication) || source.DefinitionHash != target.DefinitionHash || source.RenderBundleHash != target.RenderBundleHash {
		return nil, fmt.Errorf("publication_fence_mismatch: checkpoint source")
	}
	if source.AssignmentEpoch == target.AssignmentEpoch && (source.RuntimeId != target.RuntimeId || source.RuntimeKind != target.RuntimeKind) {
		return nil, fmt.Errorf("publication_fence_mismatch: checkpoint source runtime")
	}
	snapshot, err := DecodeCheckpoint(envelope, source, catalog)
	if err != nil {
		return nil, err
	}
	if source.AssignmentEpoch < target.AssignmentEpoch {
		rebaseRuntimeRunIDs(snapshot.ProtoReflect(), target.AssignmentEpoch)
	}
	if err := ValidateSnapshot(snapshot, catalog, target.AssignmentEpoch); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func rebaseRuntimeRunIDs(message protoreflect.Message, epoch uint64) {
	if message.Descriptor().FullName() == "unframe.presentation.RuntimeRunId" {
		field := message.Descriptor().Fields().ByName("assignment_epoch")
		message.Set(field, protoreflect.ValueOfUint64(epoch))
		return
	}
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.IsMap() {
			if field.MapValue().Message() != nil {
				value.Map().Range(func(_ protoreflect.MapKey, v protoreflect.Value) bool {
					rebaseRuntimeRunIDs(v.Message(), epoch)
					return true
				})
			}
		} else if field.IsList() {
			if field.Message() != nil {
				for i := 0; i < value.List().Len(); i++ {
					rebaseRuntimeRunIDs(value.List().Get(i).Message(), epoch)
				}
			}
		} else if field.Message() != nil {
			rebaseRuntimeRunIDs(value.Message(), epoch)
		}
		return true
	})
}
