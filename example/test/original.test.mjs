import assert from "node:assert/strict";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, executeCueEvent, evaluateTimelineTrack } from "@unframe-dev/playback";
import { definition, initialState } from "./project.mjs";

const panelId = reactResourceId("host", "original-panel");
const surfaceId = reactResourceId("surface", "original-panel");
const brandId = reactResourceId("host", "brand");
const cubeId = Object.values(definition.scene.nodes).find(
  (node) => node.kind === "model" && node.assetId === "demo-cube",
).id;
const logoId = Object.values(definition.scene.nodes).find(
  (node) => node.kind === "model" && node.assetId === "logo-model",
).id;
let sequence = 0;
const input = (state, action) =>
  executeCueEvent(definition, state, {
    kind: "logicalInput",
    action,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `input-${++sequence}`,
  });
const ready = () => advanceCueClock(definition, initialState(), 3001).state;
const showOriginal = () => {
  const next = input(ready(), "presenter.next");
  assert.equal(next.outcome.kind, "accepted");
  return advanceCueClock(definition, next.state, 3862).state;
};

test("開幕を飛ばさず、次の入力でパネルと立方体が現れ、左上の Unframe は動かない", () => {
  assert.equal(input(initialState(), "presenter.next").outcome.kind, "none");
  const before = ready();
  assert.equal(before.nodes[panelId].opacity, 0);
  assert.equal(before.nodes[cubeId].opacity, 0);
  const shown = showOriginal();
  assert.equal(shown.currentStepId, "original-intro");
  assert.equal(shown.nodes[panelId].opacity, 1);
  assert.equal(shown.nodes[cubeId].opacity, 1);
  assert.deepEqual(shown.nodes[panelId].transform.position, [-0.52, 1.35, -2]);
  assert.deepEqual(shown.nodes[cubeId].transform.position, [1.16, 1.38, -2.05]);
  assert.deepEqual(shown.nodes[brandId], before.nodes[brandId]);
  assert.deepEqual(shown.nodes[logoId], before.nodes[logoId]);
});

test("パネル送りは一度だけ受け付け、2枚目の説明へ切り替える", () => {
  const intro = showOriginal();
  assert.equal(intro.surfaces[surfaceId], reactResourceId("state", "original-panel", "intro"));
  const advanced = input(intro, "presenter.next");
  assert.equal(advanced.outcome.kind, "accepted");
  assert.equal(advanced.state.currentStepId, "original-detail");
  assert.equal(
    advanced.state.surfaces[surfaceId],
    reactResourceId("state", "original-panel", "detail"),
  );
  assert.equal(input(advanced.state, "presenter.next").outcome.kind, "none");
  const detail = definition.scene.surfaces[surfaceId].states[advanced.state.surfaces[surfaceId]];
  assert.ok(
    detail.semanticOverrides
      .flatMap((override) => Object.values(override.nodes))
      .some((override) => override.text === "向きを変えて見る"),
  );
  assert.ok(
    detail.semanticOverrides
      .flatMap((override) => Object.values(override.nodes))
      .some((override) => override.text === "2 / 2"),
  );
});

test("回転操作で立方体が10秒かけて一周し、パネルとロゴを残して停止する", () => {
  const detail = input(showOriginal(), "presenter.next").state;
  const turning = input(detail, "presenter.rotate");
  assert.equal(turning.outcome.kind, "accepted");
  assert.equal(turning.state.phase.kind, "transitioning");
  assert.equal(input(turning.state, "presenter.rotate").outcome.kind, "none");
  const timeline = Object.values(definition.flow.timelines).find((t) =>
    t.tracks.some(
      (track) => track.target.nodeId === cubeId && track.target.property === "transform.rotation",
    ),
  );
  assert.equal(timeline.durationMilliseconds, 10000);
  const track = timeline.tracks[0];
  const start = evaluateTimelineTrack(track, 10000, 0);
  const halfway = evaluateTimelineTrack(track, 10000, 5000);
  assert.ok(Math.abs(start.reduce((sum, value, i) => sum + value * halfway[i], 0)) < 1e-12);
  const complete = advanceCueClock(definition, turning.state, 13862).state;
  assert.equal(complete.currentStepId, "original-shown");
  assert.equal(complete.activeRuns.length, 0);
  assert.equal(complete.ended, false);
  for (let axis = 0; axis < 4; axis++)
    assert.ok(Math.abs(complete.nodes[cubeId].transform.rotation[axis] - start[axis]) < 1e-12);
  assert.deepEqual(complete.nodes[brandId], detail.nodes[brandId]);
  assert.deepEqual(complete.nodes[logoId], detail.nodes[logoId]);
  assert.deepEqual(complete.surfaces, detail.surfaces);
  assert.equal(complete.nodes[cubeId].opacity, 1);
  assert.equal(complete.nodes[panelId].opacity, 1);
});
