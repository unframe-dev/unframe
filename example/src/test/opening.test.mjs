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
  assert.ok(track, `${property} トラックが必要`);
  return evaluateTimelineTrack(track, timeline.durationMilliseconds, milliseconds);
};

test("Unframe と同時に左下と右上から wave を開始し、開幕完了で消す", async () => {
  const initial = initialState();
  assert.deepEqual(initial.effectRuns, []);
  const started = advanceCueClock(definition, initial, 1).state;
  assert.equal(started.effectRuns.length, 2);
  const directions = {
    "opening-wave-bottom-left": { position: [-1.4, 0.7, -2.2], direction: [1, 0, 0] },
    "opening-wave-top-right": { position: [1.4, 2.5, -2.2], direction: [-1, 0, 0] },
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
    assert.equal(run.effect.durationMilliseconds / run.effect.speed, 4000);
    const anchor = definition.scene.nodes[run.nodeId];
    assert.equal(anchor.assetId, "wave-anchor");
    assert.equal(anchor.opacity, 1);
    assert.deepEqual(anchor.transform.position, directions[run.effectId].position);
    const [x, y, z, w] = anchor.transform.rotation;
    const forward = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    for (let axis = 0; axis < 3; axis++)
      assert.ok(Math.abs(forward[axis] - directions[run.effectId].direction[axis]) < 1e-12);
  }
  const retained = advanceCueClock(definition, started, 4001).state;
  assert.equal(retained.effectRuns.length, 2);
  assert.ok(retained.effectRuns.every((run) => run.status === "retained"));
  assert.deepEqual(advanceCueClock(definition, retained, 6001).state.effectRuns, []);
  const bytes = await readFile(
    new URL(`../../${config.assets["wave-anchor"].path}`, import.meta.url),
  );
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  assert.equal(gltf.meshes?.length ?? 0, 0, "配置用 Model 自体は描画しない");
});

test("開幕完了後にだけ次の場面への入力を受け付ける", () => {
  const completed = advanceCueClock(definition, initialState(), 6001).state;
  const moving = advanceCueClock(definition, initialState(), 5001).state;
  assert.equal(moving.currentStepId, "opening");
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

test("開幕は自動で始まり、ロゴと Unframe が 1.5 秒かけて現れる", () => {
  const initial = initialState();
  assert.equal(initial.nodes[brandId].opacity, 0);
  const started = advanceCueClock(definition, initial, 1).state;
  assert.equal(started.activeRuns.length, 1, "ロゴと文字の開幕を単一 Timeline で開始する");
  for (const run of started.activeRuns) assert.equal(run.startedAtRuntimeTimeMilliseconds, 1);
  assert.equal(at("opacity", 750), 0.5);
  assert.equal(at("opacity", 1500), 1);
  assert.deepEqual(at("transform.position", 1500), [0.381, 1.6, -2]);
  assert.deepEqual(at("transform.scale", 1500), [1.5, 1.5, 1.5]);
  assert.deepEqual(at("transform.position", 1500, logo.id), [-0.966, 1.6, -2]);
  assert.deepEqual(at("transform.scale", 1500, logo.id), [0.6, 0.6, 0.6]);
});

test("表示後は 2.5 秒静止し、縮小と左上への移動を同じタイミングで行う", () => {
  assert.equal(at("opacity", 4000), 1);
  assert.deepEqual(at("transform.position", 4000), [0.381, 1.6, -2]);
  assert.deepEqual(at("transform.scale", 4000), [1.5, 1.5, 1.5]);
  const middle = at("transform.position", 5000);
  assert.ok(Math.abs(middle[0] - -0.48886) < 1e-12);
  assert.ok(Math.abs(middle[1] - 2.025) < 1e-12);
  assert.equal(middle[2], -2);
  for (const axis of at("transform.scale", 5000)) {
    assert.ok(Math.abs(axis - 0.91) < 1e-12);
  }
});

test("6 秒で移動を終え、Unframe を左上で維持する", () => {
  const completed = advanceCueClock(definition, initialState(), 6001).state;
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
  for (const time of [0, 750, 1500, 4000, 4500, 5000, 5500, 6000]) {
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
  const completed = advanceCueClock(definition, initialState(), 6001).state;
  assert.deepEqual(completed.nodes[logo.id].transform.position, [-1.64608, 2.45, -2]);
  assert.deepEqual(completed.nodes[logo.id].transform.scale, [0.128, 0.128, 0.128]);
  assert.equal(completed.nodes[logo.id].opacity, 1);
  assert.deepEqual(
    advanceCueClock(definition, completed, 10001).state.nodes[logo.id],
    completed.nodes[logo.id],
  );
});
