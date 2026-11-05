import { writeFile } from "node:fs/promises";

const faces = [
  {
    normal: [0, 0, 1],
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
  {
    normal: [1, 0, 0],
    corners: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
];
const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const positions = [],
  normals = [],
  colors = [],
  indices = [];
for (const face of faces) {
  const first = positions.length / 3;
  for (const [x, y, z] of face.corners) {
    positions.push(x / 2, y / 2, z / 2);
    normals.push(...face.normal);
    colors.push(...(y > 0 ? [220, 134, 134] : [113, 135, 250]).map((v) => linear(v / 255)), 1);
  }
  indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}
const arrays = [
  new Float32Array(positions),
  new Float32Array(normals),
  new Float32Array(colors),
  new Uint16Array(indices),
];
const binary = Buffer.concat(arrays.map((array) => Buffer.from(array.buffer)));
let offset = 0;
const views = arrays.map((array, index) => {
  const view = {
    buffer: 0,
    byteOffset: offset,
    byteLength: array.byteLength,
    target: index === 3 ? 34963 : 34962,
  };
  offset += array.byteLength;
  return view;
});
const gltf = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Demo cube", mesh: 0 }],
  meshes: [
    {
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }],
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 0.6,
      },
    },
  ],
  buffers: [{ byteLength: binary.length }],
  bufferViews: views,
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 24,
      type: "VEC3",
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: 24, type: "VEC4" },
    { bufferView: 3, componentType: 5123, count: 36, type: "SCALAR" },
  ],
};
const json = Buffer.from(JSON.stringify(gltf));
const padded = Math.ceil(json.length / 4) * 4;
const output = Buffer.alloc(28 + padded + binary.length, 0x20);
output.writeUInt32LE(0x46546c67, 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(padded, 12);
output.writeUInt32LE(0x4e4f534a, 16);
json.copy(output, 20);
output.writeUInt32LE(binary.length, 20 + padded);
output.writeUInt32LE(0x004e4942, 24 + padded);
binary.copy(output, 28 + padded);
await writeFile(new URL("../../assets/cube.glb", import.meta.url), output);
