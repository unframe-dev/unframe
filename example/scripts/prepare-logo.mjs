import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../../assets/icon.glb", import.meta.url));
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(16), 0x4e4f534a);
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString("utf8"));

assert.equal(gltf.materials.length, 1);
assert.equal(gltf.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord, 1);
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_1));
    primitive.attributes.TEXCOORD_0 = primitive.attributes.TEXCOORD_1;
    delete primitive.attributes.TEXCOORD_1;
  }
}
gltf.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 0;

assert.equal(gltf.images.length, 1);
assert.equal(gltf.images[0].mimeType, "image/png");
const imageView = gltf.bufferViews[gltf.images[0].bufferView];
assert.equal(imageView, gltf.bufferViews.at(-1));
assert.equal(imageView.buffer, 0);
const binaryOffset = 20 + jsonLength;
assert.equal(source.readUInt32LE(binaryOffset + 4), 0x004e4942);
const sourceBinary = source.subarray(binaryOffset + 8);
const png = execFileSync(
  process.env.UNFRAME_FFMPEG_PATH ?? "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "image2pipe",
    "-i",
    "pipe:0",
    "-vf",
    "scale=1024:1024:flags=lanczos",
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgba",
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "pipe:1",
  ],
  {
    input: sourceBinary.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength),
    maxBuffer: 8 * 1024 * 1024,
  },
);
const binary = Buffer.concat([sourceBinary.subarray(0, imageView.byteOffset), png]);
imageView.byteLength = png.length;
gltf.buffers[0].byteLength = binary.length;

const json = Buffer.from(JSON.stringify(gltf));
const paddedLength = Math.ceil(json.length / 4) * 4;
const paddedBinaryLength = Math.ceil(binary.length / 4) * 4;
const result = Buffer.alloc(28 + paddedLength + paddedBinaryLength);
result.fill(0x20, 20, 20 + paddedLength);
source.copy(result, 0, 0, 12);
result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(paddedLength, 12);
result.writeUInt32LE(0x4e4f534a, 16);
json.copy(result, 20);
result.writeUInt32LE(paddedBinaryLength, 20 + paddedLength);
result.writeUInt32LE(0x004e4942, 24 + paddedLength);
binary.copy(result, 28 + paddedLength);
await writeFile(new URL("../assets/icon.glb", import.meta.url), result);
