import { assert, expect, it, vi } from "vite-plus/test";
import { Texture } from "three";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import { pngDeliveryFixture as fixture } from "../../test-support/png-delivery-fixture";
import { loadPngTexture, type PngTextureAsset } from "../png-texture";
import { createPngTexturePool as createPool } from "../png-texture-pool";

async function createPngTexturePool(
  options: Parameters<typeof createPool>[0] & { signal?: AbortSignal },
) {
  const pool = await createPool(options);
  try {
    await pool.acquire(
      options.delivery.residency!.textures!.initialGroupId!,
      options.signal ? { signal: options.signal } : {},
    );
    return pool;
  } catch (error) {
    pool.dispose();
    throw error;
  }
}

function setup() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const assets: {
    texture: Texture;
    releaseCpuCopy: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const loadTexture = vi.fn<typeof loadPngTexture>(async (_asset: PngTextureAsset) => {
    const asset = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
    assets.push(asset);
    return asset;
  });
  const uploadTexture = vi.fn((texture: Texture) => texture.onUpdate?.(texture));
  return { delivery, assets, loadTexture, uploadTexture };
}
it("loads every selected state before returning and keeps shared textures until pool disposal", async () => {
  const { delivery, assets, loadTexture, uploadTexture } = setup();
  const pool = await createPngTexturePool({ delivery, loadTexture, uploadTexture });
  expect(loadTexture).toHaveBeenCalledTimes(4);
  const descriptor = loadTexture.mock.calls[0]![0];
  const first = await pool.loadTexture(descriptor);
  const second = await pool.loadTexture(descriptor);
  expect(first.texture).toBe(second.texture);
  first.dispose();
  second.dispose();
  expect(assets.every((asset) => asset.dispose.mock.calls.length === 0)).toBe(true);
  expect(pool.retainedCpuBytes).toBe(0);
  expect(pool.gpuBytes).toBe(19562496);
  expect(assets.every((asset) => asset.releaseCpuCopy.mock.calls.length === 1)).toBe(true);
  pool.dispose();
  pool.dispose();
  expect(assets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true);
  await expect(pool.loadTexture(descriptor)).rejects.toThrow("disposed");
});
it("rejects residency or aggregate budget mismatches before loading", async () => {
  const { delivery, loadTexture, uploadTexture } = setup();
  delivery.residency!.textures!.textures!.pop();
  await expect(createPngTexturePool({ delivery, loadTexture, uploadTexture })).rejects.toThrow(
    "residency",
  );
  expect(loadTexture).not.toHaveBeenCalled();
  const next = setup();
  next.delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes = "20000000";
  await expect(createPngTexturePool(next)).rejects.toThrow("budget");
  expect(next.loadTexture).not.toHaveBeenCalled();
});
it("releases textures already loaded when a later preload fails", async () => {
  const { delivery, assets, loadTexture, uploadTexture } = setup();
  loadTexture
    .mockImplementationOnce(async () => {
      const asset = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
      assets.push(asset);
      return asset;
    })
    .mockRejectedValueOnce(new Error("decode failed"));
  await expect(createPngTexturePool({ delivery, loadTexture, uploadTexture })).rejects.toThrow(
    "decode failed",
  );
  expect(assets[0]!.dispose).toHaveBeenCalledOnce();
});
it("rejects conflicting descriptors and cancels preloading without leaking a texture", async () => {
  const { delivery, loadTexture, assets, uploadTexture } = setup();
  const controller = new AbortController();
  loadTexture.mockImplementationOnce(async () => {
    const asset = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
    assets.push(asset);
    controller.abort();
    return asset;
  });
  await expect(
    createPngTexturePool({ delivery, loadTexture, uploadTexture, signal: controller.signal }),
  ).rejects.toThrow("cancelled");
  expect(assets[0]!.dispose).toHaveBeenCalledOnce();
  const next = setup();
  const pool = await createPngTexturePool(next);
  await expect(
    pool.loadTexture({ ...next.loadTexture.mock.calls[0]![0], encodedSizeBytes: 1 }),
  ).rejects.toThrow("descriptor");
  pool.dispose();
});

it("includes existing presentation memory in serial preload admission", async () => {
  const { delivery, loadTexture, uploadTexture } = setup();
  const residentCpuBytes = Number(
    delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes,
  );
  await expect(
    createPngTexturePool({ delivery, loadTexture, uploadTexture, residentCpuBytes }),
  ).rejects.toThrow("budget");
  expect(loadTexture).not.toHaveBeenCalled();
});

it("rejects unsupported future-state artifact contracts before decoding any texture", async () => {
  for (const unsupported of ["render", "artifact", "feature"] as const) {
    const { delivery, loadTexture, uploadTexture } = setup();
    const render = delivery.projectionProfile!.renderSurfaces!.find(
      (value) => value.rendererKind === 1,
    )!;
    if (unsupported === "render") render.artifactContractVersion = 2;
    else {
      const artifact = render.artifacts!.find((value) => value.bakedWeb)!.bakedWeb!;
      if (unsupported === "artifact") artifact.contractVersion = 2;
      else artifact.requiredFeatures = [99];
    }
    await expect(createPngTexturePool({ delivery, loadTexture, uploadTexture })).rejects.toThrow(
      "unsupported",
    );
    expect(loadTexture).not.toHaveBeenCalled();
  }
});

it("uploads and releases each decoded image before loading the next within the serial CPU limit", async () => {
  const { delivery, assets, loadTexture, uploadTexture } = setup();
  const size = 1536;
  const decoded = size * size * 4;
  const encoded = decoded + 100;
  const selected = Array.from({ length: 6 }, (_, index) => ({
    assetId: `asset-${index}`,
    checksum: `sha256:${String(index + 1).repeat(64)}`,
    encodedSizeBytes: String(encoded),
    pixelSize: { width: String(size), height: String(size) },
    alphaMode: 1,
    mipCount: 1,
    decodedGpuBytes: String(decoded),
  }));
  const render = delivery.projectionProfile!.renderSurfaces![0]!;
  render.stateBindings = selected.map((_, index) => ({
    stateId: `state-${index}`,
    artifact: { artifactId: "all" },
  }));
  render.artifacts = [
    {
      bakedWeb: {
        artifactId: "all",
        contractVersion: 1,
        requiredFeatures: [1],
        states: selected.map((texture, index) => ({ stateId: `state-${index}`, texture })),
      },
    },
  ];
  delivery.projectionProfile!.renderSurfaces = [render];
  delivery.assetAccess = selected.map((asset) => ({
    assetId: asset.assetId,
    checksum: asset.checksum,
    encodedSizeBytes: asset.encodedSizeBytes,
    mediaType: "image/png",
    url: `https://assets.test/${asset.assetId}`,
    expiresAtUnixMs: "9999999999999",
  }));
  delivery.residency!.textures = {
    textures: selected.map((asset) => ({
      assetId: asset.assetId,
      checksum: asset.checksum,
      pixelSize: asset.pixelSize,
      decodedGpuBytes: String(decoded),
      peakLoadCpuBytes: String(decoded * 2 + encoded),
    })),
    initialGroupId: "intro",
    groupWindows: [{ groupId: "intro", assetIds: selected.map((asset) => asset.assetId) }],
    maximumResidentGpuBytes: String(decoded * 6),
    maximumResidentTextureBindings: "6",
    totalDecodedGpuBytes: String(decoded * 6),
    maximumPeakLoadCpuBytes: String(decoded * 2 + encoded),
  };
  const limits = delivery.capabilityProfile!.limits!.texture!;
  limits.maxGpuBytes =
    limits.maxEncodedCacheBytes =
    limits.maxSerialLoadCpuBytes =
      String(64 * 1024 * 1024);
  limits.maxTextureBindings = "8";
  loadTexture.mockImplementation(async () => {
    expect(assets.every((asset) => asset.releaseCpuCopy.mock.calls.length === 1)).toBe(true);
    const value = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
    assets.push(value);
    return value;
  });
  const pool = await createPngTexturePool({ delivery, loadTexture, uploadTexture });
  expect(loadTexture).toHaveBeenCalledTimes(6);
  expect(uploadTexture).toHaveBeenCalledTimes(6);
  expect(pool.retainedCpuBytes).toBe(0);
  expect(pool.gpuBytes).toBe(decoded * 6);
  pool.dispose();
});
it("rejects incomplete GPU upload and releases its decoded image", async () => {
  const { delivery, loadTexture, assets } = setup();
  await expect(createPngTexturePool({ delivery, loadTexture, uploadTexture() {} })).rejects.toThrow(
    "upload",
  );
  expect(assets[0]!.dispose).toHaveBeenCalledOnce();
});

it("loads only the requested group window and releases textures after the last lease", async () => {
  const { delivery, assets, loadTexture, uploadTexture } = setup();
  Object.assign(delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-0", "png:texture-1"] },
      { groupId: "last", assetIds: ["png:texture-1", "png:texture-2"] },
    ],
    maximumResidentGpuBytes: "13107200",
    maximumResidentTextureBindings: "2",
  });
  const pool = await createPool({ delivery, loadTexture, uploadTexture });
  expect(loadTexture).not.toHaveBeenCalled();
  const first = await pool.acquire("first");
  expect(loadTexture).toHaveBeenCalledTimes(2);
  const second = await pool.acquire("last");
  expect(loadTexture).toHaveBeenCalledTimes(3);
  first.release();
  expect(assets[0]!.dispose).toHaveBeenCalledOnce();
  expect(assets[1]!.dispose).not.toHaveBeenCalled();
  second.release();
  expect(assets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true);
  expect(pool.gpuBytes).toBe(0);
  pool.dispose();
});

it("keeps the previous lease pinned when acquiring another window fails", async () => {
  const context = setup();
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-0"] },
      { groupId: "last", assetIds: ["png:texture-1", "png:texture-2"] },
    ],
    maximumResidentGpuBytes: "9437184",
    maximumResidentTextureBindings: "2",
  });
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  context.loadTexture.mockRejectedValueOnce(new Error("decode failed"));
  await expect(pool.acquire("last")).rejects.toThrow("decode failed");
  expect(context.assets[0]!.dispose).not.toHaveBeenCalled();
  expect(pool.getTexture(first.assets[0]!).texture).toBe(context.assets[0]!.texture);
  const retry = await pool.acquire("last");
  first.release();
  expect(context.assets[0]!.dispose).toHaveBeenCalledOnce();
  retry.release();
  pool.dispose();
});

it("does not resurrect textures after disposing a pool during loading", async () => {
  const context = setup();
  const pool = await createPool(context);
  let finish!: (value: { texture: Texture; dispose(): void; releaseCpuCopy(): void }) => void;
  const texture = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
  context.loadTexture.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = pool.acquire("intro");
  await vi.waitFor(() => expect(context.loadTexture).toHaveBeenCalledOnce());
  pool.dispose();
  finish(texture);
  await expect(pending).rejects.toThrow("disposed");
  expect(texture.dispose).toHaveBeenCalledOnce();
  expect(pool.gpuBytes).toBe(0);
});

it("reuses verified encoded bytes after GPU release without retaining decoded images", async () => {
  const context = setup();
  const bytes = new Uint8Array([1, 2, 3]);
  const decoded = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
  context.loadTexture.mockImplementation(async (_asset, options) => {
    options?.onEncodedBytes?.(bytes);
    return decoded;
  });
  const pool = await createPool(context);
  const first = await pool.acquire("intro");
  first.release();
  expect(pool.gpuBytes).toBe(0);
  const second = await pool.acquire("intro");
  expect(context.loadTexture.mock.calls[4]![1]?.encodedBytes).toBe(bytes);
  expect(decoded.releaseCpuCopy).toHaveBeenCalledTimes(8);
  second.release();
  pool.dispose();
});

it("admits a catalog larger than GPU memory while enforcing each resident window and temporary union", async () => {
  const context = setup();
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-0"] },
      { groupId: "last", assetIds: ["png:texture-1", "png:texture-2", "png:texture-3"] },
    ],
    maximumResidentGpuBytes: "10125312",
    maximumResidentTextureBindings: "3",
  });
  context.delivery.capabilityProfile!.limits!.texture!.maxGpuBytes = "11000000";
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  expect(pool.canAcquire("last")).toBe(false);
  await expect(pool.acquire("last")).rejects.toThrow("budget");
  expect(context.assets[0]!.dispose).not.toHaveBeenCalled();
  first.release();
  const next = await pool.acquire("last");
  expect(pool.gpuBytes).toBe(10125312);
  next.release();
  pool.dispose();
});

it("shares a representative residency texture with render-state asset aliases", async () => {
  const context = setup();
  const render = context.delivery.projectionProfile!.renderSurfaces![2]!;
  const states = render.artifacts![0]!.bakedWeb!.states!;
  states[1]!.texture!.checksum = states[0]!.texture!.checksum!;
  context.delivery.assetAccess![3]!.checksum = states[0]!.texture!.checksum!;
  const residency = context.delivery.residency!.textures!;
  residency.textures!.pop();
  residency.totalDecodedGpuBytes = "16334848";
  residency.maximumResidentGpuBytes = "16334848";
  residency.maximumResidentTextureBindings = "3";
  residency.groupWindows![0]!.assetIds!.pop();
  const pool = await createPool(context);
  const lease = await pool.acquire("intro");
  expect(context.assets).toHaveLength(3);
  const representative = pool.assets.find((asset) => asset.assetId === "png:texture-2")!;
  const alias = pool.assets.find((asset) => asset.assetId === "png:texture-3")!;
  expect(pool.getTexture(alias).texture).toBe(pool.getTexture(representative).texture);
  expect(pool.gpuBytes).toBe(16334848);
  lease.release();
  expect(context.assets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true);
  pool.dispose();
});

async function setupRefreshedAccess() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const bytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW3kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const texture = {
    assetId: "image:one",
    checksum,
    encodedSizeBytes: String(bytes.length),
    pixelSize: { width: "1", height: "1" },
    alphaMode: 2,
    mipCount: 1,
    decodedGpuBytes: "4",
  };
  const render = delivery.projectionProfile!.renderSurfaces![0]!;
  render.stateBindings = [{ stateId: "state:one", artifact: { artifactId: "artifact:one" } }];
  render.artifacts = [
    {
      bakedWeb: {
        artifactId: "artifact:one",
        contractVersion: 1,
        requiredFeatures: [1],
        states: [{ stateId: "state:one", texture }],
      },
    },
  ];
  delivery.projectionProfile!.renderSurfaces = [render];
  delivery.assetAccess = [
    {
      ...texture,
      mediaType: "image/png",
      url: "https://assets.test/initial.png",
      expiresAtUnixMs: "2000",
    },
  ];
  delivery.residency!.textures = {
    initialGroupId: "first",
    textures: [{ ...texture, peakLoadCpuBytes: String(bytes.length + 8) }],
    groupWindows: [
      { groupId: "first", assetIds: [] },
      { groupId: "last", assetIds: [texture.assetId] },
    ],
    totalDecodedGpuBytes: "4",
    maximumPeakLoadCpuBytes: String(bytes.length + 8),
    maximumResidentGpuBytes: "4",
    maximumResidentTextureBindings: "1",
  };
  const clock = { now: 1000 };
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(bytes, { headers: { "content-type": "image/png" } }),
  );
  const decode = vi.fn(
    async () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap,
  );
  const pool = await createPool({
    delivery,
    fetcher,
    loadTexture: (asset, options) =>
      loadPngTexture(asset, { ...options, now: () => clock.now, decode }),
    uploadTexture: (texture) => texture.onUpdate?.(texture),
  });
  function refreshAccess() {
    clock.now = 3000;
    delivery.assetAccess = delivery.assetAccess!.map((access) => ({
      ...access,
      url: "https://assets.test/refreshed.png",
      expiresAtUnixMs: "4000",
    }));
  }
  return { delivery, pool, fetcher, decode, refreshAccess };
}

it("uses refreshed access when a later group first needs a PNG after its original expiry", async () => {
  const { pool, fetcher, decode, refreshAccess } = await setupRefreshedAccess();
  try {
    const first = await pool.acquire("first");
    first.release();
    refreshAccess();
    const next = await pool.acquire("last");
    expect(fetcher).toHaveBeenCalledWith("https://assets.test/refreshed.png", expect.any(Object));
    expect(decode).toHaveBeenCalledOnce();
    expect(pool.getTexture(next.assets[0]!).texture).toBeInstanceOf(Texture);
    next.release();
  } finally {
    pool.dispose();
  }
});

it("uses refreshed expiry to reload a released PNG from the encoded cache", async () => {
  const { pool, fetcher, decode, refreshAccess } = await setupRefreshedAccess();
  try {
    const first = await pool.acquire("last");
    const texture = pool.getTexture(first.assets[0]!).texture;
    const dispose = vi.spyOn(texture, "dispose");
    first.release();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pool.gpuBytes).toBe(0);
    expect(pool.retainedCpuBytes).toBeGreaterThan(0);
    refreshAccess();
    const next = await pool.acquire("last");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(pool.getTexture(next.assets[0]!).texture).not.toBe(texture);
    next.release();
  } finally {
    pool.dispose();
  }
});

it.each<{
  name: string;
  change(delivery: DeliveryManifestWire): void;
  message: string;
}>([
  {
    name: "missing binding",
    change: (delivery) => {
      delivery.assetAccess = [];
    },
    message: "descriptor mismatch",
  },
  {
    name: "duplicate binding",
    change: (delivery) => {
      delivery.assetAccess!.push({ ...delivery.assetAccess![0]! });
    },
    message: "descriptor mismatch",
  },
  {
    name: "checksum",
    change: (delivery) => {
      delivery.assetAccess![0]!.checksum = `sha256:${"0".repeat(64)}`;
    },
    message: "descriptor mismatch",
  },
  {
    name: "encoded size",
    change: (delivery) => {
      delivery.assetAccess![0]!.encodedSizeBytes = "1000";
    },
    message: "descriptor mismatch",
  },
  {
    name: "media type",
    change: (delivery) => {
      delivery.assetAccess![0]!.mediaType = "video/mp4";
    },
    message: "descriptor mismatch",
  },
  {
    name: "missing URL",
    change: (delivery) => {
      delete delivery.assetAccess![0]!.url;
    },
    message: "missing asset URL",
  },
  {
    name: "malformed expiry",
    change: (delivery) => {
      delivery.assetAccess![0]!.expiresAtUnixMs = "invalid";
    },
    message: "invalid residency integer",
  },
  {
    name: "expired access",
    change: (delivery) => {
      delivery.assetAccess![0]!.expiresAtUnixMs = "2500";
    },
    message: "expired",
  },
])(
  "rejects refreshed access with $name even when verified encoded bytes are cached",
  async ({ change, message }) => {
    const { delivery, pool, fetcher, decode, refreshAccess } = await setupRefreshedAccess();
    try {
      const first = await pool.acquire("last");
      first.release();
      refreshAccess();
      change(delivery);
      await expect(pool.acquire("last")).rejects.toThrow(message);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(decode).toHaveBeenCalledOnce();
      expect(pool.gpuBytes).toBe(0);
    } finally {
      pool.dispose();
    }
  },
);

it("warms unused textures within spare capacity and reuses them for a later group", async () => {
  const context = setup();
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-0"] },
      { groupId: "last", assetIds: ["png:texture-1", "png:texture-2", "png:texture-3"] },
    ],
    maximumResidentGpuBytes: "10125312",
    maximumResidentTextureBindings: "3",
  });
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  expect(pool.residentAssets).toHaveLength(1);
  await pool.warm();
  expect(pool.residentAssets).toHaveLength(4);
  expect(context.assets.every((asset) => asset.releaseCpuCopy.mock.calls.length === 1)).toBe(true);
  const next = await pool.acquire("last");
  expect(context.assets).toHaveLength(4);
  first.release();
  next.release();
  pool.dispose();
  expect(context.assets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true);
});

function splitWindows(context: ReturnType<typeof setup>) {
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-0"] },
      { groupId: "last", assetIds: ["png:texture-1"] },
      { groupId: "other", assetIds: ["png:texture-2"] },
      { groupId: "future", assetIds: ["png:texture-3"] },
    ],
    maximumResidentGpuBytes: "9437184",
    maximumResidentTextureBindings: "1",
  });
}

it.each([
  { gpuBytes: 1, bindings: 0, gpuLimit: "9437184", bindingLimit: "8" },
  { gpuBytes: 0, bindings: 1, gpuLimit: "99999999", bindingLimit: "2" },
])("leaves room for other resident media while warming: %o", async (residentResources) => {
  const context = setup();
  splitWindows(context);
  const limits = context.delivery.capabilityProfile!.limits!.texture!;
  limits.maxGpuBytes = residentResources.gpuLimit;
  limits.maxTextureBindings = residentResources.bindingLimit;
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  await pool.warm({ residentResources });
  expect(pool.residentAssets).toHaveLength(1);
  expect(pool.getTexture(first.assets[0]!).texture).toBe(context.assets[0]!.texture);
  first.release();
  pool.dispose();
});

it("evicts unused warmed textures to admit a foreground window without dropping the current one", async () => {
  const context = setup();
  splitWindows(context);
  context.delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "2";
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  await pool.warm();
  expect(pool.residentAssets).toHaveLength(2);
  expect(pool.canAcquire("first", { gpuBytes: 0, bindings: 1 })).toBe(true);
  const next = await pool.acquire("first", { residentResources: { gpuBytes: 0, bindings: 1 } });
  expect(pool.residentAssets).toHaveLength(1);
  expect(context.assets[1]!.dispose).toHaveBeenCalledOnce();
  expect(context.assets[0]!.dispose).not.toHaveBeenCalled();
  first.release();
  next.release();
  pool.dispose();
});

it("keeps foreground textures usable when speculative loading fails", async () => {
  const context = setup();
  splitWindows(context);
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  context.loadTexture.mockRejectedValueOnce(new Error("offline"));
  await expect(pool.warm()).resolves.toBeUndefined();
  expect(pool.getTexture(first.assets[0]!).texture).toBe(context.assets[0]!.texture);
  const next = await pool.acquire("last");
  expect(next.assets[0]!.assetId).toBe("png:texture-1");
  first.release();
  next.release();
  pool.dispose();
});

it("does not decode speculative textures when current media consumes the serial CPU budget", async () => {
  const context = setup();
  splitWindows(context);
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  await pool.warm({
    residentCpuBytes: Number(
      context.delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes,
    ),
  });
  expect(context.assets).toHaveLength(1);
  expect(pool.getTexture(first.assets[0]!).texture).toBe(context.assets[0]!.texture);
  first.release();
  pool.dispose();
});

it("aborts a slow speculative network request before acquiring a foreground group", async () => {
  const { pool, fetcher, decode } = await setupRefreshedAccess();
  let backgroundSignal: AbortSignal | undefined;
  fetcher.mockImplementationOnce(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        backgroundSignal = options?.signal as AbortSignal;
        backgroundSignal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      }),
  );
  const warming = pool.warm();
  await vi.waitFor(() => expect(backgroundSignal).toBeDefined());
  const next = await pool.acquire("last");
  await warming;
  expect(backgroundSignal?.aborted).toBe(true);
  expect(decode).toHaveBeenCalledOnce();
  expect(pool.getTexture(next.assets[0]!).texture).toBeInstanceOf(Texture);
  next.release();
  pool.dispose();
});

it("drains uncancellable speculative decoding before foreground work and disposes the cancelled result", async () => {
  const context = setup();
  splitWindows(context);
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  const cancelled = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
  let finish!: (value: typeof cancelled) => void;
  let signal: AbortSignal | undefined;
  context.loadTexture.mockImplementationOnce((_asset, options) => {
    signal = options?.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const warming = pool.warm();
  await vi.waitFor(() => expect(signal).toBeDefined());
  const foreground = pool.acquire("last");
  expect(signal?.aborted).toBe(true);
  expect(context.assets).toHaveLength(1);
  finish(cancelled);
  const next = await foreground;
  await warming;
  expect(cancelled.dispose).toHaveBeenCalledOnce();
  expect(cancelled.releaseCpuCopy).not.toHaveBeenCalled();
  expect(pool.getTexture(next.assets[0]!).texture).not.toBe(cancelled.texture);
  first.release();
  next.release();
  pool.dispose();
});

it("cancels warming and releases a late decoded texture when the pool is disposed", async () => {
  const context = setup();
  splitWindows(context);
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  const cancelled = { texture: new Texture(), releaseCpuCopy: vi.fn(), dispose: vi.fn() };
  let finish!: (value: typeof cancelled) => void;
  context.loadTexture.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const warming = pool.warm();
  await vi.waitFor(() => expect(finish).toBeDefined());
  pool.dispose();
  finish(cancelled);
  await warming;
  expect(cancelled.dispose).toHaveBeenCalledOnce();
  expect(pool.residentAssets).toHaveLength(0);
  expect(pool.retainedCpuBytes).toBe(0);
  first.release();
});

it("preserves requested warmed textures while evicting other speculative textures", async () => {
  const context = setup();
  splitWindows(context);
  context.delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "4";
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  await pool.warm();
  const warmed = pool.assets.find((asset) => asset.assetId === "png:texture-1")!;
  const texture = pool.getTexture(warmed).texture;
  expect(context.assets).toHaveLength(4);
  const next = await pool.acquire("last", { residentResources: { gpuBytes: 0, bindings: 2 } });
  expect(pool.getTexture(next.assets[0]!).texture).toBe(texture);
  expect(context.assets).toHaveLength(4);
  expect(pool.residentAssets).toHaveLength(2);
  first.release();
  next.release();
  pool.dispose();
});

it("reclaims speculative encoded CPU memory before preparing replacement media", async () => {
  const context = setup();
  splitWindows(context);
  context.loadTexture.mockImplementation(async (_asset, options) => {
    options?.onEncodedBytes?.(new Uint8Array([1, 2, 3]));
    const result = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
    context.assets.push(result);
    return result;
  });
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  await pool.warm();
  expect(pool.retainedCpuBytes).toBe(12);
  pool.discardWarm();
  expect(pool.retainedCpuBytes).toBe(0);
  expect(pool.residentAssets).toHaveLength(1);
  expect(pool.getTexture(first.assets[0]!).texture).toBe(context.assets[0]!.texture);
  first.release();
  pool.dispose();
});

it("retires completed-only textures and spends the freed capacity on unvisited groups", async () => {
  const context = setup();
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "z-first",
    groupWindows: [
      { groupId: "a-current", assetIds: ["png:texture-1", "png:texture-2"] },
      { groupId: "m-later", assetIds: ["png:texture-1", "png:texture-3"] },
      { groupId: "z-first", assetIds: ["png:texture-0", "png:texture-1"] },
    ],
    maximumResidentGpuBytes: "13107200",
    maximumResidentTextureBindings: "2",
  });
  context.delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "3";
  context.loadTexture.mockImplementation(async (_asset, options) => {
    options?.onEncodedBytes?.(new Uint8Array([1, 2, 3]));
    const result = { texture: new Texture(), dispose: vi.fn(), releaseCpuCopy: vi.fn() };
    context.assets.push(result);
    return result;
  });
  const pool = await createPool(context);
  const first = await pool.acquire("z-first");
  pool.activateGroup("z-first");
  await pool.warm();
  expect(pool.residentAssets.map((asset) => asset.assetId)).toEqual([
    "png:texture-0",
    "png:texture-1",
    "png:texture-2",
  ]);
  const shared = pool.getTexture(first.assets[1]!).texture;
  const next = await pool.acquire("a-current");
  pool.activateGroup("a-current");
  first.release();
  expect(context.assets[0]!.dispose).toHaveBeenCalledOnce();
  expect(pool.retainedCpuBytes).toBe(3);
  expect(pool.getTexture(next.assets[0]!).texture).toBe(shared);
  await pool.warm();
  expect(pool.residentAssets.map((asset) => asset.assetId)).toEqual([
    "png:texture-1",
    "png:texture-2",
    "png:texture-3",
  ]);
  expect(context.assets).toHaveLength(4);
  next.release();
  pool.dispose();
});

it("does not infer completed groups when first joining a later group", async () => {
  const context = setup();
  splitWindows(context);
  const pool = await createPool(context);
  const current = await pool.acquire("last");
  pool.activateGroup("last");
  await pool.warm();
  expect(pool.residentAssets.map((asset) => asset.assetId)).toContain("png:texture-0");
  expect(context.assets).toHaveLength(4);
  current.release();
  expect(context.assets[0]!.dispose).toHaveBeenCalledOnce();
  pool.dispose();
});

it("retains an image shared with an unvisited group through a different asset alias", async () => {
  const context = setup();
  const states =
    context.delivery.projectionProfile!.renderSurfaces![2]!.artifacts![0]!.bakedWeb!.states!;
  const checksum = states[0]!.texture!.checksum;
  assert.isDefined(checksum);
  states[1]!.texture!.checksum = checksum;
  context.delivery.assetAccess![3]!.checksum = checksum;
  Object.assign(context.delivery.residency!.textures!, {
    initialGroupId: "first",
    groupWindows: [
      { groupId: "first", assetIds: ["png:texture-2"] },
      { groupId: "last", assetIds: ["png:texture-3"] },
    ],
    maximumResidentGpuBytes: "3227648",
    maximumResidentTextureBindings: "1",
    totalDecodedGpuBytes: "16334848",
  });
  context.delivery.residency!.textures!.textures!.pop();
  const pool = await createPool(context);
  const first = await pool.acquire("first");
  pool.activateGroup("first");
  await pool.warm();
  const next = await pool.acquire("last");
  pool.activateGroup("last");
  first.release();
  expect(pool.getTexture(next.assets[0]!).texture).toBe(context.assets[0]!.texture);
  expect(context.assets).toHaveLength(1);
  expect(context.assets[0]!.dispose).not.toHaveBeenCalled();
  next.release();
  expect(context.assets[0]!.dispose).toHaveBeenCalledOnce();
  pool.dispose();
});
