package protocolv2

import (
	"fmt"
	"math"

	"google.golang.org/protobuf/reflect/protoreflect"
)

func validateTextureResidency(plan protoreflect.Message, path string) error {
	get := func(message protoreflect.Message, name protoreflect.Name) protoreflect.Value {
		return message.Get(message.Descriptor().Fields().ByName(name))
	}
	catalog := get(plan, "textures").List()
	windows := get(plan, "group_windows").List()
	invalid := func() error {
		return fmt.Errorf("message_invalid: %s texture windows disagree with catalog or budgets", path)
	}
	textures := make(map[string]uint64, catalog.Len())
	checksums := make(map[string]bool, catalog.Len())
	var total, peak uint64
	for i := 0; i < catalog.Len(); i++ {
		texture := catalog.Get(i).Message()
		id, checksum := get(texture, "asset_id").String(), get(texture, "checksum").String()
		bytes := get(texture, "decoded_gpu_bytes").Uint()
		if _, exists := textures[id]; exists {
			return invalid()
		}
		if checksums[checksum] || math.MaxUint64-total < bytes {
			return invalid()
		}
		textures[id] = bytes
		checksums[checksum] = true
		total += bytes
		peak = max(peak, get(texture, "peak_load_cpu_bytes").Uint())
	}
	initialFound := false
	var maximumBytes uint64
	var maximumBindings uint64
	for i := 0; i < windows.Len(); i++ {
		window := windows.Get(i).Message()
		initialFound = initialFound || get(window, "group_id").String() == get(plan, "initial_group_id").String()
		var resident uint64
		ids := get(window, "asset_ids").List()
		for j := 0; j < ids.Len(); j++ {
			bytes, exists := textures[ids.Get(j).String()]
			if !exists || math.MaxUint64-resident < bytes {
				return invalid()
			}
			resident += bytes
		}
		maximumBytes = max(maximumBytes, resident)
		maximumBindings = max(maximumBindings, uint64(ids.Len()))
	}
	if !initialFound || total != get(plan, "total_decoded_gpu_bytes").Uint() || peak != get(plan, "maximum_peak_load_cpu_bytes").Uint() || maximumBytes != get(plan, "maximum_resident_gpu_bytes").Uint() || maximumBindings != get(plan, "maximum_resident_texture_bindings").Uint() {
		return invalid()
	}
	return nil
}
