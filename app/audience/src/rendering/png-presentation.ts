import { loadPngTexture } from "../assets/png-texture";
import { buildPngPlan } from "./png-plan";
import { admitPngMemory } from "./png-memory";
import { createSurfacePresentation } from "./surface-presentation";
import type { Group, Matrix4 } from "three";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";

export function createPngPresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  residentCpuBytes?: number;
  loadTexture?: typeof loadPngTexture;
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
