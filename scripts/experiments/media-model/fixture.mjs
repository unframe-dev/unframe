import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const out = resolve(process.argv[2] ?? ".unframe/media-model-spike/fixtures");
mkdirSync(out, { recursive: true });
const chunks = [],
  bufferViews = [],
  accessors = [];
let size = 0;
function data(values, type, components, componentType = 5126, extra = {}) {
  const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const bytes = Buffer.from(array.buffer);
  const aligned = (size + 3) & ~3;
  if (aligned !== size) chunks.push(Buffer.alloc(aligned - size));
  bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: bytes.length });
  chunks.push(bytes);
  size = aligned + bytes.length;
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType,
    count: values.length / components,
    type,
    ...extra,
  });
  return accessors.length - 1;
}
const position = data([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3", 3, 5126, {
  min: [0, 0, 0],
  max: [1, 1, 0],
});
const normal = data([0, 0, 1, 0, 0, 1, 0, 0, 1], "VEC3", 3);
const joints = data(Array(12).fill(0), "VEC4", 4, 5123);
const weights = data([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4", 4);
const morph = data([0, 0, 0, 0, 0, 0, 0, 0, 1], "VEC3", 3, 5126, {
  min: [0, 0, 0],
  max: [0, 0, 1],
});
const inverse = data([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "MAT4", 16);
const time = data([0, 1], "SCALAR", 1, 5126, { min: [0], max: [1] });
const animations = [2, -2].map((end, index) => ({
  name: `clip-${index}`,
  samplers: [
    { input: time, output: data([0, 0, 0, end, 0, 0], "VEC3", 3), interpolation: "LINEAR" },
    { input: time, output: data([0, 0, 0, 0, end, 0], "VEC3", 3), interpolation: "LINEAR" },
    { input: time, output: data([0, index === 0 ? 1 : 0.5], "SCALAR", 1), interpolation: "LINEAR" },
  ],
  channels: [
    { sampler: 0, target: { node: 0, path: "translation" } },
    { sampler: 1, target: { node: 1, path: "translation" } },
    { sampler: 2, target: { node: 2, path: "weights" } },
  ],
}));
const source = {
  asset: { version: "2.0", generator: "Unframe authored CC0 media model spike" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "ModelRoot", children: [1, 2] },
    { name: "Joint" },
    { name: "Triangle", mesh: 0, skin: 0 },
  ],
  skins: [{ joints: [1], inverseBindMatrices: inverse, skeleton: 1 }],
  meshes: [
    {
      weights: [0],
      primitives: [
        {
          attributes: { POSITION: position, NORMAL: normal, JOINTS_0: joints, WEIGHTS_0: weights },
          targets: [{ POSITION: morph }],
          material: 0,
        },
      ],
    },
  ],
  materials: [
    {
      name: "OpaquePbr",
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0.2, 0.1, 0.8],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
    },
  ],
  animations,
  buffers: [{ byteLength: size }],
  bufferViews,
  accessors,
};
function glb(json, name) {
  const raw = Buffer.from(JSON.stringify(json));
  const j = Buffer.alloc((raw.length + 3) & ~3, 0x20);
  raw.copy(j);
  const rawBin = Buffer.concat(chunks);
  const bin = Buffer.alloc((rawBin.length + 3) & ~3);
  rawBin.copy(bin);
  const h = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  h.writeUInt32LE(0x46546c67);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + j.length + bin.length, 8);
  jh.writeUInt32LE(j.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(resolve(out, name), Buffer.concat([h, jh, j, bh, bin]));
}
glb(source, "source.glb");
const normalized = structuredClone(source);
for (const a of normalized.animations) a.channels = a.channels.filter((c) => c.target.node !== 0);
glb(normalized, "root-stripped.glb");
writeFileSync(
  resolve(out, "expected.json"),
  JSON.stringify(
    {
      clips: 2,
      durationSeconds: 1,
      vertices: 3,
      joints: 1,
      morphTargets: 1,
      rootChannelsRemoved: 2,
    },
    null,
    2,
  ) + "\n",
);
console.log(out);
