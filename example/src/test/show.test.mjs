import assert from "node:assert/strict";
import { test } from "node:test";
import { reactResourceId } from "@unframe-dev/compiler";
import { advanceCueClock, executeCueEvent } from "@unframe-dev/playback";
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
const gesture = (state, recognized) =>
  executeCueEvent(definition, state, {
    kind: "gesture",
    gesture: recognized,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `gesture-${++sequence}`,
  });
const zone = (state, edge = "enter") =>
  executeCueEvent(definition, state, {
    kind: "zoneEdge",
    zoneId: "journey-stage",
    edge,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `zone-${++sequence}`,
  });
test("Zoneに入って枠を表示し、両手を広げると内容が空間へ広がる", () => {
  const waiting = input(expression()).state;
  assert.equal(waiting.currentStepId, "journey-zone");
  assert.equal(gesture(waiting, "spreadHands").outcome.kind, "none");
  assert.equal(zone(waiting, "exit").outcome.kind, "none");
  assert.equal(input(waiting).outcome.kind, "none");
  const entered = zone(waiting).state;
  assert.equal(zone(entered).outcome.kind, "none");
  const framed = tick(entered, 801);
  assert.equal(framed.currentStepId, "journey-framed");
  assert.equal(node(framed, "goal-frame-left").opacity, 1);
  assert.equal(node(framed, "goal-after").opacity, 0);
  const expanded = tick(gesture(framed, "spreadHands").state, 1201);
  assert.equal(expanded.currentStepId, "journey-goal-ready");
  assert.equal(node(expanded, "goal-frame-left").opacity, 0);
  assert.equal(node(expanded, "goal-after").opacity, 1);
  assert.ok(
    node(expanded, "goal-cube").transform.position[2] >
      node(framed, "goal-cube").transform.position[2],
  );
  const conditions = tick(input(expanded).state, 1201);
  assert.equal(conditions.currentGroupId, "conditions");
  assert.equal(node(conditions, "goal-cube"), undefined);
});
const tick = (state, elapsed) =>
  advanceCueClock(definition, state, state.runtimeTimeMilliseconds + elapsed).state;
const dismissed = () => {
  let state = advanceCueClock(definition, initialState(), 8501).state;
  state = input(state).state;
  state = advanceCueClock(definition, state, 9362).state;
  state = input(state).state;
  state = input(state, "presenter.rotate").state;
  state = advanceCueClock(definition, state, 19362).state;
  state = input(state).state;
  return advanceCueClock(definition, state, 21483).state;
};
const node = (state, id) => state.nodes[reactResourceId("host", id)];

test("円の認識前から軌跡を表示し、円と投げる動作で進む", () => {
  const waiting = tick(input(dismissed()).state, 1);
  assert.equal(waiting.currentStepId, "expression");
  assert.equal(node(waiting, "expression-cube").opacity, 0);
  assert.equal(waiting.effectRuns.length, 2);
  for (const hand of ["left", "right"]) {
    assert.ok(
      waiting.effectRuns.some((run) => run.effect.kind === "handGlow" && run.effect.hand === hand),
    );
    assert.deepEqual(
      definition.scene.nodes[reactResourceId("host", `expression-${hand}-hand`)].parent,
      {
        kind: "anchor",
        owner: { kind: "presenter" },
        target: `${hand}Hand`,
        followPosition: true,
        followRotation: false,
      },
    );
  }
  assert.equal(input(waiting).outcome.kind, "none");
  assert.equal(gesture(waiting, "throw").outcome.kind, "none");
  const drawing = gesture(waiting, "circle");
  assert.equal(drawing.outcome.kind, "accepted");
  assert.equal(drawing.state.effectRuns.length, 0);
  assert.equal(gesture(drawing.state, "circle").outcome.kind, "none");
  const drawn = tick(drawing.state, 801);
  assert.equal(drawn.currentStepId, "expression-drawn");
  assert.equal(node(drawn, "expression-cube").opacity, 1);
  assert.equal(node(drawn, "expression-message").opacity, 0);
  assert.equal(input(drawn).outcome.kind, "none");
  assert.equal(gesture(drawn, "circle").outcome.kind, "none");
  const moving = gesture(drawn, "throw");
  assert.equal(moving.outcome.kind, "accepted");
  assert.equal(gesture(moving.state, "throw").outcome.kind, "none");
  const ready = tick(moving.state, 1801);
  assert.equal(ready.currentStepId, "expression-ready");
  assert.ok(
    node(ready, "expression-cube").transform.position[2] <
      node(drawn, "expression-cube").transform.position[2],
  );
  assert.equal(node(ready, "expression-message").opacity, 1);
  const next = tick(input(ready).state, 1201);
  assert.equal(next.currentStepId, "journey-zone");
  assert.equal(node(next, "expression-message"), undefined);
  assert.equal(node(next, "expression-left-hand"), undefined);
  assert.equal(next.effectRuns.length, 0);
});

test("円を待っている間は軌跡の表示期間を更新して認識待ちを維持する", () => {
  const waiting = tick(input(dismissed()).state, 60002);
  assert.equal(waiting.currentStepId, "expression");
  assert.equal(waiting.effectRuns.length, 2);
  assert.equal(gesture(waiting, "circle").outcome.kind, "accepted");
});

const expression = () => {
  const waiting = tick(input(dismissed()).state, 1);
  const drawn = tick(gesture(waiting, "circle").state, 801);
  return tick(gesture(drawn, "throw").state, 1801);
};
const goal = () => {
  const waiting = input(expression()).state;
  const framed = tick(zone(waiting).state, 801);
  return tick(gesture(framed, "spreadHands").state, 1201);
};

test("6から9枚目は成立条件、内容と操作、空間と共有、まとめの順で進む", () => {
  let state = goal();
  const pages = [
    [
      "conditions",
      [
        "conditions-title",
        "condition-content",
        "condition-action",
        "condition-space",
        "condition-sharing",
      ],
    ],
    ["content-action", ["action-title", "action-gesture", "action-zone", "action-message"]],
    ["space-sharing", ["sharing-title", "sharing-place", "sharing-progress", "sharing-message"]],
    ["summary", ["summary-content", "summary-body-space", "summary-audience"]],
  ];
  let previous = ["goal-before", "goal-after"];
  for (const [group, visible] of pages) {
    const started = input(state);
    assert.equal(started.outcome.kind, "accepted");
    assert.equal(started.state.currentGroupId, group);
    assert.equal(input(started.state).outcome.kind, "none");
    state = tick(started.state, 1201);
    assert.equal(state.currentStepId, group + "-ready");
    assert.equal(state.activeRuns.length, 0);
    for (const id of visible) assert.equal(node(state, id).opacity, 1, id);
    for (const id of previous) assert.equal(node(state, id), undefined, id);
    previous = visible;
  }
  state = input(state).state;
  assert.equal(state.currentGroupId, "ordinary-slides");
  for (const id of previous) assert.equal(node(state, id), undefined);
  assert.equal(input(state).state.ended, true);
});

test("後半は体験の条件を説明し、制作手順や技術構成の場面を含めない", () => {
  const texts = Object.values(definition.scene.surfaces).flatMap((surface) =>
    Object.values(surface.baseSemanticTree.nodes).map((node) => node.text ?? ""),
  );
  for (const text of [
    "見せる内容",
    "発表者の操作",
    "空間の位置合わせ",
    "観客への共有",
    "動作に応じて、内容が変わる",
    "立つ場所に応じて、場面が変わる",
    "どこに表示するか",
    "いま何が起きているか",
    "観客に伝える。",
  ]) {
    assert.ok(
      texts.some((value) => value.includes(text)),
      text,
    );
  }
  assert.equal(definition.flow.groups.technology, undefined);
  assert.equal(definition.flow.groups.comparison, undefined);
  assert.equal(node(goal(), "challenge-cube-center"), undefined);
  for (const text of texts)
    assert.doesNotMatch(
      text,
      /Control Plane|Realtime|Workers|試す → 見る → 直す|つくる|そろえる|届ける/,
    );
});
