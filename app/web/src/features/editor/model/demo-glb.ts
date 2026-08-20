import { MapAssetResolver } from "@/features/editor/model/asset-resolver";

const positions = new Float32Array([
  -0.7, -0.7, 0.7, 0.7, -0.7, 0.7, 0.7, 0.7, 0.7, -0.7, 0.7, 0.7, 0.7, -0.7, -0.7, -0.7, -0.7, -0.7,
  -0.7, 0.7, -0.7, 0.7, 0.7, -0.7, -0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, -0.7, -0.7, 0.7, -0.7,
  -0.7, -0.7, -0.7, 0.7, -0.7, -0.7, 0.7, -0.7, 0.7, -0.7, -0.7, 0.7, 0.7, -0.7, 0.7, 0.7, -0.7,
  -0.7, 0.7, 0.7, -0.7, 0.7, 0.7, 0.7, -0.7, -0.7, -0.7, -0.7, -0.7, 0.7, -0.7, 0.7, 0.7, -0.7, 0.7,
  -0.7,
]);

const normals = new Float32Array([
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0,
  1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0,
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
]);

const indices = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16,
  18, 19, 20, 21, 22, 20, 22, 23,
]);

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output;
}

function copyTypedArray(target: Uint8Array, offset: number, source: Float32Array | Uint16Array) {
  target.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), offset);
}

export function createDemoGlbDataUrl(): string {
  const positionsOffset = 0;
  const normalsOffset = positions.byteLength;
  const indicesOffset = normalsOffset + normals.byteLength;
  const binaryLength = indicesOffset + indices.byteLength;
  const gltf = {
    asset: { version: "2.0", generator: "Unframe demo fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Unframe sculpture" }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "Unframe violet",
        pbrMetallicRoughness: {
          baseColorFactor: [0.36, 0.31, 0.95, 1],
          metallicFactor: 0.24,
          roughnessFactor: 0.28,
        },
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: positionsOffset,
        byteLength: positions.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: normalsOffset,
        byteLength: normals.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: indicesOffset,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: "VEC3",
        min: [-0.7, -0.7, -0.7],
        max: [0.7, 0.7, 0.7],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
    ],
  };

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
  const paddedBinaryLength = Math.ceil(binaryLength / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const bytes = new Uint8Array(totalLength);
  const header = new DataView(bytes.buffer);

  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, totalLength, true);
  header.setUint32(12, paddedJsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + paddedJsonLength);
  bytes.set(json, 20);

  const binaryHeaderOffset = 20 + paddedJsonLength;
  header.setUint32(binaryHeaderOffset, paddedBinaryLength, true);
  header.setUint32(binaryHeaderOffset + 4, 0x004e4942, true);
  const binaryOffset = binaryHeaderOffset + 8;
  copyTypedArray(bytes, binaryOffset + positionsOffset, positions);
  copyTypedArray(bytes, binaryOffset + normalsOffset, normals);
  copyTypedArray(bytes, binaryOffset + indicesOffset, indices);

  return `data:model/gltf-binary;base64,${encodeBase64(bytes)}`;
}

export function createDemoAssetResolver(): MapAssetResolver {
  return new MapAssetResolver(new Map([["demo-model", createDemoGlbDataUrl()]]));
}
