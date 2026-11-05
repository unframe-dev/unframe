import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, evaluateTimelineTrack } from "@unframe-dev/playback";
import config from "../../unframe.config.ts";
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
  if (!track)
    return property.split(".").reduce((value, key) => value[key], definition.scene.nodes[nodeId]);
  return evaluateTimelineTrack(track, timeline.durationMilliseconds, milliseconds);
};

test("Unframe と同時に左下と右上から wave を開始し、開幕完了で消す", async () => {
  const initial = initialState();
  assert.deepEqual(initial.effectRuns, []);
  const started = advanceCueClock(definition, initial, 1).state;
  assert.equal(started.effectRuns.length, 2);
  const directions = {
    "opening-wave-bottom-left": { position: [-2.1, 0.4, -2.2], direction: [1, 0, 0] },
    "opening-wave-top-right": { position: [2.1, 2.8, -2.2], direction: [-1, 0, 0] },
  };
  assert.deepEqual(
    new Set(started.effectRuns.map((run) => run.effectId)),
    new Set(Object.keys(directions)),
  );
  for (const run of started.effectRuns) {
    assert.equal(
      run.startedAtRuntimeTimeMilliseconds,
      started.activeRuns[0].startedAtRuntimeTimeMilliseconds,
    );
    assert.equal(run.effect.kind, "wave");
    assert.equal(run.effect.durationMilliseconds / run.effect.speed, 1200);
    assert.equal(run.effect.size, 0.48);
    const anchor = definition.scene.nodes[run.nodeId];
    assert.equal(anchor.assetId, "wave-anchor");
    assert.equal(anchor.opacity, 1);
    assert.deepEqual(anchor.transform.position, directions[run.effectId].position);
    const [x, y, z, w] = anchor.transform.rotation;
    const forward = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    for (let axis = 0; axis < 3; axis++)
      assert.ok(Math.abs(forward[axis] - directions[run.effectId].direction[axis]) < 1e-12);
  }
  const retained = advanceCueClock(definition, started, 1201).state;
  assert.equal(retained.effectRuns.length, 2);
  assert.ok(retained.effectRuns.every((run) => run.status === "retained"));
  const fading = advanceCueClock(definition, retained, 8500).state;
  assert.equal(fading.currentStepId, "opening");
  assert.equal(fading.effectRuns.length, 2);
  assert.ok(at("opacity", 8499) > 0);
  const completed = advanceCueClock(definition, fading, 8501).state;
  assert.deepEqual(completed.effectRuns, []);
  assert.equal(completed.nodes[brandId].opacity, 0);
  assert.equal(completed.nodes[logo.id].opacity, 0);
  const bytes = await readFile(
    new URL(`../../${config.assets["wave-anchor"].path}`, import.meta.url),
  );
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  assert.equal(gltf.meshes?.length ?? 0, 0, "配置用 Model 自体は描画しない");
});

test("開幕完了後にだけ次の場面への入力を受け付ける", () => {
  const completed = advanceCueClock(definition, initialState(), 8501).state;
  const moving = advanceCueClock(definition, initialState(), 8500).state;
  assert.equal(moving.currentStepId, "opening");
  assert.equal(completed.currentStepId, "opening-ready");
  const step = definition.flow.groups.demo.steps[completed.currentStepId];
  assert.ok(
    step.cues.some(
      (cue) => cue.trigger.kind === "logicalInput" && cue.trigger.action === "presenter.next",
    ),
  );
});

test("wave は形を保ってタイトルと同時にフェードアウトし、終了と同時に消える", () => {
  const started = advanceCueClock(definition, initialState(), 1).state;
  assert.equal(started.effectRuns.length, 2);
  for (const run of started.effectRuns) {
    assert.equal(at("opacity", 0, run.nodeId), 1);
    assert.equal(at("opacity", 7000, run.nodeId), 1);
    assert.equal(at("opacity", 7750, run.nodeId), 0.5);
    assert.equal(at("opacity", 8500, run.nodeId), 0);
    for (const time of [0, 7000, 7750, 8500])
      assert.deepEqual(at("transform.scale", time, run.nodeId), [1, 1, 1]);
  }
  assert.equal(advanceCueClock(definition, started, 8500).state.effectRuns.length, 2);
  const completed = advanceCueClock(definition, started, 8501).state;
  assert.equal(completed.nodes[brandId].opacity, 0);
  assert.equal(completed.nodes[logo.id].opacity, 0);
  for (const run of started.effectRuns) assert.equal(completed.nodes[run.nodeId].opacity, 0);
  assert.deepEqual(completed.effectRuns, []);
});

test("ロゴは画像 Surface ではなく icon.glb の Model として配置する", async () => {
  assert.ok(logo, "ロゴを描画する Model が必要");
  assert.equal(logo.assetId, "logo-model");
  assert.equal(config.assets[logo.assetId].mediaType, "model/gltf-binary");
  const bytes = await readFile(new URL("../../assets/icon.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  assert.equal(gltf.animations?.length ?? 0, 0);
  const original = await readFile(new URL("../../../assets/icon.glb", import.meta.url));
  const originalJsonLength = original.readUInt32LE(12);
  const originalGltf = JSON.parse(original.subarray(20, 20 + originalJsonLength).toString("utf8"));
  const imageViews = new Set(gltf.images.map((image) => image.bufferView));
  for (const [index, view] of gltf.bufferViews.entries()) {
    if (imageViews.has(index)) continue;
    const originalView = originalGltf.bufferViews[index];
    assert.deepEqual(
      bytes.subarray(
        28 + jsonLength + view.byteOffset,
        28 + jsonLength + view.byteOffset + view.byteLength,
      ),
      original.subarray(
        28 + originalJsonLength + originalView.byteOffset,
        28 + originalJsonLength + originalView.byteOffset + originalView.byteLength,
      ),
      `geometry buffer view ${index}`,
    );
  }
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

test("ロゴの埋め込み画像は Preview の GPU 予算内に収まる 1024px に縮小する", async () => {
  const bytes = await readFile(new URL("../../assets/icon.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  assert.equal(gltf.images.length, 1);
  const view = gltf.bufferViews[gltf.images[0].bufferView];
  const png = bytes.subarray(
    28 + jsonLength + view.byteOffset,
    28 + jsonLength + view.byteOffset + view.byteLength,
  );
  assert.equal(gltf.images[0].mimeType, "image/png");
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
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

test("開幕は自動で始まり、ロゴと Unframe が 3 秒かけて現れる", () => {
  const initial = initialState();
  assert.equal(initial.nodes[brandId].opacity, 0);
  const started = advanceCueClock(definition, initial, 1).state;
  assert.equal(started.activeRuns.length, 1);
  assert.equal(started.activeRuns[0].startedAtRuntimeTimeMilliseconds, 1);
  for (const id of [brandId, logo.id]) {
    assert.equal(at("opacity", 1500, id), 0.5);
    assert.equal(at("opacity", 3000, id), 1);
  }
});

test("フェードイン完了から4秒保持し、位置とサイズを変えず1.5秒でフェードアウトする", () => {
  for (const id of [brandId, logo.id]) {
    for (const time of [3000, 4500, 6999, 7000]) assert.equal(at("opacity", time, id), 1);
    assert.equal(at("opacity", 7750, id), 0.5);
    assert.equal(at("opacity", 8500, id), 0);
  }
  for (const time of [0, 3000, 7000, 7750, 8500]) {
    assert.deepEqual(at("transform.position", time), [0.381, 1.6, -2]);
    assert.deepEqual(at("transform.scale", time), [1.5, 1.5, 1.5]);
    assert.deepEqual(at("transform.position", time, logo.id), [-0.966, 1.6, -2]);
    assert.deepEqual(at("transform.scale", time, logo.id), [0.6, 0.6, 0.6]);
  }
});

test("8.5秒でロゴと Unframe を消し、中央の配置を保って非表示で待機する", () => {
  const initial = initialState();
  const completed = advanceCueClock(definition, initial, 8501).state;
  assert.equal(completed.activeRuns.length, 0);
  assert.equal(completed.ended, false);
  for (const id of [brandId, logo.id]) {
    assert.deepEqual(completed.nodes[id].transform, initial.nodes[id].transform);
    assert.equal(completed.nodes[id].opacity, 0);
    const later = advanceCueClock(definition, completed, 12001).state;
    assert.deepEqual(later.nodes[id], completed.nodes[id]);
    assert.equal(later.activeRuns.length, 0);
  }
  const surface = definition.scene.surfaces[reactResourceId("surface", "brand")];
  assert.equal(Object.values(surface.baseSemanticTree.nodes)[0].text, "Unframe");
});

test("3D ロゴと Unframe は同じ不透明度でフェードイン・保持・フェードアウトする", () => {
  assert.equal(initialState().nodes[logo.id].opacity, 0);
  for (const time of [0, 750, 1500, 3000, 5000, 7000, 7750, 8499, 8500])
    assert.equal(at("opacity", time, logo.id), at("opacity", time));
});
