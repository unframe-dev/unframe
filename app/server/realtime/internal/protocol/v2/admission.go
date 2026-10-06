// Package protocolv2 validates portable v2 messages before runtime admission.
package protocolv2

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
var contentHash = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// ValidateMessage checks wire presence, known variants, enum values and portable
// scalar ranges. Cross-message closure and trusted fences are checked separately.
func ValidateMessage(message proto.Message) error {
	if message == nil || !message.ProtoReflect().IsValid() {
		return fmt.Errorf("message_invalid: missing message")
	}
	return validate(message.ProtoReflect(), string(message.ProtoReflect().Descriptor().Name()), false)
}

func validate(message protoreflect.Message, path string, partialTransform bool) error {
	if !message.IsValid() {
		return fmt.Errorf("message_invalid: %s is required", path)
	}
	descriptor := message.Descriptor()
	for i := 0; i < descriptor.Oneofs().Len(); i++ {
		oneof := descriptor.Oneofs().Get(i)
		if oneof.IsSynthetic() {
			continue
		}
		// Runtime control acceptance has no Cue evaluation; its caller checks the command kind.
		if descriptor.Name() == "CommandAccepted" && oneof.Name() == "cue_evaluation" {
			continue
		}
		if message.WhichOneof(oneof) == nil {
			return fmt.Errorf("message_invalid: %s.%s requires a known variant", path, oneof.Name())
		}
	}
	fields := descriptor.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		name := string(field.Name())
		fieldPath := path + "." + name
		if field.ContainingOneof() != nil && !message.Has(field) {
			continue
		}
		if field.HasOptionalKeyword() && !message.Has(field) {
			continue
		}
		value := message.Get(field)
		if field.IsList() {
			list := value.List()
			previousKey := ""
			for j := 0; j < list.Len(); j++ {
				if err := validateValue(field, list.Get(j), fmt.Sprintf("%s[%d]", fieldPath, j), false); err != nil {
					return err
				}
				if field.Kind() == protoreflect.EnumKind && j > 0 && list.Get(j-1).Enum() >= list.Get(j).Enum() {
					return fmt.Errorf("message_invalid: %s must be ordered and unique", fieldPath)
				}
				key := collectionKey(field, list.Get(j))
				if key != "" {
					if j > 0 && previousKey >= key {
						return fmt.Errorf("message_invalid: %s keys must be ordered and unique", fieldPath)
					}
					previousKey = key
				}
			}
			continue
		}
		if field.Kind() == protoreflect.MessageKind && !message.Has(field) {
			if descriptor.Name() == "Transform" && partialTransform {
				continue
			}
			return fmt.Errorf("message_invalid: %s is required", fieldPath)
		}
		childPartial := descriptor.Name() == "NodeStatePatch" && field.Name() == "transform"
		if err := validateValue(field, value, fieldPath, childPartial); err != nil {
			return err
		}
	}
	return validateKnownMessage(message, path, partialTransform)
}

func collectionKey(field protoreflect.FieldDescriptor, value protoreflect.Value) string {
	if field.Kind() == protoreflect.StringKind {
		switch field.Name() {
		case "visible_node_ids", "visible_surface_ids", "visible_variable_ids", "reachable_state_ids", "font_asset_ids", "consumed_cue_ids":
			return value.String()
		}
	}
	if field.Kind() != protoreflect.MessageKind {
		return ""
	}
	message := value.Message()
	keys := map[protoreflect.Name][]protoreflect.Name{
		"NodeRuntimeState": {"node_id"}, "SurfaceRuntimeState": {"surface_id"},
		"VariableState": {"variable_id"}, "ModelClipRuntimeState": {"model_node_id"},
		"MediaRuntimeState": {"surface_id"}, "ProjectedNodeDefinition": {"node_id"},
		"ProjectedSurfaceDefinition": {"surface_id"}, "ProjectedVariableDefinition": {"variable_id"},
		"ProjectedTimelineDefinition": {"timeline_id"}, "ProjectedModelClipDefinition": {"model_node_id", "clip_id"},
		"AssetAccessBinding": {"asset_id"}, "TextureResidencyBinding": {"asset_id"},
		"ModelResidencyBinding": {"asset_id"}, "VideoResidencyBinding": {"asset_id"},
		"RuntimeParticipantHistory": {"participant_id"}, "ProjectedParticipantPresence": {"participant_id"}, "ArmedTimer": {"cue_id"}, "CueCooldown": {"cue_id"},
	}
	var parts []string
	for _, key := range keys[message.Descriptor().Name()] {
		parts = append(parts, message.Get(message.Descriptor().Fields().ByName(key)).String())
	}
	return strings.Join(parts, "\x00")
}

func validateValue(field protoreflect.FieldDescriptor, value protoreflect.Value, path string, partialTransform bool) error {
	name := string(field.Name())
	invalid := func() error { return fmt.Errorf("message_invalid: %s", path) }
	switch field.Kind() {
	case protoreflect.MessageKind:
		return validate(value.Message(), path, partialTransform)
	case protoreflect.EnumKind:
		if value.Enum() == 0 || field.Enum().Values().ByNumber(value.Enum()) == nil {
			return invalid()
		}
	case protoreflect.DoubleKind, protoreflect.FloatKind:
		number := value.Float()
		samplePosition := name == "position_ms" || name == "position_at_reference_ms" || name == "held_position_ms"
		if math.IsNaN(number) || math.IsInf(number, 0) || number == 0 && math.Signbit(number) && !samplePosition {
			return invalid()
		}
		if samplePosition && number < 0 || name == "speed" && number <= 0 {
			return invalid()
		}
		if (name == "opacity" || name == "to_weight" || name == "red" || name == "green" || name == "blue" || name == "alpha") && (number < 0 || number > 1) {
			return invalid()
		}
	case protoreflect.Uint64Kind, protoreflect.Uint32Kind:
		if (strings.HasSuffix(name, "_epoch") || name == "run_sequence" || name == "sequence" || name == "checkpoint_sequence" || name == "frame_sequence" || name == "duration_ms" || strings.HasPrefix(name, "max_") || name == "expires_at_unix_ms") && value.Uint() == 0 {
			return invalid()
		}
	case protoreflect.StringKind:
		text := value.String()
		if (strings.HasSuffix(name, "_id") || strings.HasSuffix(name, "_ids") || name == "tier_id" || name == "logical_event_name") && !identifier.MatchString(text) {
			return invalid()
		}
		if (strings.HasSuffix(name, "_hash") || name == "checksum" || name == "font_checksum") && !contentHash.MatchString(text) {
			return invalid()
		}
		if name == "media_type" && text == "" {
			return invalid()
		}
		if name == "url" {
			parsed, err := url.Parse(text)
			if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
				return invalid()
			}
		}
	}
	return nil
}

func validateKnownMessage(message protoreflect.Message, path string, partialTransform bool) error {
	invalid := func() error { return fmt.Errorf("message_invalid: %s", path) }
	get := func(name string) protoreflect.Value {
		return message.Get(message.Descriptor().Fields().ByName(protoreflect.Name(name)))
	}
	switch message.Descriptor().Name() {
	case "Quaternion":
		x, y, z, w := get("x").Float(), get("y").Float(), get("z").Float(), get("w").Float()
		if math.Abs(math.Sqrt(x*x+y*y+z*z+w*w)-1) > 1e-9 {
			return invalid()
		}
		for _, n := range []float64{w, x, y, z} {
			if n != 0 {
				if n < 0 {
					return invalid()
				}
				break
			}
		}
	case "Transform":
		if partialTransform {
			if !message.Has(message.Descriptor().Fields().ByName("position")) && !message.Has(message.Descriptor().Fields().ByName("rotation")) && !message.Has(message.Descriptor().Fields().ByName("scale")) {
				return invalid()
			}
			if !message.Has(message.Descriptor().Fields().ByName("scale")) {
				break
			}
		}
		scale := get("scale").Message()
		for _, name := range []protoreflect.Name{"x", "y", "z"} {
			if scale.Get(scale.Descriptor().Fields().ByName(name)).Float() <= 0 {
				return invalid()
			}
		}
	case "ControlHandshake", "StateHandshake", "ControlConnected":
		if get("protocol_version").String() != "v2" || get("progression_contract_version").Uint() != 1 {
			return fmt.Errorf("protocol_incompatible: %s", path)
		}
	case "ContractVersions":
		for _, version := range []struct {
			name     string
			expected uint64
		}{{"delivery", 2}, {"runtime", 2}, {"progression", 1}, {"projection", 1}} {
			if get(version.name).Uint() != version.expected {
				return fmt.Errorf("protocol_incompatible: %s.%s", path, version.name)
			}
		}
	case "DeliveryManifest":
		if get("schema_version").Uint() != 2 || get("delivery_contract_version").Uint() != 2 {
			return invalid()
		}
	case "CanonicalRuntimeSnapshot", "ConnectionSnapshotEnvelope", "DurableCheckpointEnvelope", "CapabilityProfile":
		if get("schema_version").Uint() != 2 {
			return invalid()
		}
	case "ProjectedRuntimeCatalog":
		if get("catalog_contract_version").Uint() != 2 {
			return invalid()
		}
	case "ProjectionProfileKey":
		if get("projection_contract_version").Uint() != 1 {
			return invalid()
		}
	case "TextureCapability", "NativeUiCapability", "VideoCapability", "ModelCapability":
		if get("contract_version").Uint() != 1 {
			return invalid()
		}
		if !get("supported").Bool() && get("features").List().Len() != 0 {
			return invalid()
		}
	case "TextureLimits":
		if get("encoded_cache_reserve_bytes").Uint() >= get("max_encoded_cache_bytes").Uint() {
			return invalid()
		}
	}
	return nil
}

func rejectUnknown(message protoreflect.Message) error {
	if len(message.GetUnknown()) != 0 {
		return fmt.Errorf("message_invalid: canonical writer contains unknown fields")
	}
	var failure error
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Kind() != protoreflect.MessageKind {
			return true
		}
		if field.IsList() {
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				if failure = rejectUnknown(list.Get(index).Message()); failure != nil {
					return false
				}
			}
		} else {
			failure = rejectUnknown(value.Message())
		}
		return failure == nil
	})
	return failure
}

func canonicalizeSamplePositions(message protoreflect.Message) {
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Kind() == protoreflect.DoubleKind && (field.Name() == "position_ms" || field.Name() == "position_at_reference_ms" || field.Name() == "held_position_ms") && value.Float() == 0 && math.Signbit(value.Float()) {
			message.Set(field, protoreflect.ValueOfFloat64(0))
		}
		if field.Kind() == protoreflect.MessageKind {
			if field.IsList() {
				list := value.List()
				for index := 0; index < list.Len(); index++ {
					canonicalizeSamplePositions(list.Get(index).Message())
				}
			} else {
				canonicalizeSamplePositions(value.Message())
			}
		}
		return true
	})
}
