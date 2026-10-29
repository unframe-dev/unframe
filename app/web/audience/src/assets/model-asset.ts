import { Material, Mesh, SkinnedMesh, Texture, type AnimationClip, type Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assertAssetCurrent, requestAssetBytes, verifyAssetChecksum } from "./asset-transfer";
import { validateModelBinary } from "./glb-validation";
export interface ModelAsset {
  assetId: string;
  checksum: string;
  encodedSizeBytes: number;
  url: string;
  expiresAtUnixMs: number;
  requiredFeatures: number[];
  nodeCount: number;
  primitiveCount: number;
  vertexCount: number;
  triangleCount: number;
  maxBonesPerSkin: number;
  maxMorphTargetsPerPrimitive: number;
  animationClipCount: number;
  textureBudget?: {
    maxWidth: number;
    maxHeight: number;
    maxPixels: number;
    maxBindings: number;
    maxGpuBytes: number;
    maxCpuBytes: number;
  };
}
interface ModelData {
  scene: Group;
  animations: AnimationClip[];
  scenes?: Group[];
}
interface ModelOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => number;
  parse?: (data: ArrayBuffer) => Promise<ModelData>;
}
class ModelError extends Error {}
function fail(reason: string): never {
  throw new ModelError(`GLB ${reason}`);
}
export function disposeModelScene(scene: Group | Group[]): void {
  const geometries = new Set<Mesh["geometry"]>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>(),
    images = new Set<{ close(): void }>();
  for (const root of Array.isArray(scene) ? scene : [scene])
    root.traverse((object) => {
      if (object instanceof SkinnedMesh) object.skeleton.dispose();
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const v of Object.values(material)) {
          if (v instanceof Texture) {
            textures.add(v);
            if (v.image && typeof v.image.close === "function") images.add(v.image);
          }
        }
      }
    });
  for (const v of geometries) v.dispose();
  for (const v of materials) v.dispose();
  for (const v of textures) v.dispose();
  for (const v of images) v.close();
}
export async function loadModelAsset(
  asset: ModelAsset,
  options: ModelOptions = {},
): Promise<{
  scene: Group;
  animations: AnimationClip[];
  retainedCpuBytes?: number;
  textureGpuBytes?: number;
  textureBindings?: number;
  dispose(): void;
}> {
  let data: ModelData | undefined;
  const checkCurrent = () => assertAssetCurrent(asset, options, fail);
  try {
    checkCurrent();
    const bytes = await requestAssetBytes(asset, options, {
      mimeType: "model/gltf-binary",
      minBytes: 20,
      fail,
    });
    await verifyAssetChecksum(bytes, asset.checksum, fail);
    const budget = validateModelBinary(bytes, asset, fail);
    checkCurrent();
    data = await (
      options.parse ??
      (async (buffer) => {
        const result = await new GLTFLoader().parseAsync(buffer, "");
        return { scene: result.scene, animations: result.animations, scenes: result.scenes };
      })
    )(bytes.buffer);
    checkCurrent();
    const loaded = data;
    let disposed = false;
    return {
      scene: loaded.scene,
      retainedCpuBytes: budget.retainedCpuBytes,
      textureGpuBytes: budget.textureGpuBytes,
      textureBindings: budget.textureBindings,
      animations: loaded.animations,
      dispose() {
        if (disposed) return;
        disposed = true;
        disposeModelScene(loaded.scenes ?? loaded.scene);
      },
    };
  } catch (error) {
    if (data) disposeModelScene(data.scenes ?? data.scene);
    if (error instanceof ModelError) throw error;
    throw new ModelError(options.signal?.aborted ? "GLB load aborted" : "GLB load failed");
  }
}
