import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";

export function validateFrozenAnchors(
  delivery: DeliveryManifestWire,
  view: ParticipantRuntimeView,
): void {
  const seen = new Set<string>();
  for (const frozen of view.frozenAnchors) {
    const anchor = delivery.projectionProfile?.runtimeCatalog?.nodes?.find(
      (node) => node.nodeId === frozen.nodeId,
    )?.parent?.presenterAnchor;
    if (
      !anchor ||
      seen.has(frozen.nodeId) ||
      (anchor.followPosition && !frozen.position) ||
      (anchor.followRotation && !frozen.rotation)
    )
      throw new Error("Invalid frozen Anchor display state");
    seen.add(frozen.nodeId);
  }
}
