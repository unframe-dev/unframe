import { expect, it, vi } from "vitest";
import { Texture } from "three";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import type { PngTextureAsset } from "../png-texture";
import { createPngTexturePool } from "../png-texture-pool";

function setup() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const assets: { texture: Texture; dispose: ReturnType<typeof vi.fn> }[] = [];
  const loadTexture = vi.fn(async (_asset: PngTextureAsset) => {
    const asset = { texture: new Texture(), dispose: vi.fn() };
    assets.push(asset);
    return asset;
  });
  return { delivery, assets, loadTexture };
}
it("loads every selected state before returning and keeps shared textures until pool disposal", async () => {
  const { delivery, assets, loadTexture } = setup();
  const pool = await createPngTexturePool({ delivery, loadTexture });
  expect(loadTexture).toHaveBeenCalledTimes(4);
  const descriptor = loadTexture.mock.calls[0]![0];
  const first = await pool.loadTexture(descriptor);
  const second = await pool.loadTexture(descriptor);
  expect(first.texture).toBe(second.texture);
  first.dispose();
  second.dispose();
  expect(assets.every((asset) => asset.dispose.mock.calls.length === 0)).toBe(true);
  expect(pool.retainedCpuBytes).toBe(19562496);
  pool.dispose();
  pool.dispose();
  expect(assets.every((asset) => asset.dispose.mock.calls.length === 1)).toBe(true);
  await expect(pool.loadTexture(descriptor)).rejects.toThrow("disposed");
});
it("rejects residency or aggregate budget mismatches before loading", async () => {
  const { delivery, loadTexture } = setup();
  delivery.residency!.textures!.textures!.pop();
  await expect(createPngTexturePool({ delivery, loadTexture })).rejects.toThrow("residency");
  expect(loadTexture).not.toHaveBeenCalled();
  const next = setup();
  next.delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes = "20000000";
  await expect(createPngTexturePool(next)).rejects.toThrow("budget");
  expect(next.loadTexture).not.toHaveBeenCalled();
});
it("releases textures already loaded when a later preload fails", async () => {
  const { delivery, assets, loadTexture } = setup();
  loadTexture
    .mockImplementationOnce(async () => {
      const asset = { texture: new Texture(), dispose: vi.fn() };
      assets.push(asset);
      return asset;
    })
    .mockRejectedValueOnce(new Error("decode failed"));
  await expect(createPngTexturePool({ delivery, loadTexture })).rejects.toThrow("decode failed");
  expect(assets[0]!.dispose).toHaveBeenCalledOnce();
});
it("rejects conflicting descriptors and cancels preloading without leaking a texture", async () => {
  const { delivery, loadTexture, assets } = setup();
  const controller = new AbortController();
  loadTexture.mockImplementationOnce(async () => {
    const asset = { texture: new Texture(), dispose: vi.fn() };
    assets.push(asset);
    controller.abort();
    return asset;
  });
  await expect(
    createPngTexturePool({ delivery, loadTexture, signal: controller.signal }),
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
  const { delivery, loadTexture } = setup();
  const residentCpuBytes = Number(
    delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes,
  );
  await expect(createPngTexturePool({ delivery, loadTexture, residentCpuBytes })).rejects.toThrow(
    "budget",
  );
  expect(loadTexture).not.toHaveBeenCalled();
});

it("rejects unsupported future-state artifact contracts before decoding any texture", async () => {
  for (const unsupported of ["render", "artifact", "feature"] as const) {
    const { delivery, loadTexture } = setup();
    const render = delivery.projectionProfile!.renderSurfaces!.find(
      (value) => value.rendererKind === 1,
    )!;
    if (unsupported === "render") render.artifactContractVersion = 2;
    else {
      const artifact = render.artifacts!.find((value) => value.bakedWeb)!.bakedWeb!;
      if (unsupported === "artifact") artifact.contractVersion = 2;
      else artifact.requiredFeatures = [99];
    }
    await expect(createPngTexturePool({ delivery, loadTexture })).rejects.toThrow("unsupported");
    expect(loadTexture).not.toHaveBeenCalled();
  }
});
