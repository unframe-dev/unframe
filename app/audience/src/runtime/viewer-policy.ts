import type { DeliveryManifestWire } from "@unframe/contracts/presentation";

const viewerRole = 2;

export function assertViewerDelivery(delivery: DeliveryManifestWire): void {
  if (delivery.projectionProfile?.key?.role !== viewerRole)
    throw new Error("Audience requires a Viewer projection");
}

export function assertViewerInputs(inputs: readonly string[] | undefined): void {
  if (inputs?.length) throw new Error("Viewer logical inputs must be disabled");
}
