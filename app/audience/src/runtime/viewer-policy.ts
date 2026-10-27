import type { DeliveryManifestWire } from "@unframe/contracts/presentation";

const viewerRole = 2;

// Viewer uses replacement views for Step restore and rejects unsupported Anchor display state.
export const viewerRuntimeCapabilities: readonly number[] = Object.freeze([
  1, 2, 3, 4, 5, 8, 9, 10,
]);

export function assertViewerRuntimeCapabilities(required: readonly number[] | undefined): void {
  if (required?.some((capability) => !viewerRuntimeCapabilities.includes(capability)))
    throw new Error("Audience requires an unsupported runtime capability");
}

export function assertViewerDelivery(delivery: DeliveryManifestWire): void {
  if (delivery.projectionProfile?.key?.role !== viewerRole)
    throw new Error("Audience requires a Viewer projection");
}

export function assertViewerInputs(inputs: readonly string[] | undefined): void {
  if (inputs?.length) throw new Error("Viewer logical inputs must be disabled");
}
