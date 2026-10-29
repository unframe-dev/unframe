import { glbStructureSchema } from "./glb-structure";
import type { ModelAsset } from "./model-asset";

export function validateModelBinary(
  bytes: Uint8Array<ArrayBuffer>,
  asset: ModelAsset,
  fail: (reason: string) => never,
) {
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
  const parsed = glbStructureSchema.safeParse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + len))),
  );
  if (!parsed.success) return fail("invalid JSON structure");
  const json = parsed.data;
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
  for (const bufferView of json.bufferViews ?? [])
    if (
      (bufferView.buffer ?? 0) !== 0 ||
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
    if (accessor.sparse && accessor.sparse.count > accessor.count) fail("invalid sparse accessor");
  }
  let textureBytes = 0;
  const textureSizes: number[] = [];
  for (const image of json.images ?? []) {
    const imageView = json.bufferViews?.[image.bufferView ?? -1];
    if (!imageView) return fail("embedded image missing");
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
  const gpuBytes = (json.textures ?? []).reduce((sum, texture) => {
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
      else if (!json.materials?.[p.material]) fail("invalid material");
      const count = json.accessors?.[p.attributes.POSITION ?? -1]?.count;
      if (count === undefined) return fail("invalid vertex accessor");
      vertices += count;
      const indexed = p.indices === undefined ? count : json.accessors?.[p.indices]?.count;
      if (indexed === undefined || (p.mode ?? 4) !== 4 || indexed % 3)
        return fail("unsupported primitive");
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
  const bones = Math.max(0, ...(json.skins ?? []).map((skin) => skin.joints?.length ?? 0));
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
