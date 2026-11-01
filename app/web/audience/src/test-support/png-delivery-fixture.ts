import {
  decodeWireMessage,
  encodeWireMessage,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import fixture from "../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";

export const PNG_DEFAULT_STATE = "png:default";
export const PNG_INACTIVE_STATE = "png:inactive";

function createPngDelivery(): DeliveryManifestWire {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const profile = delivery.projectionProfile!;
  const catalog = profile.runtimeCatalog!;
  const surface = catalog.surfaces![0]!;
  surface.reachableStateIds = [PNG_DEFAULT_STATE, PNG_INACTIVE_STATE];
  surface.logicalSize = { x: 1920, y: 1080 };
  surface.physicalSizeMeters = { x: 1, y: 0.5625 };
  catalog.timelines = [
    {
      timelineId: "png:fade",
      owner: { presentation: {} },
      durationMs: "1000",
      tracks: [
        {
          target: { nodeId: surface.hostNodeId!, property: 1 },
          keyframes: [
            { number: { value: 1 }, easingToNext: 4 },
            { timeMs: "1000", number: { value: 0.5 } },
          ],
        },
      ],
    },
  ];
  const textures = [
    { width: 2048, height: 1152, alphaMode: 1, encodedBytes: 9439137 },
    { width: 2048, height: 448, alphaMode: 2, encodedBytes: 3670825 },
    { width: 2048, height: 394, alphaMode: 2, encodedBytes: 3228368 },
    { width: 2048, height: 394, alphaMode: 2, encodedBytes: 3228368 },
  ].map((input, index) => ({
    assetId: `png:texture-${index}`,
    checksum: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    encodedSizeBytes: String(input.encodedBytes),
    pixelSize: { width: String(input.width), height: String(input.height) },
    alphaMode: input.alphaMode,
    mipCount: 1,
    decodedGpuBytes: String(input.width * input.height * 4),
  }));
  const bounds = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 64, y: 184, width: 1792, height: 392 },
    { x: 128, y: 640, width: 416, height: 80 },
  ];
  profile.renderSurfaces = bounds.map((logicalBounds, layer) => {
    const artifactId = `png:artifact-${layer}`;
    return {
      renderSurfaceId: `png:render-${layer}`,
      semanticSurfaceId: surface.surfaceId!,
      logicalBounds,
      layer,
      rendererKind: 1,
      artifactContractVersion: 1,
      stateBindings: [PNG_DEFAULT_STATE, PNG_INACTIVE_STATE].map((stateId) => ({
        stateId,
        artifact: { artifactId },
      })),
      artifacts: [
        {
          bakedWeb: {
            artifactId,
            contractVersion: 1,
            requiredFeatures: layer === 0 ? [1, 2, 3] : [1, 2, 4],
            states: [PNG_DEFAULT_STATE, PNG_INACTIVE_STATE].map((stateId, index) => ({
              stateId,
              texture: textures[layer === 2 && index === 1 ? 3 : layer]!,
            })),
          },
        },
      ],
    };
  });
  const semantic = profile.semanticSurfaces![0]!;
  semantic.renderSurfaceIds = profile.renderSurfaces.map((render) => render.renderSurfaceId!);
  semantic.states = [PNG_DEFAULT_STATE, PNG_INACTIVE_STATE].map((stateId, index) => {
    const state = structuredClone(semantic.states![0]!);
    state.stateId = stateId;
    if (index === 1) {
      state.interactiveRegions = [];
      for (const node of state.semanticTree!.nodes!) node.interactionEnabled = false;
    }
    return state;
  });
  delivery.assetAccess = textures.map((texture) => ({
    assetId: texture.assetId,
    checksum: texture.checksum,
    encodedSizeBytes: texture.encodedSizeBytes,
    mediaType: "image/png",
    url: `https://assets.example.invalid/${encodeURIComponent(texture.assetId)}`,
    expiresAtUnixMs: "2000",
  }));
  delivery.residency!.textures = {
    budgetTierId: "synthetic-test-only",
    textures: textures.map((texture) => ({
      assetId: texture.assetId,
      checksum: texture.checksum,
      pixelSize: texture.pixelSize,
      decodedGpuBytes: texture.decodedGpuBytes,
      peakLoadCpuBytes: String(
        Number(texture.encodedSizeBytes) + 2 * Number(texture.decodedGpuBytes),
      ),
    })),
    totalDecodedGpuBytes: String(
      textures.reduce((total, texture) => total + Number(texture.decodedGpuBytes), 0),
    ),
    maximumPeakLoadCpuBytes: String(
      Math.max(
        ...textures.map(
          (texture) => Number(texture.encodedSizeBytes) + 2 * Number(texture.decodedGpuBytes),
        ),
      ),
    ),
  };
  delivery.residency!.totalSelectedEncodedBytes = String(
    textures.reduce((total, texture) => total + Number(texture.encodedSizeBytes), 0),
  );
  return decodeWireMessage(
    fixture.typeName,
    encodeWireMessage(fixture.typeName, delivery),
  ) as DeliveryManifestWire;
}

export const pngDeliveryFixture = {
  typeName: fixture.typeName,
  value: createPngDelivery(),
};
