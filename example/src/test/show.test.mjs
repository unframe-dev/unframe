import assert from "node:assert/strict";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, executeCueEvent, evaluateTimelineTrack } from "@unframe-dev/playback";
import { definition, initialState } from "./project.mjs";

let sequence = 0;
const input = (state, action = "presenter.next") =>
  executeCueEvent(definition, state, {
    kind: "logicalInput",
    action,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `show-${++sequence}`,
  });
const tick = (state, elapsed) =>
  advanceCueClock(definition, state, state.runtimeTimeMilliseconds + elapsed).state;
const dismissed = () => {
  let state = advanceCueClock(definition, initialState(), 3001).state;
  state = input(state).state;
  state = advanceCueClock(definition, state, 3862).state;
  state = input(state).state;
  state = input(state, "presenter.rotate").state;
  state = advanceCueClock(definition, state, 13862).state;
  state = input(state).state;
  return advanceCueClock(definition, state, 15983).state;
};
const node = (state, id) => state.nodes[reactResourceId("host", id)];

test("当初案の退場後、次の操作で空間に言葉と図版を広げて待機する", () => {
  const before = dismissed();
  const start = input(before);
  assert.equal(start.outcome.kind, "accepted");
  assert.equal(input(start.state).outcome.kind, "none");
  const shown = tick(start.state, 2401);
  assert.equal(shown.currentStepId, "expression-ready");
  for (const id of ["word-speak", "word-move", "word-space", "gesture-drawing"]) {
    assert.equal(node(shown, id).opacity, 1, id);
  }
  for (const id of ["brand", "logo"]) {
    const key =
      id === "logo"
        ? Object.values(definition.scene.nodes).find(
            (n) => n.kind === "model" && n.assetId === "logo-model",
          ).id
        : reactResourceId("host", id);
    assert.deepEqual(shown.nodes[key], before.nodes[key]);
  }
});

const enter = (state, step, duration) => {
  const started = input(state);
  assert.equal(started.outcome.kind, "accepted", step);
  assert.equal(input(started.state).outcome.kind, "none", `${step} の演出中は入力を受け付けない`);
  const entering = step === "comparison-expected" ? tick(started.state, 352) : started.state;
  const ready = tick(entering, duration + 1);
  assert.equal(ready.currentStepId, `${step}-ready`);
  assert.equal(ready.activeRuns.length, 0);
  return ready;
};
const expression = () => enter(dismissed(), "expression", 2400);
const technology = () => {
  let state = expression();
  for (const [step, duration, visible, hidden] of [
    ["journey-goal", 1200, ["goal-before", "goal-after"], ["word-speak", "gesture-drawing"]],
    [
      "journey-challenge",
      1200,
      ["challenge-author", "challenge-sync", "challenge-deliver"],
      ["goal-before", "goal-after"],
    ],
    [
      "journey-prototype",
      1600,
      ["prototype-word", "gesture-drawing"],
      ["challenge-author", "challenge-sync", "challenge-deliver"],
    ],
    ["journey-discovery", 1200, ["discovery-word"], ["prototype-word", "gesture-drawing"]],
    ["comparison-expected", 3000, ["expected-word"], ["discovery-word"]],
    [
      "comparison-observed",
      3000,
      ["comparison-word", "word-speak", "word-move", "gesture-drawing"],
      ["expected-word"],
    ],
    [
      "showcase",
      5400,
      ["word-space", "word-speak", "word-move", "gesture-drawing"],
      ["comparison-word"],
    ],
    [
      "technology",
      1800,
      ["tech-control", "tech-realtime", "tech-unity", "tech-web", "tech-assets", "tech-links"],
      ["word-space", "word-speak", "word-move", "gesture-drawing"],
    ],
  ]) {
    state = enter(state, step, duration);
    for (const id of visible) assert.equal(node(state, id).opacity, 1, `${step}: ${id}`);
    for (const id of hidden) assert.equal(node(state, id)?.opacity ?? 0, 0, `${step}: ${id}`);
    assert.equal(node(state, "brand").opacity, 1);
    assert.deepEqual(node(state, "brand").transform.position, [-1.35872, 2.45, -2]);
  }
  return state;
};

test("課題・試作・発見から比較と見せ場を経て技術構成図まで進める", () => {
  const state = technology();
  assert.equal(node(state, "show-cube").opacity, 0);
});

const visualValue = (state, id, property) => {
  const nodeId = reactResourceId("host", id);
  for (const run of state.activeRuns) {
    const timeline = definition.flow.timelines[run.timelineId];
    const track = timeline.tracks.find(
      (t) => t.target.nodeId === nodeId && t.target.property === property,
    );
    if (track)
      return evaluateTimelineTrack(
        track,
        timeline.durationMilliseconds,
        state.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds,
      );
  }
  return property.split(".").reduce((value, key) => value[key], state.nodes[nodeId]);
};

test("閉幕は本編消去、ブランド復帰、一拍、消灯の順で通常スライドへ受け渡す", () => {
  const state = technology();
  const started = input(state);
  assert.equal(started.outcome.kind, "accepted");
  assert.equal(input(started.state).outcome.kind, "none");
  const cleared = tick(started.state, 701);
  for (const id of [
    "tech-control",
    "tech-realtime",
    "tech-unity",
    "tech-web",
    "tech-assets",
    "tech-links",
  ])
    assert.equal(visualValue(cleared, id, "opacity"), 0);
  assert.deepEqual(visualValue(cleared, "brand", "transform.position"), [-1.35872, 2.45, -2]);
  const centered = tick(cleared, 1300);
  assert.equal(visualValue(centered, "brand", "opacity"), 1);
  assert.deepEqual(visualValue(centered, "brand", "transform.position"), [0.254, 1.6, -2]);
  assert.deepEqual(visualValue(centered, "brand", "transform.scale"), [1, 1, 1]);
  const held = tick(centered, 800);
  assert.equal(visualValue(held, "brand", "opacity"), 1);
  const dark = tick(held, 900);
  assert.equal(dark.currentStepId, "ordinary-slides");
  assert.equal(dark.activeRuns.length, 0);
  for (const n of Object.values(dark.nodes)) assert.equal(n.opacity, 0, n.id);
  assert.equal(dark.ended, false);
  assert.equal(input(dark).state.ended, true);
});

test("比較で一回転し、見せ場で拡大・左右移動・回転した後に1秒静止する", () => {
  let state = expression();
  for (const [step, duration] of [
    ["journey-goal", 1200],
    ["journey-challenge", 1200],
    ["journey-prototype", 1600],
    ["journey-discovery", 1200],
  ]) {
    state = enter(state, step, duration);
  }
  const comparing = input(state).state;
  const start = tick(comparing, 352);
  const half = tick(start, 1500);
  const startRotation = visualValue(start, "show-cube", "transform.rotation");
  const halfRotation = visualValue(half, "show-cube", "transform.rotation");
  assert.ok(
    Math.abs(startRotation.reduce((sum, value, i) => sum + value * halfRotation[i], 0)) < 1e-9,
  );
  const turned = tick(start, 3000);
  const rotation = node(turned, "show-cube").transform.rotation;
  assert.ok(
    Math.abs(Math.abs(startRotation.reduce((sum, value, i) => sum + value * rotation[i], 0)) - 1) <
      1e-9,
  );
  state = enter(turned, "comparison-observed", 3000);
  const showing = tick(input(state).state, 1);
  const left = tick(showing, 1400);
  const enlarged = tick(showing, 3400);
  assert.ok(visualValue(left, "show-cube", "transform.position")[0] < 0);
  assert.ok(visualValue(enlarged, "show-cube", "transform.position")[0] > 0);
  assert.ok(
    visualValue(enlarged, "show-cube", "transform.scale")[0] >
      visualValue(showing, "show-cube", "transform.scale")[0] * 2,
  );
  assert.notDeepEqual(
    visualValue(left, "show-cube", "transform.rotation"),
    visualValue(showing, "show-cube", "transform.rotation"),
  );
  const held = tick(showing, 4400);
  const complete = tick(showing, 5400);
  for (const id of ["show-cube", "word-speak", "word-move", "word-space"]) {
    for (const field of ["transform.position", "transform.scale", "transform.rotation"]) {
      assert.deepEqual(visualValue(held, id, field), visualValue(complete, id, field));
    }
  }
});

test("当初案を退場して別の場面へ進むと専用資産を外し、ブランドと再利用素材を保持する", () => {
  const before = dismissed();
  const state = expression();
  assert.equal(state.currentGroupId, "expression");
  for (const id of ["original-panel", "rejection-mark"]) {
    assert.equal(node(state, id), undefined, id);
  }
  for (const id of ["brand", "word-speak", "word-move", "word-space", "gesture-drawing"]) {
    assert.ok(node(state, id), id);
  }
  assert.deepEqual(node(state, "brand"), node(before, "brand"));
});

test("探索の最後の文字は退場完了まで残り、比較へ進むと探索専用の文字を外す", () => {
  let state = expression();
  for (const [step, duration] of [
    ["journey-goal", 1200],
    ["journey-challenge", 1200],
    ["journey-prototype", 1600],
    ["journey-discovery", 1200],
  ])
    state = enter(state, step, duration);
  assert.equal(state.currentGroupId, "journey");
  const leaving = input(state).state;
  const fading = tick(leaving, 176);
  assert.equal(fading.currentGroupId, "journey");
  assert.ok(visualValue(fading, "discovery-word", "opacity") > 0);
  assert.ok(visualValue(fading, "discovery-word", "opacity") < 1);
  assert.equal(input(fading).outcome.kind, "none");
  const compared = tick(leaving, 352);
  assert.equal(compared.currentGroupId, "comparison");
  for (const id of [
    "goal-before",
    "goal-after",
    "challenge-author",
    "challenge-sync",
    "challenge-deliver",
    "prototype-word",
    "discovery-word",
  ])
    assert.equal(node(compared, id), undefined, id);
  assert.ok(node(compared, "expected-word"));
  assert.ok(node(compared, "gesture-drawing"));
});

test("技術紹介への切替と閉幕後に、前の場面の専用資産を外す", () => {
  const state = technology();
  assert.equal(state.currentGroupId, "technology");
  for (const id of ["expected-word", "comparison-word"]) assert.equal(node(state, id), undefined);
  const closed = tick(input(state).state, 3701);
  assert.equal(closed.currentGroupId, "ordinary-slides");
  for (const id of [
    "tech-control",
    "tech-assets",
    "tech-realtime",
    "tech-unity",
    "tech-web",
    "tech-links",
  ])
    assert.equal(node(closed, id), undefined, id);
  assert.ok(node(closed, "brand"));
});

test("当初案の回転中に次のgroupへ進んでも、立方体の回転完了と非表示状態を保つ", () => {
  let state = tick(initialState(), 3001);
  state = tick(input(state).state, 861);
  state = input(state).state;
  state = input(state, "presenter.rotate").state;
  state = tick(input(state).state, 2121);
  assert.equal(state.currentStepId, "original-dismissed");
  const next = input(state);
  assert.equal(next.outcome.kind, "accepted");
  state = tick(next.state, 2401);
  assert.equal(state.currentGroupId, "expression");
  assert.equal(state.activeRuns.length, 1);
  const cube = Object.values(definition.scene.nodes).find(
    (n) =>
      n.kind === "model" &&
      n.assetId === "demo-cube" &&
      n.owner.kind === "presentation" &&
      n.transform.position[0] === 1.16,
  );
  assert.ok(cube);
  assert.equal(state.nodes[cube.id].opacity, 0);
  state = tick(state, 10000);
  assert.equal(state.activeRuns.length, 0);
  assert.equal(state.nodes[cube.id].opacity, 0);
});

test("画像の所有範囲を分け、共有・現在・次候補を合わせても最大14枚に抑える", () => {
  const surfaces = Object.values(definition.scene.surfaces);
  const owners = surfaces.flatMap((surface) =>
    Object.values(surface.states).map(() => definition.scene.nodes[surface.hostNodeId].owner),
  );
  assert.equal(owners.length, 23);
  assert.equal(owners.filter((owner) => owner.kind === "presentation").length, 5);
  const windows = Object.values(definition.flow.groups).map((group) => {
    const next = new Set(
      Object.values(group.steps).flatMap((step) =>
        step.cues.flatMap((cue) => (cue.next.kind === "group" ? [cue.next.groupId] : [])),
      ),
    );
    return owners.filter(
      (owner) =>
        owner.kind === "presentation" || owner.groupId === group.id || next.has(owner.groupId),
    ).length;
  });
  assert.equal(Math.max(...windows), 14);
});
