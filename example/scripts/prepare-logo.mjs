import assert from "node:assert/strict";
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

const json = Buffer.from(JSON.stringify(gltf));
const paddedLength = Math.ceil(json.length / 4) * 4;
const remainingChunks = source.subarray(20 + jsonLength);
const result = Buffer.alloc(20 + paddedLength + remainingChunks.length, 0x20);
source.copy(result, 0, 0, 12);
result.writeUInt32LE(result.length, 8);
result.writeUInt32LE(paddedLength, 12);
result.writeUInt32LE(0x4e4f534a, 16);
json.copy(result, 20);
remainingChunks.copy(result, 20 + paddedLength);
await writeFile(new URL("../assets/icon.glb", import.meta.url), result);
