import type { PresentationDefinition } from "@unframe-dev/contracts/presentation/definition";
import type { DeliverySelection, SelectedRenderSurface } from "./selection.js";

export function planTextureResidencyWindows(
  definition: PresentationDefinition,
  surfaces: SelectedRenderSurface[],
  textures: DeliverySelection["residency"]["textures"],
) {
  const shared = new Set<string>();
  const owned = new Map<string, Set<string>>();
  const byChecksum = new Map(textures.map((texture) => [texture.checksum, texture]));
  for (const surface of surfaces) {
    const semantic = definition.scene.surfaces[surface.semanticSurfaceId]!;
    const owner = definition.scene.nodes[semantic.hostNodeId]!.owner;
    const assets =
      owner.kind === "presentation" ? shared : (owned.get(owner.groupId) ?? new Set<string>());
    if (owner.kind === "group") owned.set(owner.groupId, assets);
    for (const state of surface.states) {
      if (state.artifact?.kind !== "baked-web") continue;
      const texture = state.artifact.states[state.stateId]!.texture;
      const selected = byChecksum.get(texture.checksum);
      if (!selected) throw new Error("Residency window references an unselected texture.");
      assets.add(selected.assetId);
    }
  }
  const groupWindows = Object.keys(definition.flow.groups)
    .sort()
    .map((groupId) => {
      const groups = new Set([groupId]);
      for (const step of Object.values(definition.flow.groups[groupId]!.steps)) {
        for (const cue of step.cues) if (cue.next.kind === "group") groups.add(cue.next.groupId);
      }
      const assets = new Set(shared);
      for (const id of groups) for (const assetId of owned.get(id) ?? []) assets.add(assetId);
      return { groupId, assetIds: [...assets].sort() };
    });
  const gpuByAsset = new Map(textures.map((texture) => [texture.assetId, texture.gpuBytes]));
  const bytes = groupWindows.map((window) =>
    window.assetIds.reduce((total, id) => {
      const next = total + gpuByAsset.get(id)!;
      if (!Number.isSafeInteger(next)) throw new RangeError("Texture residency window overflows.");
      return next;
    }, 0),
  );
  return {
    initialGroupId: definition.flow.initialGroupId,
    groupWindows,
    maximumResidentGpuBytes: Math.max(0, ...bytes),
    maximumResidentTextureBindings: Math.max(
      0,
      ...groupWindows.map((window) => window.assetIds.length),
    ),
  };
}
