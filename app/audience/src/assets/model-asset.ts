import { Material, Mesh, SkinnedMesh, Texture, type AnimationClip, type Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
function validateBinary(bytes: Uint8Array<ArrayBuffer>, asset: ModelAsset) {
  const v = new DataView(bytes.buffer);
  if (
    bytes.length < 20 ||
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length
  )
    fail("invalid header");
  if (v.getUint32(16, true) !== 0x4e4f534a) fail("JSON chunk missing");
  const len = v.getUint32(12, true);
  if (len % 4 || 20 + len > bytes.length) fail("invalid JSON chunk");
  const json = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + len)),
  );
  if (json.asset?.version !== "2.0") fail("unsupported version");
  // A self-contained GLB cannot cause GLTFLoader to request unverified sidecar files.
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri !== undefined) fail("external URI is forbidden");
  for (const extension of new Set([
    ...(json.extensionsUsed ?? []),
    ...(json.extensionsRequired ?? []),
  ]))
    if (extension !== "KHR_materials_unlit") fail("unsupported extension");
  let binaryStart = 0,
    binaryLength = 0;
  let cursor = 20 + len,
    binaries = 0;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) fail("invalid chunk");
    const size = v.getUint32(cursor, true),
      type = v.getUint32(cursor + 4, true);
    if (size % 4 || cursor + 8 + size > bytes.length || type !== 0x004e4942 || ++binaries > 1)
      fail("invalid binary chunk");
    binaryStart = cursor + 8;
    binaryLength = size;
    cursor += 8 + size;
  }
  if ((json.buffers?.length ?? 0) > 1 || (json.buffers?.[0]?.byteLength ?? 0) > binaryLength)
    fail("invalid buffer size");
  for (const buffer of json.buffers ?? [])
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
      fail("invalid buffer size");
  for (const bufferView of json.bufferViews ?? [])
    if (
      (bufferView.buffer ?? 0) !== 0 ||
      !Number.isSafeInteger(bufferView.byteOffset ?? 0) ||
      !Number.isSafeInteger(bufferView.byteLength) ||
      (bufferView.byteOffset ?? 0) < 0 ||
      bufferView.byteLength < 0 ||
      (bufferView.byteOffset ?? 0) + bufferView.byteLength > (json.buffers?.[0]?.byteLength ?? 0)
    )
      fail("invalid buffer view");
  let accessorBytes = 0;
  for (const accessor of json.accessors ?? []) {
    const components = (
      { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as Record<string, number>
    )[accessor.type];
    const componentBytes = (
      { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>
    )[accessor.componentType];
    if (
      !components ||
      !componentBytes ||
      !Number.isSafeInteger(accessor.count) ||
      accessor.count < 0 ||
      accessor.count > Math.max(asset.vertexCount, asset.maxBonesPerSkin, asset.encodedSizeBytes)
    )
      fail("invalid accessor size");
    const allocation = components * componentBytes * accessor.count;
    if (
      !Number.isSafeInteger(allocation) ||
      allocation > (asset.textureBudget?.maxCpuBytes ?? asset.encodedSizeBytes * 16)
    )
      fail("accessor budget exceeded");
    accessorBytes += allocation;
    if (
      accessor.sparse &&
      (!Number.isSafeInteger(accessor.sparse.count) ||
        accessor.sparse.count < 0 ||
        accessor.sparse.count > accessor.count)
    )
      fail("invalid sparse accessor");
  }
  let textureBytes = 0;
  const textureSizes: number[] = [];
  for (const image of json.images ?? []) {
    const imageView = json.bufferViews?.[image.bufferView];
    if (!imageView) fail("embedded image missing");
    const start = binaryStart + (imageView.byteOffset ?? 0),
      size = imageView.byteLength;
    const content = bytes.subarray(start, start + size);
    let width = 0,
      height = 0;
    if (
      image.mimeType === "image/png" &&
      content.length >= 24 &&
      content[0] === 137 &&
      content[1] === 80 &&
      content[2] === 78 &&
      content[3] === 71
    ) {
      const header = new DataView(content.buffer, content.byteOffset, content.byteLength);
      width = header.getUint32(16);
      height = header.getUint32(20);
    } else if (image.mimeType === "image/jpeg" && content[0] === 255 && content[1] === 216) {
      let at = 2;
      while (at + 4 <= content.length) {
        if (content[at] !== 255) break;
        const marker = content[at + 1]!;
        if (marker === 217 || marker === 218) break;
        const length = (content[at + 2]! << 8) | content[at + 3]!;
        if (length < 2 || at + 2 + length > content.length) break;
        if ([192, 193, 194].includes(marker) && length >= 7) {
          height = (content[at + 5]! << 8) | content[at + 6]!;
          width = (content[at + 7]! << 8) | content[at + 8]!;
          break;
        }
        at += 2 + length;
      }
    }
    const budget = asset.textureBudget;
    if (
      !budget ||
      !width ||
      !height ||
      width > budget.maxWidth ||
      height > budget.maxHeight ||
      width * height > budget.maxPixels
    )
      fail("texture budget exceeded");
    let mipBytes = 0,
      mipWidth = width,
      mipHeight = height;
    for (;;) {
      mipBytes += mipWidth * mipHeight * 4;
      if (mipWidth === 1 && mipHeight === 1) break;
      mipWidth = Math.max(1, Math.floor(mipWidth / 2));
      mipHeight = Math.max(1, Math.floor(mipHeight / 2));
    }
    textureSizes.push(mipBytes);
    textureBytes += width * height * 4;
  }
  const gpuBytes = (json.textures ?? []).reduce((sum: number, texture: { source?: number }) => {
    const value = textureSizes[texture.source ?? -1];
    if (value === undefined) fail("invalid texture source");
    return sum + value;
  }, 0);
  if (
    asset.textureBudget &&
    ((json.textures?.length ?? 0) > asset.textureBudget.maxBindings ||
      gpuBytes > asset.textureBudget.maxGpuBytes ||
      textureBytes + accessorBytes + asset.encodedSizeBytes > asset.textureBudget.maxCpuBytes)
  )
    fail("texture budget exceeded");
  const features = new Set<number>();
  if (json.animations?.length) features.add(1);
  if (json.skins?.length) features.add(2);
  let primitives = 0,
    vertices = 0,
    triangles = 0,
    morph = 0;
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives ?? []) {
      primitives++;
      if (p.material === undefined) features.add(6);
      else if (!Number.isSafeInteger(p.material) || p.material < 0 || !json.materials?.[p.material])
        fail("invalid material");
      const count = json.accessors?.[p.attributes?.POSITION]?.count;
      if (!Number.isSafeInteger(count) || count < 0) fail("invalid vertex accessor");
      vertices += count;
      const indexed = p.indices === undefined ? count : json.accessors?.[p.indices]?.count;
      if (!Number.isSafeInteger(indexed) || indexed < 0 || (p.mode ?? 4) !== 4 || indexed % 3)
        fail("unsupported primitive");
      triangles += indexed / 3;
      morph = Math.max(morph, p.targets?.length ?? 0);
    }
  if (morph) features.add(3);
  for (const material of json.materials ?? []) {
    if (material.alphaMode === "BLEND") features.add(4);
    if (material.alphaMode === "MASK") features.add(5);
    if (material.extensions?.KHR_materials_unlit) features.add(7);
    else features.add(6);
  }
  if ([...features].some((feature) => !asset.requiredFeatures.includes(feature)))
    fail("undeclared feature");
  const bones = Math.max(
    0,
    ...(json.skins ?? []).map((skin: { joints?: unknown[] }) => skin.joints?.length ?? 0),
  );
  if (
    (json.nodes?.length ?? 0) !== asset.nodeCount ||
    primitives !== asset.primitiveCount ||
    vertices !== asset.vertexCount ||
    triangles !== asset.triangleCount ||
    morph !== asset.maxMorphTargetsPerPrimitive ||
    bones !== asset.maxBonesPerSkin ||
    (json.animations?.length ?? 0) !== asset.animationClipCount
  )
    fail("resource metadata mismatch");
  return {
    retainedCpuBytes: asset.encodedSizeBytes + accessorBytes + textureBytes,
    textureGpuBytes: gpuBytes,
    textureBindings: json.textures?.length ?? 0,
  };
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
  const checkAbort = () => {
    if (options.signal?.aborted) fail("load aborted");
  };
  try {
    checkAbort();
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.username || url.password)
      fail("URL must use HTTPS without credentials");
    if (
      !Number.isFinite(asset.expiresAtUnixMs) ||
      asset.expiresAtUnixMs <= (options.now ?? Date.now)()
    )
      fail("delivery URL expired");
    if (
      !Number.isSafeInteger(asset.encodedSizeBytes) ||
      asset.encodedSizeBytes < 20 ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.checksum)
    )
      fail("invalid metadata");
    const response = await (options.fetcher ?? fetch)(asset.url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) fail("request failed");
    if (
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "model/gltf-binary"
    )
      fail("content type required");
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== asset.encodedSizeBytes) fail("encoded size mismatch");
    if (!response.body) fail("response body missing");
    const bytes = new Uint8Array(asset.encodedSizeBytes),
      reader = response.body!.getReader();
    let offset = 0;
    try {
      for (;;) {
        checkAbort();
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.length > bytes.length) fail("encoded size mismatch");
        bytes.set(chunk.value, offset);
        offset += chunk.value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (offset !== bytes.length) fail("encoded size mismatch");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if (
      "sha256:" + [...hash].map((v) => v.toString(16).padStart(2, "0")).join("") !==
      asset.checksum
    )
      fail("checksum mismatch");
    const budget = validateBinary(bytes, asset);
    checkAbort();
    data = await (
      options.parse ??
      (async (buffer) => {
        const result = await new GLTFLoader().parseAsync(buffer, "");
        return { scene: result.scene, animations: result.animations, scenes: result.scenes };
      })
    )(bytes.buffer);
    checkAbort();
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
