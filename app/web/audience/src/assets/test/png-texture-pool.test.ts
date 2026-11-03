import { expect, it, vi } from "vite-plus/test";
import { Texture } from "three";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import { pngDeliveryFixture as fixture } from "../../test-support/png-delivery-fixture";
import type { PngTextureAsset } from "../png-texture";
import { createPngTexturePool } from "../png-texture-pool";

function setup() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const assets: {
    texture: Texture;
    releaseCpuCopy: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const loadTexture = vi.fn(async (_asset: PngTextureAsset) => {
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
