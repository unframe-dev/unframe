import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import runtime from "../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
export function modelFixture() {
  const view = participantRuntimeViewSchema.parse(runtime);
  view.projectionProfileId = "p";
  view.activeRuns = [];
  view.modelClipStates = { model: { kind: "defaultPose" } };
  view.nodeStates = {
    model: structuredClone(view.nodeStates["node-baked"]!),
  } as typeof view.nodeStates;
  const delivery = {
    schemaVersion: 3,
    deliveryContractVersion: 3,
    projectionInstance: { projectionProfileId: "p", assignmentEpoch: String(view.assignmentEpoch) },
    projectionProfile: {
      projectionProfileId: "p",
      runtimeCatalog: {
        catalogContractVersion: 3,
        nodes: [
          {
            nodeId: "model",
            parent: { stage: {} },
            owner: { presentation: {} },
            model: { modelAssetId: "a" },
          },
        ],
        modelClips: [],
      },
    },
    capabilityProfile: {
      model: { supported: true, contractVersion: 1, formats: [1], features: [7] },
      limits: {
        model: {
          maxAssets: "2",
          maxInstances: "2",
          maxEncodedBytes: "10000",
          maxNodes: "100",
          maxPrimitives: "100",
          maxVertices: "100",
          maxTriangles: "100",
          maxBonesPerSkin: "100",
          maxMorphTargetsPerPrimitive: "100",
          maxAnimationClipsPerAsset: "100",
        },
      },
    },
    residency: {
      models: {
        models: [
          {
            assetId: "a",
            checksum: "sha256:" + "a".repeat(64),
            encodedSizeBytes: "100",
            format: 1,
            requiredFeatures: [7],
            nodeCount: "1",
            primitiveCount: "1",
            vertexCount: "3",
            triangleCount: "1",
            maximumBonesPerSkin: "0",
            maximumMorphTargetsPerPrimitive: "0",
            animationClipCount: "0",
          },
        ],
      },
    },
    assetAccess: [
      {
        assetId: "a",
        checksum: "sha256:" + "a".repeat(64),
        encodedSizeBytes: "100",
        mediaType: "model/gltf-binary",
        url: "https://assets.example/a.glb",
        expiresAtUnixMs: "9999999999999",
      },
    ],
  } as DeliveryManifestWire;
  return { delivery, view };
}
