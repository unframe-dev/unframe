import type { Texture } from "three";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import { admitPngMemory } from "../rendering/png-memory";
import { loadPngTexture, type PngTextureAsset } from "./png-texture";

function fail(reason: string): never {
  throw new Error(`PNG texture pool: ${reason}`);
}
function uint(value: string | undefined, zero = false): number {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return fail("invalid residency integer");
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= (zero ? 0 : 1)
    ? parsed
    : fail("invalid residency integer");
}
function identity(asset: PngTextureAsset) {
  return JSON.stringify([asset.checksum, asset.encodedSizeBytes, asset.pixelSize, asset.alphaMode]);
}
function selectedTextures(delivery: DeliveryManifestWire): PngTextureAsset[] {
  const assets = new Map<string, PngTextureAsset>();
  for (const render of delivery.projectionProfile?.renderSurfaces ?? []) {
    if (render.rendererKind !== 1) continue;
    if (render.artifactContractVersion !== 1) fail("unsupported surface renderer");
    for (const binding of render.stateBindings ?? []) {
      if (binding.empty) continue;
      const artifact = render.artifacts?.find(
        (candidate) => candidate.bakedWeb?.artifactId === binding.artifact?.artifactId,
      )?.bakedWeb;
      if (!artifact) fail("missing selected baked artifact");
      if (
        artifact.contractVersion !== 1 ||
        artifact.requiredFeatures?.some((feature) => ![1, 2, 3, 4].includes(feature))
      )
        fail("unsupported baked artifact");
      const texture = artifact.states?.find((state) => state.stateId === binding.stateId)?.texture;
      if (!texture?.assetId || !texture.checksum || texture.mipCount !== 1)
        fail("invalid selected texture descriptor");
      const access = delivery.assetAccess?.filter((entry) => entry.assetId === texture.assetId);
      if (
        access?.length !== 1 ||
        access[0]!.checksum !== texture.checksum ||
        access[0]!.encodedSizeBytes !== texture.encodedSizeBytes ||
        access[0]!.mediaType !== "image/png"
      )
        fail("selected texture descriptor mismatch");
      if (texture.alphaMode !== 1 && texture.alphaMode !== 2) fail("invalid alpha mode");
      const asset: PngTextureAsset = {
        assetId: texture.assetId,
        checksum: texture.checksum,
        encodedSizeBytes: uint(texture.encodedSizeBytes),
        pixelSize: [uint(texture.pixelSize?.width), uint(texture.pixelSize?.height)],
        alphaMode: texture.alphaMode === 1 ? "opaque" : "straight",
        url: access[0]!.url ?? fail("missing asset URL"),
        expiresAtUnixMs: uint(access[0]!.expiresAtUnixMs),
      };
      if (uint(texture.decodedGpuBytes) !== asset.pixelSize[0] * asset.pixelSize[1] * 4)
        fail("selected texture residency mismatch");
      const previous = assets.get(asset.assetId);
      if (previous && identity(previous) !== identity(asset))
        fail("conflicting texture descriptor");
      assets.set(asset.assetId, asset);
    }
  }
  const residency = delivery.residency?.textures;
  if ((residency?.textures?.length ?? 0) !== assets.size) fail("texture residency mismatch");
  const matched = new Set<string>();
  let maximumPeak = 0;
  for (const binding of residency?.textures ?? []) {
    const asset = assets.get(binding.assetId ?? "");
    if (
      !asset ||
      matched.has(asset.assetId) ||
      binding.checksum !== asset.checksum ||
      uint(binding.pixelSize?.width) !== asset.pixelSize[0] ||
      uint(binding.pixelSize?.height) !== asset.pixelSize[1] ||
      uint(binding.decodedGpuBytes) !== asset.pixelSize[0] * asset.pixelSize[1] * 4
    )
      fail("texture residency descriptor mismatch");
    const peak = uint(binding.peakLoadCpuBytes);
    if (peak !== asset.pixelSize[0] * asset.pixelSize[1] * 8 + asset.encodedSizeBytes)
      fail("texture residency peak mismatch");
    maximumPeak = Math.max(maximumPeak, peak);
    matched.add(asset.assetId);
  }
  const unique = new Map<string, PngTextureAsset>();
  for (const asset of assets.values()) {
    const previous = unique.get(asset.checksum);
    if (previous && identity(previous) !== identity(asset)) fail("conflicting texture descriptor");
    unique.set(asset.checksum, asset);
  }
  const decoded = [...unique.values()].reduce(
    (sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4,
    0,
  );
  if (
    assets.size &&
    (uint(residency?.totalDecodedGpuBytes) !== decoded ||
      uint(residency?.maximumPeakLoadCpuBytes) !== maximumPeak)
  )
    fail("texture residency aggregate mismatch");
  return [...assets.values()];
}

export async function createPngTexturePool(options: {
  delivery: DeliveryManifestWire;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  residentCpuBytes?: number;
  loadTexture?: typeof loadPngTexture;
  uploadTexture(texture: Texture): void;
}) {
  const assets = selectedTextures(options.delivery);
  const unique = [...new Map(assets.map((asset) => [asset.checksum, asset])).values()];
  const limits = options.delivery.capabilityProfile?.limits?.texture;
  let gpuBytes = 0;
  if (unique.length) {
    const decoded = unique.reduce(
      (sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4,
      0,
    );
    const encoded = unique.reduce((sum, asset) => sum + asset.encodedSizeBytes, 0);
    if (
      !Number.isSafeInteger(decoded) ||
      !Number.isSafeInteger(encoded) ||
      unique.length > uint(limits?.maxTextureBindings) ||
      decoded > uint(limits?.maxGpuBytes) ||
      encoded > uint(limits?.maxEncodedCacheBytes) - uint(limits?.encodedCacheReserveBytes, true) ||
      unique.some(
        (asset) =>
          asset.pixelSize[0] > uint(limits?.maxTextureWidth) ||
          asset.pixelSize[1] > uint(limits?.maxTextureHeight) ||
          asset.pixelSize[0] * asset.pixelSize[1] > uint(limits?.maxTexturePixels),
      )
    )
      fail("texture budget exceeded");
    for (const asset of unique) {
      admitPngMemory([asset], options.residentCpuBytes ?? 0, uint(limits?.maxSerialLoadCpuBytes));
    }
    gpuBytes = decoded;
  }
  const loaded = new Map<string, Awaited<ReturnType<typeof loadPngTexture>>>();
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const texture of loaded.values()) texture.dispose();
    loaded.clear();
  }
  function getTexture(asset: PngTextureAsset) {
    if (disposed) return fail("pool disposed");
    const selected = assets.find((candidate) => candidate.assetId === asset.assetId);
    const item = loaded.get(asset.checksum);
    if (!selected || identity(selected) !== identity(asset) || !item)
      return fail("texture descriptor not preloaded");
    return { texture: item.texture, dispose() {} };
  }
  try {
    for (const asset of unique) {
      if (options.signal?.aborted) fail("preload cancelled");
      const item = await (options.loadTexture ?? loadPngTexture)(asset, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.fetcher ? { fetcher: options.fetcher } : {}),
      });
      loaded.set(asset.checksum, item);
      if (options.signal?.aborted) fail("preload cancelled");
      const previousUpdate = item.texture.onUpdate;
      let uploaded = false;
      item.texture.onUpdate = (texture) => {
        previousUpdate?.(texture);
        uploaded = true;
      };
      try {
        options.uploadTexture(item.texture);
        if (!uploaded) fail("texture upload did not complete");
        item.releaseCpuCopy();
      } finally {
        item.texture.onUpdate = previousUpdate;
      }
      if (options.signal?.aborted) fail("preload cancelled");
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    assets,
    get retainedCpuBytes() {
      return 0;
    },
    get gpuBytes() {
      return disposed ? 0 : gpuBytes;
    },
    getTexture,
    async loadTexture(asset: PngTextureAsset) {
      return getTexture(asset);
    },
    dispose,
  };
}
