import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { transformGlb, type ModelLimits } from "../../../packages/unframe-assets/src/index.ts";

const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const limits: ModelLimits = {
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
  maxDecodedAccessorBytes: 64 * 1024,
  maxNodes: 8,
  maxPrimitives: 4,
  maxVertices: 16,
  maxTriangles: 8,
  maxBonesPerSkin: 4,
  maxMorphTargetsPerPrimitive: 4,
  maxAnimationClips: 4,
};
const request = {
  sourceId: "model-spike-fixture",
  bytes: new Uint8Array(await readFile(source)),
  limits,
};
const result = await transformGlb(request);
assert.ok(result.valid, JSON.stringify(result.diagnostics));
const repeated = await transformGlb(request);
assert.ok(repeated.valid, JSON.stringify(repeated.diagnostics));
assert.deepEqual(result.value.bytes, repeated.value.bytes, "same API input produces same GLB");
const { bytes, ...metadata } = result.value;
assert.deepEqual(metadata.descriptor.clips, {
  "clip-0": { sourceAnimationIndex: 0, durationMilliseconds: 1000 },
  "clip-1": { sourceAnimationIndex: 1, durationMilliseconds: 1000 },
});
const {
  nodeCount,
  primitiveCount,
  vertexCount,
  triangleCount,
  maxBonesPerSkin,
  maxMorphTargetsPerPrimitive,
  animationClipCount,
  rootMotion,
} = metadata.descriptor;
assert.deepEqual(
  {
    nodeCount,
    primitiveCount,
    vertexCount,
    triangleCount,
    maxBonesPerSkin,
    maxMorphTargetsPerPrimitive,
    animationClipCount,
    rootMotion,
  },
  {
    nodeCount: 3,
    primitiveCount: 1,
    vertexCount: 3,
    triangleCount: 1,
    maxBonesPerSkin: 1,
    maxMorphTargetsPerPrimitive: 1,
    animationClipCount: 2,
    rootMotion: "removed",
  },
);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "model.glb"), bytes);
await writeFile(
  resolve(output, "metadata.json"),
  JSON.stringify({ runtime: `bun ${Bun.version}`, limits, ...metadata }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { checksum: metadata.descriptor.checksum, descriptor: metadata.descriptor },
    null,
    2,
  ),
);
