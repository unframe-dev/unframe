import {
  decodeWireMessage,
  encodeWireMessage,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import deliveryFixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import runtimeFixture from "../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
export function videoFixture() {
  const delivery = decodeWireMessage(
    deliveryFixture.typeName,
    encodeWireMessage(deliveryFixture.typeName, deliveryFixture.value),
  ) as DeliveryManifestWire;
  const view = structuredClone(runtimeFixture);
  const profile = delivery.projectionProfile!;
  const node = profile.runtimeCatalog!.nodes![0]!;
  const surface = profile.runtimeCatalog!.surfaces![0]!;
  const id = surface.surfaceId!;
  view.projectionProfileId = profile.projectionProfileId!;
  view.nodeStates = {
    [node.nodeId!]: structuredClone(runtimeFixture.nodeStates["node-baked"]),
  } as typeof view.nodeStates;
  view.surfaceStates = {
    [id]: { stateId: "reference-surface:default" },
  } as typeof view.surfaceStates;
  view.mediaStates = {
    [id]: { kind: "stopped", heldPositionMilliseconds: 0 },
  } as typeof view.mediaStates;
  view.activeRuns = [];
  view.enabledLogicalInputs = [];
  profile.renderSurfaces = [
    {
      renderSurfaceId: "video",
      semanticSurfaceId: id,
      rendererKind: 3,
      artifactContractVersion: 1,
      layer: 0,
      logicalBounds: { x: 0, y: 0, width: 100, height: 100 },
      stateBindings: [{ stateId: "reference-surface:default", artifact: { artifactId: "clip" } }],
      artifacts: [
        {
          video: {
            artifactId: "clip",
            contractVersion: 1,
            requiredFeatures: [1],
            videoAssetId: "video",
            checksum: `sha256:${"1".repeat(64)}`,
            pixelSize: { width: "320", height: "180" },
            durationMs: "2000",
            encodedSizeBytes: "16",
            codec: 1,
            fit: 1,
          },
        },
      ],
    },
  ];
  surface.logicalSize = { x: 100, y: 100 };
  surface.physicalSizeMeters = { x: 1, y: 1 };
  delivery.assetAccess = [
    {
      assetId: "video",
      checksum: `sha256:${"1".repeat(64)}`,
      encodedSizeBytes: "16",
      mediaType: "video/mp4",
      url: "https://assets.test/v.mp4",
      expiresAtUnixMs: "10000",
    },
  ];
  return { delivery, view, id };
}
