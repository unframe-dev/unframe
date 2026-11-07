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
type PngTextureDescriptor = Omit<PngTextureAsset, "url" | "expiresAtUnixMs">;

function withCurrentAccess(
  delivery: DeliveryManifestWire,
  asset: PngTextureDescriptor,
): PngTextureAsset {
  const access = delivery.assetAccess?.filter((entry) => entry.assetId === asset.assetId);
  if (
    access?.length !== 1 ||
    access[0]!.checksum !== asset.checksum ||
    access[0]!.encodedSizeBytes !== String(asset.encodedSizeBytes) ||
    access[0]!.mediaType !== "image/png"
  )
    fail("selected texture descriptor mismatch");
  return {
    ...asset,
    url: access[0]!.url ?? fail("missing asset URL"),
    expiresAtUnixMs: uint(access[0]!.expiresAtUnixMs),
  };
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
      if (texture.alphaMode !== 1 && texture.alphaMode !== 2) fail("invalid alpha mode");
      const asset = withCurrentAccess(delivery, {
        assetId: texture.assetId,
        checksum: texture.checksum,
        encodedSizeBytes: uint(texture.encodedSizeBytes),
        pixelSize: [uint(texture.pixelSize?.width), uint(texture.pixelSize?.height)],
        alphaMode: texture.alphaMode === 1 ? "opaque" : "straight",
      });
      if (uint(texture.decodedGpuBytes) !== asset.pixelSize[0] * asset.pixelSize[1] * 4)
        fail("selected texture residency mismatch");
      const previous = assets.get(asset.assetId);
      if (previous && identity(previous) !== identity(asset))
        fail("conflicting texture descriptor");
      assets.set(asset.assetId, asset);
    }
  }
  const unique = new Map<string, PngTextureAsset>();
  for (const asset of assets.values()) {
    const previous = unique.get(asset.checksum);
    if (previous && identity(previous) !== identity(asset)) fail("conflicting texture descriptor");
    unique.set(asset.checksum, asset);
  }
  const residency = delivery.residency?.textures;
  if ((residency?.textures?.length ?? 0) !== unique.size) fail("texture residency mismatch");
  const matched = new Set<string>();
  let maximumPeak = 0;
  for (const binding of residency?.textures ?? []) {
    const asset = assets.get(binding.assetId ?? "");
    if (
      !asset ||
      matched.has(asset.checksum) ||
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
    matched.add(asset.checksum);
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

export interface PngTextureLease {
  assets: readonly PngTextureAsset[];
  release(): void;
}

interface TextureRequest {
  signal?: AbortSignal;
  residentCpuBytes?: number;
  residentResources?: { gpuBytes: number; bindings: number };
}

export async function createPngTexturePool(options: {
  delivery: DeliveryManifestWire;
  fetcher?: typeof fetch;
  residentCpuBytes?: number;
  loadTexture?: typeof loadPngTexture;
  uploadTexture(texture: Texture): void;
}) {
  const assets = selectedTextures(options.delivery);
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
  const limits = options.delivery.capabilityProfile?.limits?.texture;
  const residency = options.delivery.residency?.textures;
  const windows = new Map<string, PngTextureAsset[]>();
  let maximumGpu = 0;
  let maximumBindings = 0;
  for (const window of residency?.groupWindows ?? []) {
    if (!window.groupId || windows.has(window.groupId)) fail("invalid group window");
    const selected = (window.assetIds ?? []).map((assetId) => {
      return byId.get(assetId) ?? fail("unknown window texture");
    });
    const unique = [...new Map(selected.map((asset) => [asset.checksum, asset])).values()];
    if (unique.length !== selected.length) fail("duplicate window texture");
    maximumGpu = Math.max(
      maximumGpu,
      unique.reduce((sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4, 0),
    );
    maximumBindings = Math.max(maximumBindings, unique.length);
    windows.set(window.groupId, unique);
  }
  if (!residency?.initialGroupId || !windows.has(residency.initialGroupId))
    fail("missing group residency windows");
  if (
    uint(residency.maximumResidentGpuBytes, true) !== maximumGpu ||
    uint(residency.maximumResidentTextureBindings, true) !== maximumBindings
  )
    fail("window residency aggregate mismatch");
  if (maximumGpu > uint(limits?.maxGpuBytes) || maximumBindings > uint(limits?.maxTextureBindings))
    fail("texture budget exceeded");
  for (const asset of assets) {
    if (
      asset.pixelSize[0] > uint(limits?.maxTextureWidth) ||
      asset.pixelSize[1] > uint(limits?.maxTextureHeight) ||
      asset.pixelSize[0] * asset.pixelSize[1] > uint(limits?.maxTexturePixels)
    )
      fail("texture budget exceeded");
    admitPngMemory([asset], options.residentCpuBytes ?? 0, uint(limits?.maxSerialLoadCpuBytes));
  }
  const loaded = new Map<
    string,
    {
      asset: PngTextureAsset;
      item: Awaited<ReturnType<typeof loadPngTexture>>;
      pins: number;
      warm: boolean;
    }
  >();
  const encoded = new Map<string, Uint8Array<ArrayBuffer>>();
  const encodedLimit =
    uint(limits?.maxEncodedCacheBytes) - uint(limits?.encodedCacheReserveBytes, true);
  if (encodedLimit < 0) fail("invalid encoded cache budget");
  let encodedBytes = 0;
  let disposed = false;
  let work: Promise<unknown> = Promise.resolve();
  let warming: { controller: AbortController; done: Promise<void> } | null = null;
  let currentGroup: string | null = null;
  const completedGroups = new Set<string>();
  function futureAssets() {
    const candidates = new Map<string, PngTextureAsset>();
    for (const [groupId, assets] of windows) {
      if (groupId === currentGroup || completedGroups.has(groupId)) continue;
      for (const asset of assets) candidates.set(asset.checksum, asset);
    }
    return candidates;
  }
  function activateGroup(groupId: string) {
    if (disposed) fail("pool disposed");
    if (!windows.has(groupId)) fail("unknown group window");
    warming?.controller.abort();
    if (currentGroup && currentGroup !== groupId) completedGroups.add(currentGroup);
    currentGroup = groupId;
    const future = futureAssets();
    for (const [checksum, entry] of loaded) {
      entry.warm = future.has(checksum);
      if (entry.pins > 0 || entry.warm) continue;
      entry.item.dispose();
      loaded.delete(checksum);
    }
    for (const [checksum, bytes] of encoded) {
      if (future.has(checksum)) continue;
      encodedBytes -= bytes.byteLength;
      encoded.delete(checksum);
    }
  }
  function cache(checksum: string, bytes: Uint8Array<ArrayBuffer>) {
    const previous = encoded.get(checksum);
    if (previous) encodedBytes -= previous.byteLength;
    encoded.delete(checksum);
    if (bytes.byteLength > encodedLimit) return;
    while (encodedBytes + bytes.byteLength > encodedLimit) {
      const oldest = encoded.keys().next().value!;
      encodedBytes -= encoded.get(oldest)!.byteLength;
      encoded.delete(oldest);
    }
    encoded.set(checksum, bytes);
    encodedBytes += bytes.byteLength;
  }
  function release(checksums: readonly string[]) {
    for (const checksum of checksums) {
      const entry = loaded.get(checksum);
      if (!entry || --entry.pins > 0 || entry.warm) continue;
      entry.item.dispose();
      loaded.delete(checksum);
    }
  }
  function getTexture(asset: PngTextureAsset) {
    if (disposed) return fail("pool disposed");
    const selected = byId.get(asset.assetId);
    const entry = loaded.get(asset.checksum);
    if (!selected || identity(selected) !== identity(asset) || !entry)
      return fail("texture descriptor not resident");
    return { texture: entry.item.texture, dispose() {} };
  }
  function fits(
    required: readonly PngTextureAsset[],
    resident: { gpuBytes: number; bindings: number },
    includeWarm = true,
  ) {
    const union = new Map(
      [...loaded]
        .filter(([, value]) => includeWarm || value.pins > 0)
        .map(([key, value]) => [key, value.asset]),
    );
    for (const asset of required) union.set(asset.checksum, asset);
    const gpu = [...union.values()].reduce(
      (sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4,
      0,
    );
    return (
      gpu + resident.gpuBytes <= uint(limits?.maxGpuBytes) &&
      union.size + resident.bindings <= uint(limits?.maxTextureBindings)
    );
  }
  function canAcquire(groupId: string, resident = { gpuBytes: 0, bindings: 0 }) {
    if (disposed) fail("pool disposed");
    return fits(windows.get(groupId) ?? fail("unknown group window"), resident, false);
  }
  function discardWarm(keep: readonly PngTextureAsset[] = []) {
    if (!keep.length) {
      encoded.clear();
      encodedBytes = 0;
    }
    const retained = new Set(keep.map((asset) => asset.checksum));
    for (const [checksum, entry] of loaded) {
      if (retained.has(checksum)) continue;
      entry.warm = false;
      if (entry.pins > 0) continue;
      entry.item.dispose();
      loaded.delete(checksum);
    }
  }
  async function stopWarming() {
    const previous = warming;
    previous?.controller.abort();
    await previous?.done;
  }
  async function acquireAssets(
    required: PngTextureAsset[],
    request: TextureRequest,
    background = false,
  ): Promise<PngTextureLease> {
    const previous = work;
    const pending = (async () => {
      await previous.catch(() => undefined);
      const check = () => {
        if (disposed) fail("pool disposed");
        if (request.signal?.aborted) fail("load cancelled");
      };
      check();
      const resident = request.residentResources ?? { gpuBytes: 0, bindings: 0 };
      if (!background && !fits(required, resident)) discardWarm(required);
      const union = new Map([...loaded].map(([key, value]) => [key, value.asset]));
      for (const asset of required) union.set(asset.checksum, asset);
      const gpu = [...union.values()].reduce(
        (sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4,
        0,
      );
      if (
        !Number.isSafeInteger(resident.gpuBytes) ||
        resident.gpuBytes < 0 ||
        !Number.isSafeInteger(resident.bindings) ||
        resident.bindings < 0 ||
        gpu + resident.gpuBytes > uint(limits?.maxGpuBytes) ||
        union.size + resident.bindings > uint(limits?.maxTextureBindings)
      )
        fail("texture replacement budget exceeded");
      const acquired: string[] = [];
      try {
        for (const asset of required) {
          check();
          const existing = loaded.get(asset.checksum);
          if (existing) {
            existing.pins++;
            acquired.push(asset.checksum);
            continue;
          }
          const residentCpu = request.residentCpuBytes ?? options.residentCpuBytes ?? 0;
          const peakCpu = asset.pixelSize[0] * asset.pixelSize[1] * 8 + asset.encodedSizeBytes;
          while (
            encoded.size &&
            residentCpu + encodedBytes + peakCpu > uint(limits?.maxSerialLoadCpuBytes)
          ) {
            const oldest = encoded.keys().next().value!;
            encodedBytes -= encoded.get(oldest)!.byteLength;
            encoded.delete(oldest);
          }
          admitPngMemory([asset], residentCpu + encodedBytes, uint(limits?.maxSerialLoadCpuBytes));
          let bytes = encoded.get(asset.checksum);
          if (bytes) cache(asset.checksum, bytes);
          const currentAsset = withCurrentAccess(options.delivery, asset);
          const item = await (options.loadTexture ?? loadPngTexture)(currentAsset, {
            ...(request.signal ? { signal: request.signal } : {}),
            ...(options.fetcher ? { fetcher: options.fetcher } : {}),
            ...(bytes ? { encodedBytes: bytes } : {}),
            onEncodedBytes(value) {
              bytes = value;
            },
          });
          loaded.set(asset.checksum, { asset, item, pins: 1, warm: false });
          acquired.push(asset.checksum);
          check();
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
          check();
          if (bytes) cache(asset.checksum, bytes);
        }
        let released = false;
        return {
          assets: required,
          release() {
            if (!released) {
              released = true;
              release(acquired);
            }
          },
        };
      } catch (error) {
        release(acquired);
        throw error;
      }
    })();
    work = pending;
    return pending;
  }
  async function acquire(groupId: string, request: TextureRequest = {}) {
    await stopWarming();
    return acquireAssets(windows.get(groupId) ?? fail("unknown group window"), request);
  }
  function warm(request: TextureRequest = {}) {
    const previous = warming;
    previous?.controller.abort();
    if (disposed || request.signal?.aborted) return Promise.resolve();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal?.addEventListener("abort", cancel, { once: true });
    const task = { controller, done: Promise.resolve() };
    warming = task;
    task.done = (async () => {
      await previous?.done;
      // Only observed departures prove a group is complete; window ID order is not progression.
      for (const asset of futureAssets().values()) {
        if (disposed || controller.signal.aborted) break;
        const existing = loaded.get(asset.checksum);
        if (existing) {
          existing.warm = true;
          continue;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (disposed || controller.signal.aborted) break;
        if (!fits([asset], request.residentResources ?? { gpuBytes: 0, bindings: 0 })) continue;
        try {
          const lease = await acquireAssets(
            [asset],
            { ...request, signal: controller.signal },
            true,
          );
          const entry = loaded.get(asset.checksum);
          if (entry && !disposed && !controller.signal.aborted) entry.warm = true;
          lease.release();
        } catch {
          // Speculative loading must never reject foreground playback.
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        request.signal?.removeEventListener("abort", cancel);
        if (warming === task) warming = null;
      });
    return task.done;
  }
  return {
    assets,
    warm,
    activateGroup,
    stopWarming,
    discardWarm,
    get residentAssets() {
      return [...loaded.values()].map((entry) => entry.asset);
    },
    get retainedCpuBytes() {
      return encodedBytes;
    },
    get gpuBytes() {
      return [...loaded.values()].reduce(
        (sum, entry) => sum + entry.asset.pixelSize[0] * entry.asset.pixelSize[1] * 4,
        0,
      );
    },
    getTexture,
    async loadTexture(asset: PngTextureAsset) {
      return getTexture(asset);
    },
    acquire,
    canAcquire,
    dispose() {
      if (disposed) return;
      disposed = true;
      warming?.controller.abort();
      for (const entry of loaded.values()) entry.item.dispose();
      loaded.clear();
      encoded.clear();
      encodedBytes = 0;
    },
  };
}
