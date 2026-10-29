package protocolv2

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const (
	MaximumControlItemBytes          = 1048576
	MaximumStateItemBytes            = 262144
	MaximumCommandRecordBytes        = 1024
	MaximumCommandHistoryCount       = 1024
	MaximumCommandHistoryBytes       = 262144
	CommandHistorySyncCount          = 1000
	CommandHistorySyncBytes          = 245760
	MaximumCanonicalSnapshotBytes    = 786432
	MaximumStepStartStateBytes       = 65536
	MaximumStepStartHistoryBytes     = 524288
	MaximumRecoveryMetadataBytes     = 262144
	MaximumCheckpointJSONBytes       = 1572864
	MaximumInputSynchronizationBytes = 4096
)

var commandID = regexp.MustCompile(`^([1-9][0-9]*):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// ValidCommandID binds a canonical UUID v4 to the command generation.
func ValidCommandID(id string, epoch uint64) bool {
	match := commandID.FindStringSubmatch(id)
	return epoch != 0 && match != nil && match[1] == strconv.FormatUint(epoch, 10)
}

// KnownSize measures deterministic protobuf bytes excluding unknown fields.
func KnownSize(message proto.Message) int {
	if message == nil {
		return 0
	}
	copy := proto.Clone(message)
	discardUnknown(copy.ProtoReflect())
	return proto.Size(copy)
}

func discardUnknown(message protoreflect.Message) {
	message.SetUnknown(nil)
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Kind() == protoreflect.MessageKind {
			if field.IsList() {
				for i := 0; i < value.List().Len(); i++ {
					discardUnknown(value.List().Get(i).Message())
				}
			} else {
				discardUnknown(value.Message())
			}
		}
		return true
	})
}

func validateAuthority(message protoreflect.Message, path string) error {
	invalid := func() error { return fmt.Errorf("message_invalid: %s authority", path) }
	get := func(name string) protoreflect.Value {
		return message.Get(message.Descriptor().Fields().ByName(protoreflect.Name(name)))
	}
	name := message.Descriptor().Name()
	limit := 0
	switch name {
	case "ControlClientItem", "ControlServerItem":
		limit = MaximumControlItemBytes
	case "StateClientItem", "StateServerItem":
		limit = MaximumStateItemBytes
	case "CanonicalRuntimeSnapshot":
		limit = MaximumCanonicalSnapshotBytes
	case "StepStartState":
		limit = MaximumStepStartStateBytes
	case "RuntimeRecoveryMetadata":
		limit = MaximumRecoveryMetadataBytes
	case "RuntimeCommandHistory":
		limit = MaximumCommandRecordBytes
	case "PresenterInputSynchronization", "InputSynchronizationAck":
		limit = MaximumInputSynchronizationBytes
	}
	if limit != 0 && KnownSize(message.Interface()) > limit {
		return fmt.Errorf("message_invalid: %s serialized byte limit", path)
	}
	switch name {
	case "RuntimeCapacityFault":
		if get("step_start_state_bytes").Uint() == 0 || get("step_start_history_bytes").Uint() == 0 || get("canonical_snapshot_bytes").Uint() == 0 {
			return invalid()
		}
	case "PresenterStepSelectionCatalog":
		list := get("reached_steps").List()
		previous := ""
		for i := 0; i < list.Len(); i++ {
			entry := list.Get(i).Message()
			fields := entry.Descriptor().Fields()
			groupID := entry.Get(fields.ByName("group_id")).String()
			stepID := entry.Get(fields.ByName("step_id")).String()
			key := groupID + "\x00" + stepID
			if !identifier.MatchString(groupID) || !identifier.MatchString(stepID) || key <= previous {
				return invalid()
			}
			previous = key
		}
	case "ControlHandshake", "StateHandshake", "ControlConnected":
		field := "supported_capabilities"
		if name == "ControlConnected" {
			field = "required_capabilities"
		}
		required := map[protoreflect.EnumNumber]bool{8: false, 9: false, 10: false}
		list := get(field).List()
		for i := 0; i < list.Len(); i++ {
			if _, ok := required[list.Get(i).Enum()]; ok {
				required[list.Get(i).Enum()] = true
			}
		}
		for _, present := range required {
			if !present {
				return fmt.Errorf("protocol_incompatible: required v3 capability")
			}
		}
	case "LogicalInputCommand", "SurfaceInteractionCommand", "GestureInputCommand", "ZoneInputCommand", "RuntimeControlCommand", "RuntimeCommandHistory":
		if !ValidCommandID(get("client_event_id").String(), get("command_epoch").Uint()) {
			return invalid()
		}
		if name == "RuntimeControlCommand" {
			selected := message.Has(message.Descriptor().Fields().ByName("step_selection"))
			if (get("kind").Enum() == 4) != selected {
				return invalid()
			}
		}
		if name == "RuntimeCommandHistory" {
			outcome := get("outcome").Message()
			if outcome.Get(outcome.Descriptor().Fields().ByName("client_event_id")).String() != get("client_event_id").String() || !contentHash.MatchString(get("fingerprint").String()) {
				return invalid()
			}
		}
	case "InputSynchronizationAck":
		if !get("pending_commands_discarded").Bool() {
			return invalid()
		}
	case "PresenterInputSynchronization":
		nextField := message.Descriptor().Fields().ByName("next_command_epoch")
		if message.Has(nextField) && (get("phase").Enum() == 2 || get("command_epoch").Uint() == ^uint64(0) || get("next_command_epoch").Uint() != get("command_epoch").Uint()+1) {
			return invalid()
		}
	case "FrozenAnchorDisplayState", "ProjectedAnchorBindingSample":
		if !message.Has(message.Descriptor().Fields().ByName("position")) && !message.Has(message.Descriptor().Fields().ByName("rotation")) {
			return invalid()
		}
	case "ProjectedAnchorBindingPatch":
		field := message.Descriptor().Fields().ByName("frozen")
		if message.Has(field) {
			frozen := get("frozen").Message()
			if frozen.Get(frozen.Descriptor().Fields().ByName("node_id")).String() != get("node_id").String() {
				return invalid()
			}
		}
	case "ProjectedReliableEvent":
		field := message.Descriptor().Fields().ByName("runtime_view_replaced")
		if message.Has(field) {
			replacement := get("runtime_view_replaced").Message()
			view := replacement.Get(replacement.Descriptor().Fields().ByName("runtime_view")).Message()
			fence := get("fence").Message()
			if view.Get(view.Descriptor().Fields().ByName("base_reliable_sequence")).Uint() != get("sequence").Uint() || view.Get(view.Descriptor().Fields().ByName("assignment_epoch")).Uint() != fence.Get(fence.Descriptor().Fields().ByName("assignment_epoch")).Uint() || view.Get(view.Descriptor().Fields().ByName("projection_profile_id")).String() != fence.Get(fence.Descriptor().Fields().ByName("projection_profile_id")).String() {
				return invalid()
			}
		}
	case "RuntimeRecoveryMetadata":
		if started, err := time.Parse(time.RFC3339Nano, get("started_at").String()); err != nil || started.IsZero() {
			return invalid()
		}
		sync := get("input_synchronization").Message()
		participants := get("participants").List()
		commands := get("commands").List()
		if participants.Len() == 0 && (commands.Len() != 0 || sync.Get(sync.Descriptor().Fields().ByName("reliable_sequence")).Uint() != 0) {
			return invalid()
		}
		if sync.Get(sync.Descriptor().Fields().ByName("command_epoch")).Uint() != get("command_epoch").Uint() {
			return invalid()
		}
		if commands.Len() > MaximumCommandHistoryCount {
			return invalid()
		}
		seen := map[string]bool{}
		for i := 0; i < commands.Len(); i++ {
			c := commands.Get(i).Message()
			value := func(n string) protoreflect.Value { return c.Get(c.Descriptor().Fields().ByName(protoreflect.Name(n))) }
			key := value("participant_id").String() + "\x00" + value("client_event_id").String()
			if seen[key] || value("command_epoch").Uint() != get("command_epoch").Uint() {
				return invalid()
			}
			seen[key] = true
		}
		copy := collectionOnly(message, "commands")
		if KnownSize(copy.Interface()) > MaximumCommandHistoryBytes {
			return invalid()
		}
	case "CanonicalRuntimeSnapshot":
		copy := collectionOnly(message, "step_start_history")
		if KnownSize(copy.Interface()) > MaximumStepStartHistoryBytes {
			return invalid()
		}
	}
	return nil
}

func collectionOnly(message protoreflect.Message, name protoreflect.Name) protoreflect.Message {
	copy := message.New()
	field := message.Descriptor().Fields().ByName(name)
	source := message.Get(field).List()
	target := copy.Mutable(field).List()
	for i := 0; i < source.Len(); i++ {
		target.Append(source.Get(i))
	}
	return copy
}
