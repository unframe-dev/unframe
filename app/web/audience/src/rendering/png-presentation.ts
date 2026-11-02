import { loadPngTexture, type PngTextureAsset } from "../assets/png-texture";
import { buildPngPlan } from "./png-plan";
import { admitPngMemory } from "./png-memory";
import { createSurfacePresentation, type SurfaceTextureAsset } from "./surface-presentation";
import type { Group, Matrix4 } from "three";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";

export function createPngPresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  residentCpuBytes?: number;
  loadTexture?: (
    asset: PngTextureAsset,
    options?: { signal?: AbortSignal },
  ) => Promise<Pick<Awaited<ReturnType<typeof loadPngTexture>>, "texture" | "dispose">>;
  preloadedTextures?: readonly {
    asset: SurfaceTextureAsset;
    loaded: Pick<Awaited<ReturnType<typeof loadPngTexture>>, "texture" | "dispose">;
  }[];
}) {
  return createSurfacePresentation({
    ...options,
    buildPlan: buildPngPlan,
    loadTexture: options.loadTexture ?? loadPngTexture,
    admitMemory: (assets, resident) =>
      admitPngMemory(
        assets,
        resident,
        Number(options.delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes),
      ),
    assetCpuBytes: (asset) => asset.pixelSize[0] * asset.pixelSize[1] * 4,
  });
}
