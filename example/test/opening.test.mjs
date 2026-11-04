import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, evaluateTimelineTrack } from "@unframe-dev/playback";
import config from "../unframe.config.ts";
import { definition, initialState } from "./project.mjs";

const brandId = reactResourceId("host", "brand");
const logo = Object.values(definition.scene.nodes).find(
  (node) => node.kind === "model" && node.assetId === "logo-model",
);
const at = (property, milliseconds, nodeId = brandId) => {
  const timeline = Object.values(definition.flow.timelines).find((entry) =>
    entry.tracks.some((track) => track.target.nodeId === nodeId),
  );
  assert.ok(timeline, `${nodeId} の Timeline が必要`);
  const track = timeline.tracks.find(
    (entry) => entry.target.property === property && entry.target.nodeId === nodeId,
  );
  assert.ok(track, `${property} トラックが必要`);
  return evaluateTimelineTrack(track, timeline.durationMilliseconds, milliseconds);
};

test("開幕完了後にだけ次の場面への入力を受け付ける", () => {
  const completed = advanceCueClock(definition, initialState(), 3001).state;
  assert.equal(completed.currentStepId, "opening-ready");
  const step = definition.flow.groups.demo.steps[completed.currentStepId];
  assert.ok(
    step.cues.some(
      (cue) => cue.trigger.kind === "logicalInput" && cue.trigger.action === "presenter.next",
    ),
  );
});

test("ロゴは画像 Surface ではなく icon.glb の Model として配置する", async () => {
  assert.ok(logo, "ロゴを描画する Model が必要");
  assert.equal(logo.assetId, "logo-model");
  assert.equal(config.assets[logo.assetId].mediaType, "model/gltf-binary");
  const bytes = await readFile(new URL("../assets/icon.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  assert.equal(gltf.animations?.length ?? 0, 0);
  const original = await readFile(new URL("../../assets/icon.glb", import.meta.url));
  assert.deepEqual(
    bytes.subarray(20 + jsonLength),
    original.subarray(20 + original.readUInt32LE(12)),
  );
  assert.equal(gltf.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord, 0);
  assert.ok(
    gltf.meshes.every((mesh) =>
      mesh.primitives.every(
        (primitive) =>
          "TEXCOORD_0" in primitive.attributes && !("TEXCOORD_1" in primitive.attributes),
      ),
    ),
  );
});

test("ロゴの上端を上向きにし、正面を観客へ向ける", () => {
  const [x, y, z, w] = logo.transform.rotation;
  const top = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const front = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(top[axis] - [0, 1, 0][axis]) < 1e-12);
    assert.ok(Math.abs(front[axis] - [0, 0, 1][axis]) < 1e-12);
  }
});

test("開幕は自動で始まり、ロゴと Unframe が 0.9 秒かけて現れる", () => {
  const initial = initialState();
  assert.equal(initial.nodes[brandId].opacity, 0);
  const started = advanceCueClock(definition, initial, 1).state;
  assert.equal(started.activeRuns.length, 1, "ロゴと文字の開幕を単一 Timeline で開始する");
  for (const run of started.activeRuns) assert.equal(run.startedAtRuntimeTimeMilliseconds, 1);
  assert.equal(at("opacity", 450), 0.5);
  assert.equal(at("opacity", 900), 1);
  assert.deepEqual(at("transform.position", 900), [0.254, 1.6, -2]);
  assert.deepEqual(at("transform.scale", 900), [1, 1, 1]);
});

test("表示後は 0.8 秒静止し、縮小と左上への移動を同じタイミングで行う", () => {
  assert.equal(at("opacity", 1700), 1);
  assert.deepEqual(at("transform.position", 1700), [0.254, 1.6, -2]);
  assert.deepEqual(at("transform.scale", 1700), [1, 1, 1]);
  const middle = at("transform.position", 2350);
  assert.ok(Math.abs(middle[0] - -0.55236) < 1e-12);
  assert.ok(Math.abs(middle[1] - 2.025) < 1e-12);
  assert.equal(middle[2], -2);
  for (const axis of at("transform.scale", 2350)) {
    assert.ok(Math.abs(axis - 0.66) < 1e-12);
  }
});

test("3 秒で移動を終え、Unframe を左上で維持する", () => {
  const completed = advanceCueClock(definition, initialState(), 3001).state;
  assert.equal(completed.activeRuns.length, 0);
  assert.equal(completed.ended, false);
  assert.deepEqual(completed.nodes[brandId].transform.position, [-1.35872, 2.45, -2]);
  assert.deepEqual(completed.nodes[brandId].transform.scale, [0.32, 0.32, 0.32]);
  assert.equal(completed.nodes[brandId].opacity, 1);
  const later = advanceCueClock(definition, completed, 10001).state;
  assert.deepEqual(later.nodes[brandId], completed.nodes[brandId]);
  assert.equal(later.activeRuns.length, 0);
  const surface = definition.scene.surfaces[reactResourceId("surface", "brand")];
  assert.equal(Object.values(surface.baseSemanticTree.nodes)[0].text, "Unframe");
});

test("3D ロゴは文字との間隔と高さを保ってフェード・縮小移動し、左上に残る", () => {
  assert.equal(initialState().nodes[logo.id].opacity, 0);
  for (const time of [0, 450, 900, 1700, 2025, 2350, 2675, 3000]) {
    assert.equal(at("opacity", time, logo.id), at("opacity", time));
    const modelPosition = at("transform.position", time, logo.id);
    const textPosition = at("transform.position", time);
    const modelScale = at("transform.scale", time, logo.id);
    const textScale = at("transform.scale", time);
    assert.ok(Math.abs(textPosition[0] - modelPosition[0] - 0.898 * textScale[0]) < 1e-12);
    assert.equal(modelPosition[1], textPosition[1]);
    assert.equal(modelPosition[2], textPosition[2]);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(Math.abs(modelScale[axis] - 0.4 * textScale[axis]) < 1e-12);
  }
  const completed = advanceCueClock(definition, initialState(), 3001).state;
  assert.deepEqual(completed.nodes[logo.id].transform.position, [-1.64608, 2.45, -2]);
  assert.deepEqual(completed.nodes[logo.id].transform.scale, [0.128, 0.128, 0.128]);
  assert.equal(completed.nodes[logo.id].opacity, 1);
  assert.deepEqual(
    advanceCueClock(definition, completed, 10001).state.nodes[logo.id],
    completed.nodes[logo.id],
  );
});
